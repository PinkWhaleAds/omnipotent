import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource, EntityManager, In, IsNull, Repository, SelectQueryBuilder } from 'typeorm';

import { LabelAssignmentEntity, LabelEntity } from '@src/database/entities';
import { Paginated } from '@src/types/api.types';
import { AuthContext } from '@src/types/auth.types';
import { BulkIdsBody, BulkResult, DeletionResult } from '@src/types/crud.types';
import {
  BulkCreateLabelsBody,
  BulkUpdateLabelsBody,
  CreateLabelBody,
  Label,
  LabelResourceType,
  LabelSummary,
  LabelledResource,
  ListLabelsQuery,
  UpdateLabelBody,
} from '@src/types/label.types';
import { escapeLike, httpError, toPage, toSkipTake, withoutAccents, withoutAccentsSql } from '@utils';
import { AccessService } from './access.service';
import { runBulk, toOrder } from './crud.helpers';

/** PostgreSQL error code of a unique constraint violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Map a Label row to its API shape.
 *
 * @param entity - The row
 * @returns The API representation
 */
export function toLabel(entity: LabelEntity): Label {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    name: entity.name,
    color: entity.color,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
    deletedAt: entity.deletedAt?.toISOString() ?? null,
  };
}

/**
 * Map a Label row to the summary a labelled resource carries.
 *
 * @param entity - The row
 * @returns Its id, name and colour
 */
export function toLabelSummary(entity: LabelEntity): LabelSummary {
  return { id: entity.id, name: entity.name, color: entity.color };
}

/**
 * Manages the Labels of an Organization, and the posting of Labels on any resource.
 *
 * A Label is an organizing tool and **never** carries behaviour (CADRAGE § 10): nothing else in the
 * domain may read a label to decide something. What this service offers other services is
 * {@link LabelService.setOn} and {@link LabelService.summariesOf} — the two operations a labelable
 * resource needs, so that no phase writes the assignment table by hand.
 *
 * Viewers read; managers create, change, delete, restore and post them.
 */
export class LabelService {
  /**
   * Create the service.
   *
   * @param dataSource - Application database
   * @param access - Permission checks
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: AccessService
  ) {}

  /**
   * List the Labels of an Organization.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param query - Page, sort, search and whether the deleted ones are listed
   * @returns A page of Labels
   * @throws Error with status 404 when the caller cannot see the Organization
   */
  public async list(actor: AuthContext, organizationId: string, query: ListLabelsQuery): Promise<Paginated<Label>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');

    const builder: SelectQueryBuilder<LabelEntity> = this.repository()
      .createQueryBuilder('label')
      .withDeleted()
      .where('label.organization_id = :organizationId', { organizationId });
    if (!query.includeDeleted) builder.andWhere('label.deleted_at IS NULL');
    if (query.search) {
      builder.andWhere(`${withoutAccentsSql('label.name')} ILIKE :search`, {
        search: `%${escapeLike(withoutAccents(query.search))}%`,
      });
    }

