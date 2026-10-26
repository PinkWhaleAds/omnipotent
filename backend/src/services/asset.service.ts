import { createHash, randomUUID } from 'node:crypto';

import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { imageSize } from 'image-size';
import { DataSource, EntityManager, IsNull, Repository, SelectQueryBuilder } from 'typeorm';

import { storageConfig, StorageConfig } from '@configs';
import { AssetEntity, CreativeEntity, CreativeVersionAssetEntity, CreativeVersionEntity } from '@src/database/entities';
import {
  ACCEPTED_MIME_TYPES,
  Asset,
  AssetKind,
  AuthContext,
  DeletionResult,
  LabelSummary,
  ListAssetsQuery,
  Paginated,
  SetLabelsBody,
  UpdateAssetBody,
} from '@src/types';
import { escapeLike, httpError, toPage, toSkipTake, withoutAccents, withoutAccentsSql } from '@utils';
import { AccessService } from './access.service';
import { toOrder } from './crud.helpers';
import { LabelService } from './label.service';
import { StorageService } from './storage.service';

/** The kind this resource is, as the label assignments store it. */
const RESOURCE_TYPE = 'asset';

/** What an upload hands the service: the bytes, and what the caller says about them. */
export type AssetUpload = {
  /** Name the file was uploaded under. */
  fileName: string;
  /** MIME type the client declared. */
  mimeType: string;
  /** The bytes. */
  data: Buffer;
  /** Length of a video or an audio, declared (`docs/phase-6.md` § 10). */
  durationMs?: number;
  /** Labels to post on it right away. */
  labelIds?: string[];
};

/** What an upload answers: the asset, and whether these bytes were new to the library. */
export type UploadedAsset = {
  /** The asset the library now holds for those bytes. */
  asset: Asset;
  /** `false` when the fingerprint was already there, which is what makes an upload repeatable. */
  created: boolean;
};

/** What reading the bytes says about them. */
type Inspection = { kind: AssetKind; mimeType: string; width: number | null; height: number | null };

/**
 * Make a file name safe for an object key.
 *
 * @param fileName - Original file name
 * @returns The name with anything but letters, digits, dots, dashes and underscores replaced
 */
function safeFileName(fileName: string): string {
  return fileName.replace(/[^A-Za-z0-9._-]/g, '_').slice(-100);
}

/**
 * Manages the assets of an Advertiser's library.
 *
 * An asset is a **resource of its own** (`../../CADRAGE.md` § 9): it has this CRUD, its labels and
 * its search, and it exists before any creative — which is what lets a generation produce raw assets
 * and a client post assets to feed one.
 *
 * Two rules carry the phase (`docs/phase-6.md` § 2): the **fingerprint** makes an upload repeatable,
 * posting the same file twice answering the asset already there; and an asset a **living version
 * uses is never deleted**, the refusal saying how many creatives hold it.
 */
export class AssetService {
  /**
   * Create the service.
   *
   * @param dataSource - Application database
   * @param access - Permission checks
   * @param labels - Posting and reading the Labels of a resource
   * @param storage - Object storage holding the bytes
   * @param config - Storage configuration, which caps an upload
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: AccessService,
    private readonly labels: LabelService,
    private readonly storage: StorageService,
    private readonly config: StorageConfig = storageConfig
  ) {}

  /**
   * List the assets of an Advertiser.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param advertiserId - The Advertiser whose library is read
   * @param query - Page, sort, search, kind, labels, and whether the deleted ones are listed
   * @returns A page of assets, each with its Labels and a download URL
   * @throws Error with status 404 when the caller cannot see the Organization
   */
  public async list(
    actor: AuthContext,
    organizationId: string,
    advertiserId: string,
    query: ListAssetsQuery
  ): Promise<Paginated<Asset>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');

    const builder: SelectQueryBuilder<AssetEntity> = this.repository()
      .createQueryBuilder('asset')
      .withDeleted()
      .where('asset.organization_id = :organizationId', { organizationId })
      .andWhere('asset.advertiser_id = :advertiserId', { advertiserId });
    if (!query.includeDeleted) builder.andWhere('asset.deleted_at IS NULL');
    if (query.kind) builder.andWhere('asset.kind = :kind', { kind: query.kind });
    if (query.search) {
      builder.andWhere(`${withoutAccentsSql('asset.file_name')} ILIKE :search`, {
        search: `%${escapeLike(withoutAccents(query.search))}%`,
      });
    }

