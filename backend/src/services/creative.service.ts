import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource, EntityManager, In, IsNull, Repository, SelectQueryBuilder } from 'typeorm';

import { assertRoles, parsePayload } from '@src/creatives/creative-formats';
import { AssetEntity, CreativeEntity, CreativeVersionAssetEntity, CreativeVersionEntity } from '@src/database/entities';
import {
  AssetRole,
  AuthContext,
  BulkCreateCreativesBody,
  BulkIdsBody,
  BulkResult,
  BulkUpdateCreativesBody,
  CreateCreativeBody,
  CreateCreativeVersionBody,
  Creative,
  CreativeVersion,
  DeletionResult,
  LabelSummary,
  ListCreativeVersionsQuery,
  ListCreativesQuery,
  Paginated,
  SetLabelsBody,
  UpdateCreativeBody,
  VersionAsset,
} from '@src/types';
import { escapeLike, httpError, toPage, toSkipTake, withoutAccents, withoutAccentsSql } from '@utils';
import { AccessService } from './access.service';
import { runBulk, toOrder } from './crud.helpers';
import { assertDistinctIds, LabelService } from './label.service';

/** The kind this resource is, as the label assignments store it. */
const RESOURCE_TYPE = 'creative';

/**
 * Manages the creatives of an Advertiser's library, and their versions.
 *
 * A creative is **never the bytes** (`../../CADRAGE.md` § 9): it says what inventory it aims at
 * (`format`) and how it reaches a platform (`subtype`), and its **versions** carry what is frozen —
 * a payload, assets by role, trackers.
 *
 * A version is **immutable** (`docs/phase-6.md` § 4): it is never updated and never deleted, a
 * change being a new version, so a creative that delivers can change without interrupting delivery
 * while the platforms revalidate. The creative points at the version that delivers; activating is
 * explicit here, and the synchronization will drive it from the platforms' approval.
 *
 * What a couple accepts is the registry (`src/creatives/creative-formats.ts`), the only judge of a
 * payload and of the asset roles: no `if` on a format anywhere in this service.
 */
export class CreativeService {
  /**
   * Create the service.
   *
   * @param dataSource - Application database
   * @param access - Permission checks
   * @param labels - Posting and reading the Labels of a resource
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: AccessService,
    private readonly labels: LabelService
  ) {}

  /**
   * List the creatives of an Advertiser.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param advertiserId - The Advertiser whose library is read
   * @param query - Page, sort, search, couple, labels, and whether the deleted ones are listed
   * @returns A page of creatives, each with its active version
   * @throws Error with status 404 when the caller cannot see the Organization
   */
  public async list(
    actor: AuthContext,
    organizationId: string,
    advertiserId: string,
    query: ListCreativesQuery
  ): Promise<Paginated<Creative>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');

    const builder: SelectQueryBuilder<CreativeEntity> = this.repository()
      .createQueryBuilder('creative')
      .withDeleted()
      .where('creative.organization_id = :organizationId', { organizationId })
      .andWhere('creative.advertiser_id = :advertiserId', { advertiserId });
    if (!query.includeDeleted) builder.andWhere('creative.deleted_at IS NULL');
    if (query.format) builder.andWhere('creative.format = :format', { format: query.format });
    if (query.subtype) builder.andWhere('creative.subtype = :subtype', { subtype: query.subtype });
    if (query.search) {
      builder.andWhere(`${withoutAccentsSql('creative.name')} ILIKE :search`, {
        search: `%${escapeLike(withoutAccents(query.search))}%`,
      });
    }