    const { skip, take } = toSkipTake(query);
    for (const [field, direction] of Object.entries(toOrder(query.sortBy, query.sortOrder))) {
      builder.addOrderBy(`label.${field}`, direction);
    }
    const [rows, total]: [LabelEntity[], number] = await builder.skip(skip).take(take).getManyAndCount();
    return toPage(rows.map(toLabel), total, query);
  }

  /**
   * Read one Label.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Label
   * @returns The Label
   * @throws Error with status 404 when the caller cannot see it
   */
  public async get(actor: AuthContext, organizationId: string, id: string): Promise<Label> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    return toLabel(await this.findOrFail(this.dataSource.manager, organizationId, id, { deleted: true }));
  }

  /**
   * Create a Label.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param body - Name and colour
   * @returns The created Label
   * @throws Error with status 403 without the manager role, 409 when the name is taken
   */
  public async create(actor: AuthContext, organizationId: string, body: CreateLabelBody): Promise<Label> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction((manager: EntityManager): Promise<Label> =>
      this.createOne(manager, organizationId, body)
    );
  }

  /**
   * Change a Label. A field left out is left alone.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Label
   * @param body - Fields to change
   * @returns The updated Label
   * @throws Error with status 403 without the manager role, 404 when absent, 409 when the name is taken
   */
  public async update(actor: AuthContext, organizationId: string, id: string, body: UpdateLabelBody): Promise<Label> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction((manager: EntityManager): Promise<Label> =>
      this.updateOne(manager, organizationId, id, body)
    );
  }

  /**
   * Soft-delete a Label. Its assignments are kept, so restoring it shows them again.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Label
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
   * Restore a soft-deleted Label.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Label
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
   * Create several Labels, atomically or item by item.
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
    body: BulkCreateLabelsBody
  ): Promise<BulkResult<Label>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return runBulk(this.dataSource, body.mode, body.items, (item: CreateLabelBody, _index, manager: EntityManager) =>
      this.createOne(manager, organizationId, item)
    );
  }

  /**
   * Change several Labels, atomically or item by item.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param body - The mode and the items, each naming the Label it changes
   * @returns What was changed, and what was not
   * @throws Error with status 403 without the manager role, 400 on a duplicated id, or the first failure in `atomic`
   */
  public async bulkUpdate(
    actor: AuthContext,
    organizationId: string,
    body: BulkUpdateLabelsBody
  ): Promise<BulkResult<Label>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    assertDistinctIds(body.items.map((item: { id: string }): string => item.id));
    return runBulk(this.dataSource, body.mode, body.items, ({ id, ...changes }, _index, manager: EntityManager) =>
      this.updateOne(manager, organizationId, id, changes)
    );
  }

  /**
   * Soft-delete several Labels, atomically or item by item.
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
   * Restore several Labels, atomically or item by item.
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
   * List what a Label marks, whatever the kind of resource.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Label
   * @param query - The page to return
   * @returns A page of resources, each with its kind and its name
   * @throws Error with status 404 when the caller cannot see the Label
   */
  public async resources(
    actor: AuthContext,
    organizationId: string,
    id: string,
    query: { page: number; limit: number }
  ): Promise<Paginated<LabelledResource>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    await this.findOrFail(this.dataSource.manager, organizationId, id, { deleted: true });

    const repository: Repository<LabelAssignmentEntity> = this.dataSource.getRepository(LabelAssignmentEntity);
    const [rows, total]: [LabelAssignmentEntity[], number] = await repository.findAndCount({
      where: { labelId: id },
      order: { resourceType: 'ASC', id: 'ASC' },
      ...toSkipTake(query),
    });

    const names: Map<string, string> = await this.namesOf(rows);
    const items: LabelledResource[] = rows
      .filter((row: LabelAssignmentEntity): boolean => names.has(row.resourceId))
      .map((row: LabelAssignmentEntity): LabelledResource => ({
        resourceType: row.resourceType as LabelResourceType,
        resourceId: row.resourceId,
        name: names.get(row.resourceId) as string,
      }));
    return toPage(items, total, query);
  }

  /**
   * Post a set of Labels on one resource, replacing what it carried.
   *
   * The complete list is given, which makes the operation idempotent. Every label must live in the
   * same Organization as the resource: a label never crosses Organizations.
   *
   * Other services call this inside their own transaction, so that creating a resource with its
   * labels is one atomic operation.
   *
   * @param manager - The transaction to work in
   * @param organizationId - The Organization both the resource and the labels belong to
   * @param resourceType - The kind of resource
   * @param resourceId - The resource
   * @param labelIds - The complete set of labels it should carry
   * @returns The summaries of the labels it now carries, by name
   * @throws Error with status 404 when a label is absent, deleted or of another Organization
   */
  public async setOn(
    manager: EntityManager,
    organizationId: string,
    resourceType: LabelResourceType,
    resourceId: string,
    labelIds: string[]
  ): Promise<LabelSummary[]> {
    const wanted: string[] = [...new Set(labelIds)];
    const labels: LabelEntity[] = wanted.length
      ? await manager.find(LabelEntity, { where: { id: In(wanted), organizationId } })
      : [];
    if (labels.length !== wanted.length) throw httpError(404, 'Label not found', { code: 'label_not_found' });

    await manager.delete(LabelAssignmentEntity, { resourceType, resourceId });
    if (wanted.length) {
      await manager.insert(
        LabelAssignmentEntity,
        wanted.map((labelId: string) => ({ labelId, resourceType, resourceId }))
      );
    }
    return labels.sort((a: LabelEntity, b: LabelEntity): number => a.name.localeCompare(b.name)).map(toLabelSummary);
  }

  /**
   * The live Labels posted on each of several resources.
   *
   * One query for the whole page, so listing a hundred resources does not read a hundred sets of
   * labels. A deleted Label is left out: it is hidden until it is restored.
   *
   * @param manager - Where to read
   * @param resourceType - The kind of resource
   * @param resourceIds - The resources
   * @returns The summaries by resource id, sorted by name; a resource with no label is absent
   */
  public async summariesOf(
    manager: EntityManager,
    resourceType: LabelResourceType,
    resourceIds: string[]
  ): Promise<Map<string, LabelSummary[]>> {
    const byResource = new Map<string, LabelSummary[]>();
    if (resourceIds.length === 0) return byResource;

    const rows: { resourceId: string; label: LabelEntity }[] = (await manager
      .createQueryBuilder(LabelAssignmentEntity, 'assignment')
      .innerJoinAndMapOne('assignment.label', LabelEntity, 'label', 'label.id = assignment.label_id')
      .where('assignment.resource_type = :resourceType', { resourceType })
      .andWhere('assignment.resource_id IN (:...resourceIds)', { resourceIds })
      .andWhere('label.deleted_at IS NULL')
      .orderBy('label.name', 'ASC')
      .getMany()) as unknown as { resourceId: string; label: LabelEntity }[];

    for (const row of rows) {
      const summaries: LabelSummary[] = byResource.get(row.resourceId) ?? [];
      summaries.push(toLabelSummary(row.label));
      byResource.set(row.resourceId, summaries);
    }
    return byResource;
  }

  /**
   * Repository of the Labels table.
   *
   * @returns The repository
   */
  private repository(): Repository<LabelEntity> {
    return this.dataSource.getRepository(LabelEntity);
  }

  /**
   * Create one Label inside a transaction.
   *
   * @param manager - The transaction
   * @param organizationId - The Organization
   * @param body - Name and colour
   * @returns The created Label
   * @throws Error with status 409 when the name is taken
   */
  private async createOne(manager: EntityManager, organizationId: string, body: CreateLabelBody): Promise<Label> {
    await this.assertNameFree(manager, organizationId, body.name);
    const created: LabelEntity = await this.save(
      manager,
      manager.create(LabelEntity, { organizationId, name: body.name, color: body.color }),
      body.name
    );
    return toLabel(created);
  }

  /**
   * Change one Label inside a transaction.
   *
   * @param manager - The transaction
   * @param organizationId - The Organization
   * @param id - The Label
   * @param body - Fields to change
   * @returns The updated Label
   * @throws Error with status 404 when absent, 409 when the name is taken
   */
  private async updateOne(
    manager: EntityManager,
    organizationId: string,
    id: string,
    body: UpdateLabelBody
  ): Promise<Label> {
    const label: LabelEntity = await this.findOrFail(manager, organizationId, id);
    if (body.name !== undefined && body.name !== label.name) {
      await this.assertNameFree(manager, organizationId, body.name);
      label.name = body.name;
    }
    if (body.color !== undefined) label.color = body.color;
    return toLabel(await this.save(manager, label, label.name));
  }

  /**
   * Soft-delete one Label inside a transaction.
   *
   * @param manager - The transaction
   * @param organizationId - The Organization
   * @param id - The Label
   * @returns Its id and when it was deleted
   * @throws Error with status 404 when absent
   */
  private async deleteOne(manager: EntityManager, organizationId: string, id: string): Promise<DeletionResult> {
    const label: LabelEntity = await this.findOrFail(manager, organizationId, id);
    const deletedAt = new Date();
    await manager.update(LabelEntity, { id: label.id }, { deletedAt });
    return { id: label.id, deletedAt: deletedAt.toISOString() };
  }

  /**
   * Restore one Label inside a transaction.
   *
   * @param manager - The transaction
   * @param organizationId - The Organization
   * @param id - The Label
   * @returns Its id, with `deletedAt` back to `null`
   * @throws Error with status 404 when absent, 409 when it is not deleted, 409 when its name is taken again
   */
  private async restoreOne(manager: EntityManager, organizationId: string, id: string): Promise<DeletionResult> {
    const label: LabelEntity = await this.findOrFail(manager, organizationId, id, { deleted: true });
    if (!label.deletedAt) {
      throw httpError(409, 'This label is not deleted', { code: 'label_not_deleted' });
    }
    await this.assertNameFree(manager, organizationId, label.name);
    await manager.update(LabelEntity, { id: label.id }, { deletedAt: null });
    return { id: label.id, deletedAt: null };
  }

  /**
   * Load a Label of an Organization.
   *
   * @param manager - Where to read
   * @param organizationId - The Organization it must belong to
   * @param id - The Label
   * @param options - Whether a deleted Label is accepted
   * @param options.deleted - `true` to also find a soft-deleted one
   * @returns The row
   * @throws Error with status 404 when absent, of another Organization, or deleted while not accepted
   */
  private async findOrFail(
    manager: EntityManager,
    organizationId: string,
    id: string,
    options: { deleted?: boolean } = {}
  ): Promise<LabelEntity> {
    const label: LabelEntity | null = await manager.findOne(LabelEntity, {
      where: { id, organizationId },
      withDeleted: options.deleted === true,
    });
    if (!label) throw httpError(404, 'Label not found', { code: 'label_not_found' });
    return label;
  }

  /**
   * Refuse a name a live Label of the Organization already carries.
   *
   * The check is made before writing so the caller gets a clean 409 rather than a constraint
   * violation; the partial unique index is what actually guarantees it, and {@link save} turns the
   * race into the same 409.
   *
   * @param manager - Where to read
   * @param organizationId - The Organization
   * @param name - The name wanted
   * @returns Nothing
   * @throws Error with status 409 coded `label_name_taken`
   */
  private async assertNameFree(manager: EntityManager, organizationId: string, name: string): Promise<void> {
    const taken: boolean = await manager.exists(LabelEntity, { where: { organizationId, name, deletedAt: IsNull() } });
    if (taken) {
      throw httpError(409, `A label named ${name} already exists in this Organization`, {
        code: 'label_name_taken',
        params: { name },
      });
    }
  }

  /**
   * Save a Label, turning a lost race on its name into the same 409 as the check before it.
   *
   * @param manager - The transaction
   * @param label - The row to save
   * @param name - The name being written, for the message
   * @returns The saved row
   * @throws Error with status 409 when the unique index refused it
   */
  private async save(manager: EntityManager, label: LabelEntity, name: string): Promise<LabelEntity> {
    try {
      return await manager.save(LabelEntity, label);
    } catch (error: unknown) {
      if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
      throw httpError(409, `A label named ${name} already exists in this Organization`, {
        code: 'label_name_taken',
        params: { name },
        cause: error,
      });
    }
  }

  /**
   * The name of each resource a set of assignments points at, by kind.
   *
   * The assignment table has no foreign key (D39), so a resource may have disappeared: it is left
   * out of the answer rather than shown as a hole.
   *
   * @param rows - The assignments
   * @returns The names by resource id
   */
  private async namesOf(rows: LabelAssignmentEntity[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const advertiserIds: string[] = rows
      .filter((row: LabelAssignmentEntity): boolean => row.resourceType === 'advertiser')
      .map((row: LabelAssignmentEntity): string => row.resourceId);
    if (advertiserIds.length === 0) return names;

    const found: { id: string; name: string }[] = await this.dataSource
      .createQueryBuilder()
      .select(['advertiser.id AS id', 'advertiser.name AS name'])
      .from('advertisers', 'advertiser')
      .where('advertiser.id IN (:...advertiserIds)', { advertiserIds })
      .andWhere('advertiser.deleted_at IS NULL')
      .getRawMany();
    for (const row of found) names.set(row.id, row.name);
    return names;
  }
}

/**
 * Refuse a bulk that names the same id twice.
 *
 * A caller who sends a duplicate has built their list wrong; collapsing it silently would answer a
 * count that does not match what they asked for.
 *
 * @param ids - The ids of the bulk
 * @returns Nothing
 * @throws Error with status 400 coded `bulk_ids_duplicated`
 */
export function assertDistinctIds(ids: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw httpError(400, `The id ${id} appears twice in this request`, {
        code: 'bulk_ids_duplicated',
        params: { id },
      });
    }
    seen.add(id);
  }
}

/**
 * Fastify plugin that decorates the instance with a {@link LabelService}.
 *
 * Depends on `DatabasePlugin` and `AccessServicePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function labelServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('labelService', new LabelService(fastify.db, fastify.accessService));
}

export default fastifyPlugin(labelServicePlugin, {
  name: 'LabelServicePlugin',
  dependencies: ['DatabasePlugin', 'AccessServicePlugin'],
});