    const { skip, take } = toSkipTake(query);
    for (const [field, direction] of Object.entries(toOrder(query.sortBy, query.sortOrder))) {
      builder.addOrderBy(`asset.${field}`, direction);
    }
    const [rows, total]: [AssetEntity[], number] = await builder.skip(skip).take(take).getManyAndCount();
    return toPage(await this.toAssets(this.dataSource.manager, rows), total, query);
  }

  /**
   * Read one asset.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The asset
   * @returns The asset, with its Labels and a download URL
   * @throws Error with status 404 when the caller cannot see it
   */
  public async get(actor: AuthContext, organizationId: string, id: string): Promise<Asset> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    const asset: AssetEntity = await this.findOrFail(this.dataSource.manager, organizationId, id, { deleted: true });
    const [answered]: Asset[] = await this.toAssets(this.dataSource.manager, [asset]);
    return answered;
  }

  /**
   * Put a file in the library of an Advertiser.
   *
   * The same bytes twice answer the **same asset**, with `created: false`: the fingerprint is unique
   * per Advertiser, so an upload is repeatable and a retry after a lost answer costs nothing.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param advertiserId - The Advertiser whose library it joins
   * @param upload - The bytes, their name, their declared type and what the caller says about them
   * @returns The asset, and whether these bytes were new
   * @throws Error with status 403 without the manager role, 404 on an unknown Advertiser or Label,
   *   400 when the file is too large, of a type the library refuses, or does not read as its type
   */
  public async upload(
    actor: AuthContext,
    organizationId: string,
    advertiserId: string,
    upload: AssetUpload
  ): Promise<UploadedAsset> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    if (upload.data.length > this.config.maxUploadBytes) {
      throw httpError(400, `The file exceeds ${Math.round(this.config.maxUploadBytes / 1_048_576)} MB`, {
        code: 'asset_too_large',
        params: { maxBytes: this.config.maxUploadBytes, sizeBytes: upload.data.length },
      });
    }
    const inspection: Inspection = this.inspect(upload.mimeType, upload.data);
    const fingerprint: string = createHash('sha256').update(upload.data).digest('hex');

    return this.dataSource.transaction(async (manager: EntityManager): Promise<UploadedAsset> => {
      const known: AssetEntity | null = await manager.findOne(AssetEntity, {
        where: { organizationId, advertiserId, fingerprint, deletedAt: IsNull() },
      });
      if (known) {
        const [asset]: Asset[] = await this.toAssets(manager, [known]);
        return { asset, created: false };
      }

      const id: string = randomUUID();
      const storageKey = `${organizationId}/${advertiserId}/${id}/${safeFileName(upload.fileName)}`;
      await this.storage.put(storageKey, upload.data, inspection.mimeType);
      const saved: AssetEntity = await manager.save(
        AssetEntity,
        manager.create(AssetEntity, {
          id,
          organizationId,
          advertiserId,
          fileName: upload.fileName.slice(0, 255),
          kind: inspection.kind,
          mimeType: inspection.mimeType,
          sizeBytes: upload.data.length,
          width: inspection.width,
          height: inspection.height,
          durationMs: upload.durationMs ?? null,
          fingerprint,
          provenance: 'uploaded',
          aiGenerationId: null,
          storageKey,
        })
      );
      const posted: LabelSummary[] = upload.labelIds?.length
        ? await this.labels.setOn(manager, organizationId, RESOURCE_TYPE, saved.id, upload.labelIds)
        : [];
      return { asset: await this.toAsset(saved, posted), created: true };
    });
  }

  /**
   * Rename an asset. Its bytes never change: a new file is a new asset.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The asset
   * @param body - The new name
   * @returns The updated asset
   * @throws Error with status 403 without the manager role, 404 when absent
   */
  public async update(actor: AuthContext, organizationId: string, id: string, body: UpdateAssetBody): Promise<Asset> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<Asset> => {
      const asset: AssetEntity = await this.findOrFail(manager, organizationId, id);
      if (body.fileName !== undefined) {
        asset.fileName = body.fileName;
        await manager.update(AssetEntity, { id: asset.id }, { fileName: body.fileName });
      }
      const [answered]: Asset[] = await this.toAssets(manager, [asset]);
      return answered;
    });
  }

  /**
   * Soft-delete an asset, unless a living creative version uses it.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The asset
   * @returns Its id and when it was deleted
   * @throws Error with status 403 without the manager role, 404 when absent, 409 coded `asset_in_use`
   */
  public async delete(actor: AuthContext, organizationId: string, id: string): Promise<DeletionResult> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<DeletionResult> => {
      const asset: AssetEntity = await this.findOrFail(manager, organizationId, id);
      const holders: number = await this.countHolders(manager, asset.id);
      if (holders > 0) {
        throw httpError(409, 'This asset is used by a creative: delete the creative first', {
          code: 'asset_in_use',
          params: { assetId: asset.id, creatives: holders },
        });
      }
      const deletedAt = new Date();
      await manager.update(AssetEntity, { id: asset.id }, { deletedAt });
      return { id: asset.id, deletedAt: deletedAt.toISOString() };
    });
  }

  /**
   * Restore a soft-deleted asset.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The asset
   * @returns Its id, with `deletedAt` back to `null`
   * @throws Error with status 403 without the manager role, 404 when absent, 409 when it is not deleted
   */
  public async restore(actor: AuthContext, organizationId: string, id: string): Promise<DeletionResult> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<DeletionResult> => {
      const asset: AssetEntity = await this.findOrFail(manager, organizationId, id, { deleted: true });
      if (!asset.deletedAt) throw httpError(409, 'This asset is not deleted', { code: 'asset_not_deleted' });
      await manager.update(AssetEntity, { id: asset.id }, { deletedAt: null });
      return { id: asset.id, deletedAt: null };
    });
  }

  /**
   * Post a set of Labels on an asset, replacing what it carried.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The asset
   * @param body - The complete list of Label ids
   * @returns The asset, with the Labels it now carries
   * @throws Error with status 403 without the manager role, 404 when the asset or a Label is absent
   */
  public async setLabels(actor: AuthContext, organizationId: string, id: string, body: SetLabelsBody): Promise<Asset> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<Asset> => {
      const asset: AssetEntity = await this.findOrFail(manager, organizationId, id);
      const posted: LabelSummary[] = await this.labels.setOn(
        manager,
        organizationId,
        RESOURCE_TYPE,
        asset.id,
        body.labelIds
      );
      return this.toAsset(asset, posted);
    });
  }

  /**
   * How many living creatives hold an asset through one of their versions.
   *
   * Asked of the link table joined to the versions and their creatives: a deleted creative does not
   * hold anything, which is what makes « delete the creative, then the asset » work.
   *
   * @param manager - The transaction to read in
   * @param assetId - The asset
   * @returns The number of distinct living creatives
   *
   * @example
   * ```typescript
   * await assetService.countHolders(manager, assetId);
   * ```
   */
  public async countHolders(manager: EntityManager, assetId: string): Promise<number> {
    const rows: { count: string }[] = await manager
      .createQueryBuilder(CreativeVersionAssetEntity, 'link')
      .select('COUNT(DISTINCT version.creative_id)', 'count')
      .innerJoin(CreativeVersionEntity, 'version', 'version.id = link.version_id')
      .innerJoin(CreativeEntity, 'creative', 'creative.id = version.creative_id AND creative.deleted_at IS NULL')
      .where('link.asset_id = :assetId', { assetId })
      .getRawMany();
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Repository of the assets table.
   *
   * @returns The repository
   */
  private repository(): Repository<AssetEntity> {
    return this.dataSource.getRepository(AssetEntity);
  }

  /**
   * Read what the bytes are, and refuse what the library does not take.
   *
   * An **image is verified**: its header gives its real type and its dimensions, so a PNG renamed
   * `.jpg` is stored for what it is and a file that does not read as an image is refused. A video, an
   * audio or a bundle is **declared**: measuring it would need tools the image does not carry, and no
   * check of ours replaces a platform's (`docs/phase-6.md` § 10).
   *
   * @param declared - The MIME type the client sent
   * @param data - The bytes
   * @returns What to store about them
   * @throws Error with status 400 coded `asset_type_unsupported` or `asset_unreadable`
   */
  private inspect(declared: string, data: Buffer): Inspection {
    const kind: AssetKind | undefined = ACCEPTED_MIME_TYPES[declared];
    if (!kind) {
      throw httpError(400, `The library does not accept ${declared || 'a file without a type'}`, {
        code: 'asset_type_unsupported',
        params: { mimeType: declared, accepted: Object.keys(ACCEPTED_MIME_TYPES).join(', ') },
      });
    }
    if (kind !== 'image') return { kind, mimeType: declared, width: null, height: null };

    let read: ReturnType<typeof imageSize>;
    try {
      read = imageSize(data);
    } catch {
      throw httpError(400, 'The file does not read as an image', {
        code: 'asset_unreadable',
        params: { mimeType: declared },
      });
    }
    // The header names the format; the inspector spells a JPEG `jpg`. A format it could read but the
    // library does not take — a BMP — is refused here rather than stored for nothing, and so is the
    // case it answers no type at all: `image/undefined` is in no list.
    const mimeType = `image/${read.type === 'jpg' ? 'jpeg' : String(read.type)}`;
    if (ACCEPTED_MIME_TYPES[mimeType] !== 'image') {
      throw httpError(400, 'The file does not read as an image the library accepts', {
        code: 'asset_unreadable',
        params: { mimeType: declared },
      });
    }
    return { kind, mimeType, width: read.width, height: read.height };
  }

  /**
   * Load an asset of an Organization.
   *
   * @param manager - Where to read
   * @param organizationId - The Organization it must belong to
   * @param id - The asset
   * @param options - Whether a deleted asset is accepted
   * @param options.deleted - `true` to also find a soft-deleted one
   * @returns The row
   * @throws Error with status 404 coded `asset_not_found`
   */
  private async findOrFail(
    manager: EntityManager,
    organizationId: string,
    id: string,
    options: { deleted?: boolean } = {}
  ): Promise<AssetEntity> {
    const asset: AssetEntity | null = await manager.findOne(AssetEntity, {
      where: { id, organizationId },
      withDeleted: options.deleted === true,
    });
    if (!asset) throw httpError(404, 'This asset does not exist', { code: 'asset_not_found' });
    return asset;
  }

  /**
   * The API shapes of several assets, each with its Labels and a download URL.
   *
   * One query for the Labels of the whole page (see `LabelService.summariesOf`), never one per row.
   *
   * @param manager - Where to read
   * @param rows - The rows
   * @returns Their API shapes, in the same order
   */
  private async toAssets(manager: EntityManager, rows: AssetEntity[]): Promise<Asset[]> {
    const byResource: Map<string, LabelSummary[]> = await this.labels.summariesOf(
      manager,
      RESOURCE_TYPE,
      rows.map((row: AssetEntity): string => row.id)
    );
    return Promise.all(rows.map((row: AssetEntity): Promise<Asset> => this.toAsset(row, byResource.get(row.id) ?? [])));
  }

  /**
   * Map an asset row to its API shape.
   *
   * @param entity - The row
   * @param labels - The Labels posted on it
   * @returns The API representation
   */
  private async toAsset(entity: AssetEntity, labels: LabelSummary[]): Promise<Asset> {
    return {
      id: entity.id,
      organizationId: entity.organizationId,
      advertiserId: entity.advertiserId,
      fileName: entity.fileName,
      kind: entity.kind,
      mimeType: entity.mimeType,
      sizeBytes: entity.sizeBytes,
      width: entity.width,
      height: entity.height,
      durationMs: entity.durationMs,
      fingerprint: entity.fingerprint,
      provenance: entity.provenance,
      aiGenerationId: entity.aiGenerationId,
      downloadUrl: await this.storage.downloadUrl(entity.storageKey),
      labels,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
      deletedAt: entity.deletedAt?.toISOString() ?? null,
    };
  }
}

/**
 * Fastify plugin that decorates the instance with an {@link AssetService}.
 *
 * Depends on `DatabasePlugin`, `AccessServicePlugin`, `LabelServicePlugin` and `StorageServicePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function assetServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate(
    'assetService',
    new AssetService(fastify.db, fastify.accessService, fastify.labelService, fastify.storageService)
  );
}

export default fastifyPlugin(assetServicePlugin, {
  name: 'AssetServicePlugin',
  dependencies: ['DatabasePlugin', 'AccessServicePlugin', 'LabelServicePlugin', 'StorageServicePlugin'],
});
