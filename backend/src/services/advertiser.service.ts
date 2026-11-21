import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource, EntityManager, IsNull, Repository, SelectQueryBuilder } from 'typeorm';

import { AdvertiserEntity } from '@src/database/entities';
import {
  Advertiser,
  BulkCreateAdvertisersBody,
  BulkUpdateAdvertisersBody,
  CreateAdvertiserBody,
  ListAdvertisersQuery,
  UpdateAdvertiserBody,
} from '@src/types/advertiser.types';
import { Paginated } from '@src/types/api.types';
import { AuthContext } from '@src/types/auth.types';
import { BulkIdsBody, BulkResult, DeletionResult, SetLabelsBody } from '@src/types/crud.types';
import { LabelSummary } from '@src/types/label.types';
import { escapeLike, httpError, toPage, toSkipTake, withoutAccents, withoutAccentsSql } from '@utils';
import { AccessService } from './access.service';
import { applyLabelFilter, runBulk, toOrder } from './crud.helpers';
import type { TrackingScheduler } from './conversion-goal.service';
import { assertDistinctIds, LabelService } from './label.service';

/** PostgreSQL error code of a unique constraint violation. */
const UNIQUE_VIOLATION = '23505';

/** The kind this resource is, as the label assignments store it. */
const RESOURCE_TYPE = 'advertiser';

/**
 * Map an Advertiser row to its API shape.
 *
 * @param entity - The row
 * @param labels - The Labels posted on it
 * @returns The API representation
 */
export function toAdvertiser(entity: AdvertiserEntity, labels: LabelSummary[] = []): Advertiser {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    name: entity.name,
    websiteUrl: entity.websiteUrl,
    labels,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
    deletedAt: entity.deletedAt?.toISOString() ?? null,
  };
}

/**
 * Manages the Advertisers (brands) of an Organization.
 *
 * Viewers read them; managers create, change, delete, restore and label them. It is the first
 * resource to follow the reference CRUD of `docs/phase-2.md`, and the shape the next phases copy:
 * the mechanics live in `crud.helpers.ts`, what stays here is what is specific to an Advertiser —
 * its unique name, and the Labels it carries.
 */
export class AdvertiserService {
  /**
   * Create the service.
   *
   * @param dataSource - Application database
   * @param access - Permission checks
   * @param labels - Posting and reading the Labels of a resource
   * @param tracking - Asks for the setup of an Advertiser's conversion tracking once it is renamed
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: AccessService,
    private readonly labels: LabelService,
    private readonly tracking: TrackingScheduler
  ) {}

  /**
   * List the Advertisers of an Organization.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param query - Page, sort, search, label filter, and whether the deleted ones are listed
   * @returns A page of Advertisers, each with its Labels
   * @throws Error with status 404 when the caller cannot see the Organization
   */
  public async list(
    actor: AuthContext,
    organizationId: string,
    query: ListAdvertisersQuery
  ): Promise<Paginated<Advertiser>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');

    const builder: SelectQueryBuilder<AdvertiserEntity> = this.repository()
      .createQueryBuilder('advertiser')
      .withDeleted()
      .where('advertiser.organization_id = :organizationId', { organizationId });
    if (!query.includeDeleted) builder.andWhere('advertiser.deleted_at IS NULL');
    if (query.search) {
      builder.andWhere(`${withoutAccentsSql('advertiser.name')} ILIKE :search`, {
        search: `%${escapeLike(withoutAccents(query.search))}%`,
      });
    }
    applyLabelFilter(builder, RESOURCE_TYPE, query.labelIds, query.labelMode);