    const { skip, take } = toSkipTake(query);
    for (const [field, direction] of Object.entries(toOrder(query.sortBy, query.sortOrder))) {
      builder.addOrderBy(`creative.${field}`, direction);
    }
    const [rows, total]: [CreativeEntity[], number] = await builder.skip(skip).take(take).getManyAndCount();
    return toPage(await this.toCreatives(this.dataSource.manager, rows), total, query);
  }

  /**
   * Read one creative, with its active version.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The creative
   * @returns The creative
   * @throws Error with status 404 when the caller cannot see it
   */
  public async get(actor: AuthContext, organizationId: string, id: string): Promise<Creative> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    const creative: CreativeEntity = await this.findOrFail(this.dataSource.manager, organizationId, id, {
      deleted: true,
    });
    const [answered]: Creative[] = await this.toCreatives(this.dataSource.manager, [creative]);
    return answered;
  }

  /**
   * Create a creative **and its first version**, which is active at once.
   *
   * A creative without a version would carry nothing, so the two are born together — and there is
   * nothing the first version could interrupt.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param advertiserId - The Advertiser whose library it joins
   * @param body - The creative, and its first version
   * @returns The created creative, with that version active
   * @throws Error with status 403 without the manager role, 404 on an unknown Label or asset, 400 on
   *   an unknown couple, a payload that does not hold, or a missing asset role
   */
  public async create(
    actor: AuthContext,
    organizationId: string,
    advertiserId: string,
    body: CreateCreativeBody
  ): Promise<Creative> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction((manager: EntityManager): Promise<Creative> =>
      this.createOne(manager, organizationId, advertiserId, body)
    );
  }

  /**
   * Change what stays true across versions: the name, the IAB categories, the click URL.
   *
   * Neither the format nor the subtype is changeable: every version's payload was written against
   * them, so changing one would invalidate the whole history — that is a new creative.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The creative
   * @param body - Fields to change
   * @returns The updated creative
   * @throws Error with status 403 without the manager role, 404 when absent
   */
  public async update(
    actor: AuthContext,
    organizationId: string,
    id: string,
    body: UpdateCreativeBody
  ): Promise<Creative> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction((manager: EntityManager): Promise<Creative> =>
      this.updateOne(manager, organizationId, id, body)
    );
  }

  /**
   * Soft-delete a creative, its versions hidden with it.
   *
   * The assets **survive**: an asset is a resource of its own, not an attachment, and deleting the
   * creative is precisely what frees them (`docs/phase-6.md` § 10).
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The creative
   * @returns Its id and when it was deleted
   * @throws Error with status 403 without the manager role, 404 when absent
   */
  public async delete(actor: AuthContext, organizationId: string, id: string): Promise<DeletionResult> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction((manager: EntityManager): Promise<DeletionResult> =>
      this.deleteOne(manager, organizationId, id)
    );
  }

  /**
   * Restore a soft-deleted creative.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The creative
   * @returns Its id, with `deletedAt` back to `null`
   * @throws Error with status 403 without the manager role, 404 when absent, 409 when it is not deleted
   */
  public async restore(actor: AuthContext, organizationId: string, id: string): Promise<DeletionResult> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction((manager: EntityManager): Promise<DeletionResult> =>
      this.restoreOne(manager, organizationId, id)
    );
  }

  /**
   * Post a set of Labels on a creative, replacing what it carried.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The creative
   * @param body - The complete list of Label ids
   * @returns The creative, with the Labels it now carries
   * @throws Error with status 403 without the manager role, 404 when the creative or a Label is absent
   */
  public async setLabels(
    actor: AuthContext,
    organizationId: string,
    id: string,
    body: SetLabelsBody
  ): Promise<Creative> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<Creative> => {
      const creative: CreativeEntity = await this.findOrFail(manager, organizationId, id);
      await this.labels.setOn(manager, organizationId, RESOURCE_TYPE, creative.id, body.labelIds);
      const [answered]: Creative[] = await this.toCreatives(manager, [creative]);
      return answered;
    });
  }

  /**
   * List the versions of a creative, the most recent first.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param creativeId - The creative
   * @param query - Page
   * @returns A page of versions
   * @throws Error with status 404 when the caller cannot see the creative
   */
  public async listVersions(
    actor: AuthContext,
    organizationId: string,
    creativeId: string,
    query: ListCreativeVersionsQuery
  ): Promise<Paginated<CreativeVersion>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    const creative: CreativeEntity = await this.findOrFail(this.dataSource.manager, organizationId, creativeId, {
      deleted: true,
    });

    const [rows, total]: [CreativeVersionEntity[], number] = await this.dataSource.manager.findAndCount(
      CreativeVersionEntity,
      { where: { organizationId, creativeId }, order: { version: 'DESC' }, ...toSkipTake(query) }
    );
    return toPage(await this.toVersions(this.dataSource.manager, rows, creative.activeVersionId), total, query);
  }

  /**
   * Read one version.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The version
   * @returns The version, with its assets
   * @throws Error with status 404 when the caller cannot see it
   */
  public async getVersion(actor: AuthContext, organizationId: string, id: string): Promise<CreativeVersion> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    const version: CreativeVersionEntity = await this.versionOrFail(this.dataSource.manager, organizationId, id);
    const creative: CreativeEntity = await this.findOrFail(
      this.dataSource.manager,
      organizationId,
      version.creativeId,
      { deleted: true }
    );
    const [answered]: CreativeVersion[] = await this.toVersions(
      this.dataSource.manager,
      [version],
      creative.activeVersionId
    );
    return answered;
  }

  /**
   * Add a version to a creative. Nothing existing is touched.
   *
   * The new version is **not** active: the one that delivers keeps delivering until it is activated,
   * which is the whole point of the versioned model.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param creativeId - The creative
   * @param body - The payload, the assets and the trackers
   * @returns The created version
   * @throws Error with status 403 without the manager role, 404 when the creative or an asset is
   *   absent, 400 on a payload that does not hold or a missing asset role
   */
  public async createVersion(
    actor: AuthContext,
    organizationId: string,
    creativeId: string,
    body: CreateCreativeVersionBody
  ): Promise<CreativeVersion> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<CreativeVersion> => {
      const creative: CreativeEntity = await this.findOrFail(manager, organizationId, creativeId);
      const version: CreativeVersionEntity = await this.addVersion(manager, creative, body);
      const [answered]: CreativeVersion[] = await this.toVersions(manager, [version], creative.activeVersionId);
      return answered;
    });
  }

  /**
   * Put a version in delivery.
   *
   * Explicit in this phase: no platform validates yet, so nothing else could decide. When the
   * synchronization lands, a platform's approval drives this very column (`docs/phase-6.md` § 4).
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The version
   * @returns The version, now active
   * @throws Error with status 403 without the manager role, 404 when absent
   */
  public async activateVersion(actor: AuthContext, organizationId: string, id: string): Promise<CreativeVersion> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<CreativeVersion> => {
      const version: CreativeVersionEntity = await this.versionOrFail(manager, organizationId, id);
      await this.findOrFail(manager, organizationId, version.creativeId);
      await manager.update(CreativeEntity, { id: version.creativeId }, { activeVersionId: version.id });
      const [answered]: CreativeVersion[] = await this.toVersions(manager, [version], version.id);
      return answered;
    });
  }

  /**
   * Create several creatives, atomically or item by item.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param advertiserId - The Advertiser whose library they join
   * @param body - The mode and the items
   * @returns What was created, and what was not
   * @throws Error with status 403 without the manager role, or the first failure in `atomic` mode
   */
  public async bulkCreate(
    actor: AuthContext,
    organizationId: string,
    advertiserId: string,
    body: BulkCreateCreativesBody
  ): Promise<BulkResult<Creative>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return runBulk(this.dataSource, body.mode, body.items, (item: CreateCreativeBody, _index, manager: EntityManager) =>
      this.createOne(manager, organizationId, advertiserId, item)
    );
  }

  /**
   * Change several creatives, atomically or item by item.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param body - The mode and the items, each naming the creative it changes
   * @returns What was changed, and what was not
   * @throws Error with status 403 without the manager role, 400 on a duplicated id, or the first failure in `atomic`
   */
  public async bulkUpdate(
    actor: AuthContext,
    organizationId: string,
    body: BulkUpdateCreativesBody
  ): Promise<BulkResult<Creative>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    assertDistinctIds(body.items.map((item: { id: string }): string => item.id));
    return runBulk(this.dataSource, body.mode, body.items, ({ id, ...changes }, _index, manager: EntityManager) =>
      this.updateOne(manager, organizationId, id, changes)
    );
  }

  /**
   * Soft-delete several creatives, atomically or item by item.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param body - The mode and the ids
   * @returns What was deleted, and what was not
   * @throws Error with status 403 without the manager role, 400 on a duplicated id, or the first failure in `atomic`
   */
  public async bulkDelete(
    actor: AuthContext,
    organizationId: string,
    body: BulkIdsBody
  ): Promise<BulkResult<DeletionResult>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    assertDistinctIds(body.ids);
    return runBulk(this.dataSource, body.mode, body.ids, (id: string, _index, manager: EntityManager) =>
      this.deleteOne(manager, organizationId, id)
    );
  }

  /**
   * Restore several creatives, atomically or item by item.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param body - The mode and the ids
   * @returns What was restored, and what was not
   * @throws Error with status 403 without the manager role, 400 on a duplicated id, or the first failure in `atomic`
   */
  public async bulkRestore(
    actor: AuthContext,
    organizationId: string,
    body: BulkIdsBody
  ): Promise<BulkResult<DeletionResult>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    assertDistinctIds(body.ids);
    return runBulk(this.dataSource, body.mode, body.ids, (id: string, _index, manager: EntityManager) =>
      this.restoreOne(manager, organizationId, id)
    );
  }

  /**
   * Repository of the creatives table.
   *
   * @returns The repository
   */
  private repository(): Repository<CreativeEntity> {
    return this.dataSource.getRepository(CreativeEntity);
  }

  /**
   * Create one creative and its first version inside a transaction.
   *
   * @param manager - The transaction
   * @param organizationId - The Organization
   * @param advertiserId - The Advertiser
   * @param body - The creative and its first version
   * @returns The created creative
   * @throws Error with status 400 on an unknown couple or a version that does not hold
   */
  private async createOne(
    manager: EntityManager,
    organizationId: string,
    advertiserId: string,
    body: CreateCreativeBody
  ): Promise<Creative> {
    const created: CreativeEntity = await manager.save(
      CreativeEntity,
      manager.create(CreativeEntity, {
        organizationId,
        advertiserId,
        name: body.name,
        format: body.format,
        subtype: body.subtype,
        iabCategories: body.iabCategories ?? [],
        iabTaxonomyVersion: body.iabTaxonomyVersion ?? null,
        clickThroughUrl: body.clickThroughUrl ?? null,
        activeVersionId: null,
      })
    );
    const version: CreativeVersionEntity = await this.addVersion(manager, created, body.version);
    // The first version has nothing to interrupt, so it delivers at once.
    await manager.update(CreativeEntity, { id: created.id }, { activeVersionId: version.id });
    created.activeVersionId = version.id;
    const posted: LabelSummary[] = body.labelIds?.length
      ? await this.labels.setOn(manager, organizationId, RESOURCE_TYPE, created.id, body.labelIds)
      : [];
    return this.toCreative(created, await this.toVersions(manager, [version], version.id), 1, posted);
  }

  /**
   * Change one creative inside a transaction.
   *
   * @param manager - The transaction
   * @param organizationId - The Organization
   * @param id - The creative
   * @param body - Fields to change
   * @returns The updated creative
   * @throws Error with status 404 when absent
   */
  private async updateOne(
    manager: EntityManager,
    organizationId: string,
    id: string,
    body: UpdateCreativeBody
  ): Promise<Creative> {
    const creative: CreativeEntity = await this.findOrFail(manager, organizationId, id);
    if (body.name !== undefined) creative.name = body.name;
    if (body.iabCategories !== undefined) creative.iabCategories = body.iabCategories;
    if (body.iabTaxonomyVersion !== undefined) creative.iabTaxonomyVersion = body.iabTaxonomyVersion;
    if (body.clickThroughUrl !== undefined) creative.clickThroughUrl = body.clickThroughUrl;
    await manager.save(CreativeEntity, creative);
    const [answered]: Creative[] = await this.toCreatives(manager, [creative]);
    return answered;
  }

  /**
   * Soft-delete one creative inside a transaction.
   *
   * @param manager - The transaction
   * @param organizationId - The Organization
   * @param id - The creative
   * @returns Its id and when it was deleted
   * @throws Error with status 404 when absent
   */
  private async deleteOne(manager: EntityManager, organizationId: string, id: string): Promise<DeletionResult> {
    const creative: CreativeEntity = await this.findOrFail(manager, organizationId, id);
    const deletedAt = new Date();
    await manager.update(CreativeEntity, { id: creative.id }, { deletedAt });
    return { id: creative.id, deletedAt: deletedAt.toISOString() };
  }

  /**
   * Restore one creative inside a transaction.
   *
   * @param manager - The transaction
   * @param organizationId - The Organization
   * @param id - The creative
   * @returns Its id, with `deletedAt` back to `null`
   * @throws Error with status 404 when absent, 409 when it is not deleted
   */
  private async restoreOne(manager: EntityManager, organizationId: string, id: string): Promise<DeletionResult> {
    const creative: CreativeEntity = await this.findOrFail(manager, organizationId, id, { deleted: true });
    if (!creative.deletedAt) {
      throw httpError(409, 'This creative is not deleted', { code: 'creative_not_deleted' });
    }
    await manager.update(CreativeEntity, { id: creative.id }, { deletedAt: null });
    return { id: creative.id, deletedAt: null };
  }

  /**
   * Write a version of a creative: judge it, store it, link its assets.
   *
   * The registry is the only judge of the payload and of the roles, and the assets must belong to the
   * **same Advertiser** — an asset of another brand in a creative would be a leak across libraries.
   *
   * @param manager - The transaction
   * @param creative - The creative it belongs to
   * @param body - The payload, the assets and the trackers
   * @returns The stored row
   * @throws Error with status 400 on a payload that does not hold, a missing or unknown role, or an
   *   asset of another Advertiser; 404 when an asset is absent
   */
  private async addVersion(
    manager: EntityManager,
    creative: CreativeEntity,
    body: CreateCreativeVersionBody
  ): Promise<CreativeVersionEntity> {
    const payload: object = parsePayload(creative.format, creative.subtype, body.payload);
    assertRoles(
      creative.format,
      creative.subtype,
      body.assets.map((asset: VersionAsset): AssetRole => asset.role)
    );
    await this.assertAssetsBelong(manager, creative.advertiserId, body.assets);

    const last: number = await manager.count(CreativeVersionEntity, { where: { creativeId: creative.id } });
    const version: CreativeVersionEntity = await manager.save(
      CreativeVersionEntity,
      manager.create(CreativeVersionEntity, {
        organizationId: creative.organizationId,
        creativeId: creative.id,
        version: last + 1,
        payload,
        trackers: body.trackers,
      })
    );
    if (body.assets.length > 0) {
      await manager.insert(
        CreativeVersionAssetEntity,
        body.assets.map((asset: VersionAsset) => ({
          versionId: version.id,
          assetId: asset.assetId,
          role: asset.role,
        }))
      );
    }
    return version;
  }

  /**
   * Refuse an asset that is absent, or that belongs to another Advertiser.
   *
   * @param manager - The transaction
   * @param advertiserId - The Advertiser of the creative
   * @param assets - The assets the version claims
   * @returns Nothing
   * @throws Error with status 404 coded `asset_not_found`, 400 coded `asset_other_advertiser`
   */
  private async assertAssetsBelong(
    manager: EntityManager,
    advertiserId: string,
    assets: VersionAsset[]
  ): Promise<void> {
    const wanted: string[] = [...new Set(assets.map((asset: VersionAsset): string => asset.assetId))];
    if (wanted.length === 0) return;

    const rows: AssetEntity[] = await manager.find(AssetEntity, {
      where: { id: In(wanted), deletedAt: IsNull() },
    });
    const byId = new Map<string, AssetEntity>(rows.map((row: AssetEntity): [string, AssetEntity] => [row.id, row]));
    for (const assetId of wanted) {
      const asset: AssetEntity | undefined = byId.get(assetId);
      if (!asset) throw httpError(404, 'This asset does not exist', { code: 'asset_not_found' });
      if (asset.advertiserId !== advertiserId) {
        throw httpError(400, 'This asset belongs to another Advertiser', {
          code: 'asset_other_advertiser',
          params: { assetId, advertiserId: asset.advertiserId },
        });
      }
    }
  }

  /**
   * Load a creative of an Organization.
   *
   * @param manager - Where to read
   * @param organizationId - The Organization it must belong to
   * @param id - The creative
   * @param options - Whether a deleted creative is accepted
   * @param options.deleted - `true` to also find a soft-deleted one
   * @returns The row
   * @throws Error with status 404 coded `creative_not_found`
   */
  private async findOrFail(
    manager: EntityManager,
    organizationId: string,
    id: string,
    options: { deleted?: boolean } = {}
  ): Promise<CreativeEntity> {
    const creative: CreativeEntity | null = await manager.findOne(CreativeEntity, {
      where: { id, organizationId },
      withDeleted: options.deleted === true,
    });
    if (!creative) throw httpError(404, 'This creative does not exist', { code: 'creative_not_found' });
    return creative;
  }

  /**
   * Load a version of an Organization.
   *
   * @param manager - Where to read
   * @param organizationId - The Organization it must belong to
   * @param id - The version
   * @returns The row
   * @throws Error with status 404 coded `creative_version_not_found`
   */
  private async versionOrFail(
    manager: EntityManager,
    organizationId: string,
    id: string
  ): Promise<CreativeVersionEntity> {
    const version: CreativeVersionEntity | null = await manager.findOne(CreativeVersionEntity, {
      where: { id, organizationId },
    });
    if (!version) {
      throw httpError(404, 'This creative version does not exist', { code: 'creative_version_not_found' });
    }
    return version;
  }

  /**
   * The API shapes of several creatives, each with its active version and its Labels.
   *
   * Two queries for the whole page — the active versions, then the counts — never one per row.
   *
   * @param manager - Where to read
   * @param rows - The rows
   * @returns Their API shapes, in the same order
   */
  private async toCreatives(manager: EntityManager, rows: CreativeEntity[]): Promise<Creative[]> {
    if (rows.length === 0) return [];
    const ids: string[] = rows.map((row: CreativeEntity): string => row.id);
    const versions: CreativeVersionEntity[] = await manager.find(CreativeVersionEntity, {
      where: { creativeId: In(ids) },
    });
    const answered: CreativeVersion[] = await this.toVersions(manager, versions, null);
    const byId = new Map<string, CreativeVersion>(
      answered.map((version: CreativeVersion): [string, CreativeVersion] => [version.id, version])
    );
    const counts = new Map<string, number>();
    for (const version of versions) counts.set(version.creativeId, (counts.get(version.creativeId) ?? 0) + 1);
    const byResource: Map<string, LabelSummary[]> = await this.labels.summariesOf(manager, RESOURCE_TYPE, ids);

    return rows.map((row: CreativeEntity): Creative => {
      const active: CreativeVersion | undefined =
        row.activeVersionId === null ? undefined : byId.get(row.activeVersionId);
      return this.toCreative(
        row,
        active ? [{ ...active, active: true }] : [],
        counts.get(row.id) ?? 0,
        byResource.get(row.id) ?? []
      );
    });
  }

  /**
   * Map a creative row to its API shape.
   *
   * @param entity - The row
   * @param active - Its active version, as a list of none or one
   * @param versionCount - How many versions it holds
   * @param labels - The Labels posted on it
   * @returns The API representation
   */
  private toCreative(
    entity: CreativeEntity,
    active: CreativeVersion[],
    versionCount: number,
    labels: LabelSummary[]
  ): Creative {
    return {
      id: entity.id,
      organizationId: entity.organizationId,
      advertiserId: entity.advertiserId,
      name: entity.name,
      format: entity.format,
      subtype: entity.subtype,
      iabCategories: entity.iabCategories,
      iabTaxonomyVersion: entity.iabTaxonomyVersion,
      clickThroughUrl: entity.clickThroughUrl,
      activeVersion: active[0] ?? null,
      versionCount,
      labels,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
      deletedAt: entity.deletedAt?.toISOString() ?? null,
    };
  }

  /**
   * The API shapes of several versions, each with the assets it uses.
   *
   * One query for the links of the whole page, never one per version.
   *
   * @param manager - Where to read
   * @param rows - The rows
   * @param activeVersionId - The version that delivers, when it is known
   * @returns Their API shapes, in the same order
   */
  private async toVersions(
    manager: EntityManager,
    rows: CreativeVersionEntity[],
    activeVersionId: string | null
  ): Promise<CreativeVersion[]> {
    if (rows.length === 0) return [];
    const links: CreativeVersionAssetEntity[] = await manager.find(CreativeVersionAssetEntity, {
      where: { versionId: In(rows.map((row: CreativeVersionEntity): string => row.id)) },
    });
    const byVersion = new Map<string, VersionAsset[]>();
    for (const link of links) {
      byVersion.set(link.versionId, [
        ...(byVersion.get(link.versionId) ?? []),
        { role: link.role, assetId: link.assetId },
      ]);
    }
    return rows.map((row: CreativeVersionEntity): CreativeVersion => ({
      id: row.id,
      creativeId: row.creativeId,
      version: row.version,
      payload: row.payload as Record<string, unknown>,
      assets: byVersion.get(row.id) ?? [],
      trackers: row.trackers,
      active: row.id === activeVersionId,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}

/**
 * Fastify plugin that decorates the instance with a {@link CreativeService}.
 *
 * Depends on `DatabasePlugin`, `AccessServicePlugin` and `LabelServicePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function creativeServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('creativeService', new CreativeService(fastify.db, fastify.accessService, fastify.labelService));
}

export default fastifyPlugin(creativeServicePlugin, {
  name: 'CreativeServicePlugin',
  dependencies: ['DatabasePlugin', 'AccessServicePlugin', 'LabelServicePlugin'],
});