    const { skip, take } = toSkipTake(query);
    for (const [field, direction] of Object.entries(toOrder(query.sortBy, query.sortOrder))) {
      builder.addOrderBy(`advertiser.${field}`, direction);
    }
    const [rows, total]: [AdvertiserEntity[], number] = await builder.skip(skip).take(take).getManyAndCount();
    return toPage(await this.withLabels(this.dataSource.manager, rows), total, query);
  }

  /**
   * Read one Advertiser.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Advertiser
   * @returns The Advertiser, with its Labels
   * @throws Error with status 404 when the caller cannot see it
   */
  public async get(actor: AuthContext, organizationId: string, id: string): Promise<Advertiser> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    const advertiser: AdvertiserEntity = await this.findOrFail(this.dataSource.manager, organizationId, id, {
      deleted: true,
    });
    const [withLabels]: Advertiser[] = await this.withLabels(this.dataSource.manager, [advertiser]);
    return withLabels;
  }

  /**
   * Create an Advertiser, with its Labels if any were given.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param body - Name, website and Labels
   * @returns The created Advertiser
   * @throws Error with status 403 without the manager role, 404 on an unknown Label, 409 when the name is taken
   */
  public async create(actor: AuthContext, organizationId: string, body: CreateAdvertiserBody): Promise<Advertiser> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction((manager: EntityManager): Promise<Advertiser> =>
      this.createOne(manager, organizationId, body)
    );
  }

  /**
   * Change an Advertiser. A field left out is left alone; `websiteUrl: null` clears the website.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Advertiser
   * @param body - Fields to change
   * @returns The updated Advertiser
   * @throws Error with status 403 without the manager role, 404 when absent, 409 when the name is taken
   */
  public async update(
    actor: AuthContext,
    organizationId: string,
    id: string,
    body: UpdateAdvertiserBody
  ): Promise<Advertiser> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction((manager: EntityManager): Promise<Advertiser> =>
      this.updateOne(manager, organizationId, id, body)
    );
  }

  /**
   * Soft-delete an Advertiser.
   *
   * Its Labels stay posted, so restoring it brings them back. The phase that gives an Advertiser
   * children (campaigns, creatives) adds the cascade here.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Advertiser
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
   * Restore a soft-deleted Advertiser.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Advertiser
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
   * Post a set of Labels on an Advertiser, replacing what it carried.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Advertiser
   * @param body - The complete list of Label ids
   * @returns The Advertiser, with the Labels it now carries
   * @throws Error with status 403 without the manager role, 404 when the Advertiser or a Label is absent
   */
  public async setLabels(
    actor: AuthContext,
    organizationId: string,
    id: string,
    body: SetLabelsBody
  ): Promise<Advertiser> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<Advertiser> => {
      const advertiser: AdvertiserEntity = await this.findOrFail(manager, organizationId, id);
      const posted: LabelSummary[] = await this.labels.setOn(
        manager,
        organizationId,
        RESOURCE_TYPE,
        advertiser.id,
        body.labelIds
      );
      return toAdvertiser(advertiser, posted);
    });
  }

  /**
   * Create several Advertisers, atomically or item by item.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param body - The mode and the items
   * @returns What was created, and what was not
   * @throws Error with status 403 without the manager role, or the first failure in `atomic` mode
   */
  public async bulkCreate(
    actor: AuthContext,
    organizationId: string,
    body: BulkCreateAdvertisersBody
  ): Promise<BulkResult<Advertiser>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return runBulk(
      this.dataSource,
      body.mode,
      body.items,
      (item: CreateAdvertiserBody, _index, manager: EntityManager) => this.createOne(manager, organizationId, item)
    );
  }

  /**
   * Change several Advertisers, atomically or item by item.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param body - The mode and the items, each naming the Advertiser it changes
   * @returns What was changed, and what was not
   * @throws Error with status 403 without the manager role, 400 on a duplicated id, or the first failure in `atomic`
   */
  public async bulkUpdate(
    actor: AuthContext,
    organizationId: string,
    body: BulkUpdateAdvertisersBody
  ): Promise<BulkResult<Advertiser>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    assertDistinctIds(body.items.map((item: { id: string }): string => item.id));
    return runBulk(this.dataSource, body.mode, body.items, ({ id, ...changes }, _index, manager: EntityManager) =>
      this.updateOne(manager, organizationId, id, changes)
    );
  }

  /**
   * Soft-delete several Advertisers, atomically or item by item.
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
   * Restore several Advertisers, atomically or item by item.
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
   * Repository of the Advertisers table.
   *
   * @returns The repository
   */
  private repository(): Repository<AdvertiserEntity> {
    return this.dataSource.getRepository(AdvertiserEntity);
  }

  /**
   * Create one Advertiser inside a transaction, with its Labels.
   *
   * @param manager - The transaction
   * @param organizationId - The Organization
   * @param body - Name, website and Labels
   * @returns The created Advertiser
   * @throws Error with status 404 on an unknown Label, 409 when the name is taken
   */
  private async createOne(
    manager: EntityManager,
    organizationId: string,
    body: CreateAdvertiserBody
  ): Promise<Advertiser> {
    await this.assertNameFree(manager, organizationId, body.name);
    const created: AdvertiserEntity = await this.save(
      manager,
      manager.create(AdvertiserEntity, {
        organizationId,
        name: body.name,
        websiteUrl: body.websiteUrl ?? null,
      }),
      body.name
    );
    const posted: LabelSummary[] = body.labelIds?.length
      ? await this.labels.setOn(manager, organizationId, RESOURCE_TYPE, created.id, body.labelIds)
      : [];
    return toAdvertiser(created, posted);
  }

  /**
   * Change one Advertiser inside a transaction.
   *
   * @param manager - The transaction
   * @param organizationId - The Organization
   * @param id - The Advertiser
   * @param body - Fields to change
   * @returns The updated Advertiser
   * @throws Error with status 404 when absent, 409 when the name is taken
   */
  private async updateOne(
    manager: EntityManager,
    organizationId: string,
    id: string,
    body: UpdateAdvertiserBody
  ): Promise<Advertiser> {
    const advertiser: AdvertiserEntity = await this.findOrFail(manager, organizationId, id);
    const renamed: boolean = body.name !== undefined && body.name !== advertiser.name;
    if (renamed) {
      await this.assertNameFree(manager, organizationId, body.name as string);
      advertiser.name = body.name as string;
    }
    if (body.websiteUrl !== undefined) advertiser.websiteUrl = body.websiteUrl;
    const saved: AdvertiserEntity = await this.save(manager, advertiser, advertiser.name);
    // Its name is part of the names of its conversion goals at the platforms (`docs/phase-10.md` § 8.10).
    if (renamed) await this.tracking.request(saved.id);
    const [withLabels]: Advertiser[] = await this.withLabels(manager, [saved]);
    return withLabels;
  }

  /**
   * Soft-delete one Advertiser inside a transaction.
   *
   * @param manager - The transaction
   * @param organizationId - The Organization
   * @param id - The Advertiser
   * @returns Its id and when it was deleted
   * @throws Error with status 404 when absent
   */
  private async deleteOne(manager: EntityManager, organizationId: string, id: string): Promise<DeletionResult> {
    const advertiser: AdvertiserEntity = await this.findOrFail(manager, organizationId, id);
    const deletedAt = new Date();
    await manager.update(AdvertiserEntity, { id: advertiser.id }, { deletedAt });
    return { id: advertiser.id, deletedAt: deletedAt.toISOString() };
  }

  /**
   * Restore one Advertiser inside a transaction.
   *
   * @param manager - The transaction
   * @param organizationId - The Organization
   * @param id - The Advertiser
   * @returns Its id, with `deletedAt` back to `null`
   * @throws Error with status 404 when absent, 409 when it is not deleted or its name is taken again
   */
  private async restoreOne(manager: EntityManager, organizationId: string, id: string): Promise<DeletionResult> {
    const advertiser: AdvertiserEntity = await this.findOrFail(manager, organizationId, id, { deleted: true });
    if (!advertiser.deletedAt) {
      throw httpError(409, 'This advertiser is not deleted', { code: 'advertiser_not_deleted' });
    }
    await this.assertNameFree(manager, organizationId, advertiser.name);
    await manager.update(AdvertiserEntity, { id: advertiser.id }, { deletedAt: null });
    return { id: advertiser.id, deletedAt: null };
  }

  /**
   * Load an Advertiser of an Organization.
   *
   * @param manager - Where to read
   * @param organizationId - The Organization it must belong to
   * @param id - The Advertiser
   * @param options - Whether a deleted Advertiser is accepted
   * @param options.deleted - `true` to also find a soft-deleted one
   * @returns The row
   * @throws Error with status 404 when absent, of another Organization, or deleted while not accepted
   */
  private async findOrFail(
    manager: EntityManager,
    organizationId: string,
    id: string,
    options: { deleted?: boolean } = {}
  ): Promise<AdvertiserEntity> {
    const advertiser: AdvertiserEntity | null = await manager.findOne(AdvertiserEntity, {
      where: { id, organizationId },
      withDeleted: options.deleted === true,
    });
    if (!advertiser) throw httpError(404, 'Advertiser not found', { code: 'advertiser_not_found' });
    return advertiser;
  }

  /**
   * Refuse a name a live Advertiser of the Organization already carries.
   *
   * @param manager - Where to read
   * @param organizationId - The Organization
   * @param name - The name wanted
   * @returns Nothing
   * @throws Error with status 409 coded `advertiser_name_taken`
   */
  private async assertNameFree(manager: EntityManager, organizationId: string, name: string): Promise<void> {
    const taken: boolean = await manager.exists(AdvertiserEntity, {
      where: { organizationId, name, deletedAt: IsNull() },
    });
    if (taken) {
      throw httpError(409, `An advertiser named ${name} already exists in this Organization`, {
        code: 'advertiser_name_taken',
        params: { name },
      });
    }
  }

  /**
   * Save an Advertiser, turning a lost race on its name into the same 409 as the check before it.
   *
   * @param manager - The transaction
   * @param advertiser - The row to save
   * @param name - The name being written, for the message
   * @returns The saved row
   * @throws Error with status 409 when the unique index refused it
   */
  private async save(manager: EntityManager, advertiser: AdvertiserEntity, name: string): Promise<AdvertiserEntity> {
    try {
      return await manager.save(AdvertiserEntity, advertiser);
    } catch (error: unknown) {
      if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
      throw httpError(409, `An advertiser named ${name} already exists in this Organization`, {
        code: 'advertiser_name_taken',
        params: { name },
        cause: error,
      });
    }
  }

  /**
   * The API shapes of several Advertisers, each with the Labels posted on it.
   *
   * One query for the whole page (see `LabelService.summariesOf`), never one per row.
   *
   * @param manager - Where to read
   * @param rows - The rows
   * @returns Their API shapes, in the same order
   */
  private async withLabels(manager: EntityManager, rows: AdvertiserEntity[]): Promise<Advertiser[]> {
    const byResource: Map<string, LabelSummary[]> = await this.labels.summariesOf(
      manager,
      RESOURCE_TYPE,
      rows.map((row: AdvertiserEntity): string => row.id)
    );
    return rows.map((row: AdvertiserEntity): Advertiser => toAdvertiser(row, byResource.get(row.id) ?? []));
  }
}

/**
 * Fastify plugin that decorates the instance with an {@link AdvertiserService}.
 *
 * Depends on `DatabasePlugin`, `AccessServicePlugin`, `LabelServicePlugin` and `TrackingServicePlugin` (its
 * scheduler).
 *
 * @param fastify - The Fastify instance to decorate
 */
async function advertiserServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate(
    'advertiserService',
    new AdvertiserService(fastify.db, fastify.accessService, fastify.labelService, fastify.trackingScheduler)
  );
}

export default fastifyPlugin(advertiserServicePlugin, {
  name: 'AdvertiserServicePlugin',
  dependencies: ['DatabasePlugin', 'AccessServicePlugin', 'LabelServicePlugin', 'TrackingServicePlugin'],
});
