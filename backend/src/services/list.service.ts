import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource, EntityManager, IsNull, Repository, SelectQueryBuilder } from 'typeorm';

import { ListEntity } from '@src/database/entities';
import {
  AuthContext,
  BulkCreateListsBody,
  BulkIdsBody,
  BulkResult,
  BulkUpdateListsBody,
  CreateListBody,
  DeletionResult,
  List,
  ListKind,
  ListListsQuery,
  Paginated,
  TransferListBody,
  UpdateListBody,
} from '@src/types';
import { escapeLike, httpError, toPage, toSkipTake, withoutAccents, withoutAccentsSql } from '@utils';
import { AccessService, OrganizationAccess } from './access.service';
import { runBulk, toOrder } from './crud.helpers';
import { assertDistinctIds } from './label.service';
import { TargetingService } from './targeting.service';

/** PostgreSQL error code of a unique constraint violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Map a list row to its API shape.
 *
 * @param entity - The row
 * @returns The API representation
 */
export function toList(entity: ListEntity): List {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    kind: entity.kind,
    name: entity.name,
    items: entity.items,
    itemCount: entity.items.length,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
    deletedAt: entity.deletedAt?.toISOString() ?? null,
  };
}

/**
 * The reusable lists of an Organization: sites, apps, devices, points of interest, screens, keywords…
 *
 * It follows the reference CRUD of `docs/phase-2.md` — pagination, search, soft-delete, restore,
 * bulk — and adds the two operations that make a list worth sharing (`../../CADRAGE.md` § 8):
 *
 * - **duplicate** into another Organization of the same Seat, which a `seat_admin` may do;
 * - **move**, which is **refused while a targeting of the origin still references the list**, with a
 *   code that names the duplication instead — otherwise the move would leave those targetings
 *   pointing at a list they can no longer see.
 *
 * The kind never changes: dimensions reference a list by what it holds, so turning a list of sites
 * into a list of POIs would silently break every targeting pointing at it.
 */
export class ListService {
  /**
   * Create the service.
   *
   * @param dataSource - Application database
   * @param access - Permission checks
   * @param targeting - Reading which TargetingGroups reference a list
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: AccessService,
    private readonly targeting: TargetingService
  ) {}

  /**
   * List the lists of an Organization.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param query - Page, sort, search, kind, and whether the deleted ones are listed
   * @returns A page of lists
   * @throws Error with status 404 when the caller cannot see the Organization
   */
  public async list(actor: AuthContext, organizationId: string, query: ListListsQuery): Promise<Paginated<List>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');

    const builder: SelectQueryBuilder<ListEntity> = this.repository()
      .createQueryBuilder('list')
      .withDeleted()
      .where('list.organization_id = :organizationId', { organizationId });
    if (!query.includeDeleted) builder.andWhere('list.deleted_at IS NULL');
    if (query.kind) builder.andWhere('list.kind = :kind', { kind: query.kind });
    if (query.search) {
      builder.andWhere(`${withoutAccentsSql('list.name')} ILIKE :search`, {
        search: `%${escapeLike(withoutAccents(query.search))}%`,
      });
    }

    const { skip, take } = toSkipTake(query);
    for (const [field, direction] of Object.entries(toOrder(query.sortBy, query.sortOrder))) {
      builder.addOrderBy(`list.${field}`, direction);
    }
    const [rows, total]: [ListEntity[], number] = await builder.skip(skip).take(take).getManyAndCount();
    return toPage(rows.map(toList), total, query);
  }

  /**
   * Read one list, with its items.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The list
   * @returns The list
   * @throws Error with status 404 when the caller cannot see it
   */
  public async get(actor: AuthContext, organizationId: string, id: string): Promise<List> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    return toList(await this.findOrFail(this.dataSource.manager, organizationId, id, { deleted: true }));
  }

  /**
   * Create a list.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param body - Kind, name and items
   * @returns The created list
   * @throws Error with status 403 without the manager role, 409 when the name is taken
   */
  public async create(actor: AuthContext, organizationId: string, body: CreateListBody): Promise<List> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction((manager: EntityManager): Promise<List> =>
      this.createOne(manager, organizationId, body)
    );
  }

  /**
   * Change a list: its name, or the complete set of its items.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The list
   * @param body - Fields to change
   * @returns The updated list
   * @throws Error with status 403 without the manager role, 404 when absent, 409 when the name is taken
   */
  public async update(actor: AuthContext, organizationId: string, id: string, body: UpdateListBody): Promise<List> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction((manager: EntityManager): Promise<List> =>
      this.updateOne(manager, organizationId, id, body)
    );
  }

  /**
   * Soft-delete a list.
   *
   * The targetings referencing it are **left alone**: a deleted list is hidden, and restoring it
   * brings those targetings back to life rather than having rewritten them (D19).
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The list
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
   * Restore a soft-deleted list.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The list
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
   * Copy a list into another Organization of the same Seat.
   *
   * The copy is a list of its own from that moment: changing one does not change the other, which is
   * what makes duplication the safe answer when a move is refused.
   *
   * @param actor - The caller
   * @param organizationId - The Organization it comes from
   * @param id - The list
   * @param body - The Organization it goes to
   * @returns The copy
   * @throws Error with status 403 without the `seat_admin` role, 404 when the list is absent, 400 when
   *   the target is the same Organization or belongs to another Seat, 409 when the name is taken there
   */
  public async duplicate(
    actor: AuthContext,
    organizationId: string,
    id: string,
    body: TransferListBody
  ): Promise<List> {
    await this.assertTransferAllowed(actor, organizationId, body.organizationId);
    return this.dataSource.transaction(async (manager: EntityManager): Promise<List> => {
      const list: ListEntity = await this.findOrFail(manager, organizationId, id);
      return this.createOne(manager, body.organizationId, { kind: list.kind, name: list.name, items: list.items });
    });
  }

  /**
   * Move a list into another Organization of the same Seat.
   *
   * Refused while a targeting of the origin still references it: those targetings would be left
   * pointing at a list their Organization can no longer see. The refusal names how many reference it,
   * and duplication is the way out (`../../CADRAGE.md` § 8).
   *
   * @param actor - The caller
   * @param organizationId - The Organization it comes from
   * @param id - The list
   * @param body - The Organization it goes to
   * @returns The list, now in its new Organization
   * @throws Error with status 403 without the `seat_admin` role, 404 when absent, 400 on the same
   *   Organization or another Seat, 409 when it is still referenced or its name is taken there
   */
  public async move(actor: AuthContext, organizationId: string, id: string, body: TransferListBody): Promise<List> {
    await this.assertTransferAllowed(actor, organizationId, body.organizationId);
    return this.dataSource.transaction(async (manager: EntityManager): Promise<List> => {
      const list: ListEntity = await this.findOrFail(manager, organizationId, id);
      const references: string[] = await this.targeting.referencesOfList(manager, organizationId, list.id);
      if (references.length > 0) {
        throw httpError(409, 'This list is still used by a targeting of this Organization: duplicate it instead', {
          code: 'list_referenced',
          params: { listId: list.id, references: references.length },
        });
      }
      await this.assertNameFree(manager, body.organizationId, list.kind, list.name);
      await manager.update(ListEntity, { id: list.id }, { organizationId: body.organizationId });
      return toList({ ...list, organizationId: body.organizationId });
    });
  }

  /**
   * Create several lists, atomically or item by item.
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
    body: BulkCreateListsBody
  ): Promise<BulkResult<List>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return runBulk(this.dataSource, body.mode, body.items, (item: CreateListBody, _index, manager: EntityManager) =>
      this.createOne(manager, organizationId, item)
    );
  }

  /**
   * Change several lists, atomically or item by item.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param body - The mode and the items, each naming the list it changes
   * @returns What was changed, and what was not
   * @throws Error with status 403 without the manager role, 400 on a duplicated id, or the first failure in `atomic`
   */
  public async bulkUpdate(
    actor: AuthContext,
    organizationId: string,
    body: BulkUpdateListsBody
  ): Promise<BulkResult<List>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    assertDistinctIds(body.items.map((item: { id: string }): string => item.id));
    return runBulk(this.dataSource, body.mode, body.items, ({ id, ...changes }, _index, manager: EntityManager) =>
      this.updateOne(manager, organizationId, id, changes)
    );
  }

  /**
   * Soft-delete several lists, atomically or item by item.
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
   * Restore several lists, atomically or item by item.
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
   * Repository of the lists table.
   *
   * @returns The repository
   */
  private repository(): Repository<ListEntity> {
    return this.dataSource.getRepository(ListEntity);
  }

  /**
   * Refuse a transfer the caller may not make, or that has nowhere to go.
   *
   * The two Organizations must belong to the **same Seat**, and the caller must administer it: a
   * manager of both would otherwise move a list across a boundary the Seat owns
   * (`../../CADRAGE.md` § 8).
   *
   * @param actor - The caller
   * @param from - The Organization it comes from
   * @param to - The Organization it goes to
   * @returns Nothing
   * @throws Error with status 400 on the same Organization or another Seat, 403 without the role
   */
  private async assertTransferAllowed(actor: AuthContext, from: string, to: string): Promise<void> {
    if (from === to) {
      throw httpError(400, 'A list is duplicated or moved into another Organization', {
        code: 'list_same_organization',
        params: { organizationId: to },
      });
    }
    const source: OrganizationAccess = await this.access.assertOrganizationRole(actor, from, 'manager');
    const target: OrganizationAccess = await this.access.assertOrganizationRole(actor, to, 'manager');
    if (source.seatId !== target.seatId) {
      throw httpError(400, 'A list only travels inside its Seat', {
        code: 'list_other_seat',
        params: { organizationId: to },
      });
    }
    await this.access.assertSeatRole(actor, source.seatId, 'seat_admin');
  }

  /**
   * Create one list inside a transaction.
   *
   * @param manager - The transaction
   * @param organizationId - The Organization
   * @param body - Kind, name and items
   * @returns The created list
   * @throws Error with status 409 when the name is taken
   */
  private async createOne(manager: EntityManager, organizationId: string, body: CreateListBody): Promise<List> {
    await this.assertNameFree(manager, organizationId, body.kind, body.name);
    const created: ListEntity = await this.save(
      manager,
      manager.create(ListEntity, {
        organizationId,
        kind: body.kind,
        name: body.name,
        items: body.items ?? [],
      })
    );
    return toList(created);
  }

  /**
   * Change one list inside a transaction.
   *
   * @param manager - The transaction
   * @param organizationId - The Organization
   * @param id - The list
   * @param body - Fields to change
   * @returns The updated list
   * @throws Error with status 404 when absent, 409 when the name is taken
   */
  private async updateOne(
    manager: EntityManager,
    organizationId: string,
    id: string,
    body: UpdateListBody
  ): Promise<List> {
    const list: ListEntity = await this.findOrFail(manager, organizationId, id);
    if (body.name !== undefined && body.name !== list.name) {
      await this.assertNameFree(manager, organizationId, list.kind, body.name);
      list.name = body.name;
    }
    if (body.items !== undefined) list.items = body.items;
    return toList(await this.save(manager, list));
  }

  /**
   * Soft-delete one list inside a transaction.
   *
   * @param manager - The transaction
   * @param organizationId - The Organization
   * @param id - The list
   * @returns Its id and when it was deleted
   * @throws Error with status 404 when absent
   */
  private async deleteOne(manager: EntityManager, organizationId: string, id: string): Promise<DeletionResult> {
    const list: ListEntity = await this.findOrFail(manager, organizationId, id);
    const deletedAt = new Date();
    await manager.update(ListEntity, { id: list.id }, { deletedAt });
    return { id: list.id, deletedAt: deletedAt.toISOString() };
  }

  /**
   * Restore one list inside a transaction.
   *
   * @param manager - The transaction
   * @param organizationId - The Organization
   * @param id - The list
   * @returns Its id, with `deletedAt` back to `null`
   * @throws Error with status 404 when absent, 409 when it is not deleted or its name is taken again
   */
  private async restoreOne(manager: EntityManager, organizationId: string, id: string): Promise<DeletionResult> {
    const list: ListEntity = await this.findOrFail(manager, organizationId, id, { deleted: true });
    if (!list.deletedAt) throw httpError(409, 'This list is not deleted', { code: 'list_not_deleted' });
    await this.assertNameFree(manager, organizationId, list.kind, list.name);
    await manager.update(ListEntity, { id: list.id }, { deletedAt: null });
    return { id: list.id, deletedAt: null };
  }

  /**
   * Load a list of an Organization.
   *
   * @param manager - Where to read
   * @param organizationId - The Organization it must belong to
   * @param id - The list
   * @param options - Whether a deleted list is accepted
   * @param options.deleted - `true` to also find a soft-deleted one
   * @returns The row
   * @throws Error with status 404 when absent, of another Organization, or deleted while not accepted
   */
  private async findOrFail(
    manager: EntityManager,
    organizationId: string,
    id: string,
    options: { deleted?: boolean } = {}
  ): Promise<ListEntity> {
    const list: ListEntity | null = await manager.findOne(ListEntity, {
      where: { id, organizationId },
      withDeleted: options.deleted === true,
    });
    if (!list) throw httpError(404, 'This list does not exist', { code: 'list_not_found', params: { listId: id } });
    return list;
  }

  /**
   * Refuse a name a live list of the same kind already carries in the Organization.
   *
   * @param manager - Where to read
   * @param organizationId - The Organization
   * @param kind - What the list holds
   * @param name - The name wanted
   * @returns Nothing
   * @throws Error with status 409 coded `list_name_taken`
   */
  private async assertNameFree(
    manager: EntityManager,
    organizationId: string,
    kind: ListKind,
    name: string
  ): Promise<void> {
    const taken: boolean = await manager.exists(ListEntity, {
      where: { organizationId, kind, name, deletedAt: IsNull() },
    });
    if (taken) {
      throw httpError(409, `A ${kind} list named ${name} already exists in this Organization`, {
        code: 'list_name_taken',
        params: { kind, name },
      });
    }
  }

  /**
   * Save a list, turning a lost race on its name into the same 409 as the check before it.
   *
   * @param manager - The transaction
   * @param list - The row to save
   * @returns The saved row
   * @throws Error with status 409 when the unique index refused it
   */
  private async save(manager: EntityManager, list: ListEntity): Promise<ListEntity> {
    try {
      return await manager.save(ListEntity, list);
    } catch (error: unknown) {
      if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
      throw httpError(409, `A ${list.kind} list named ${list.name} already exists in this Organization`, {
        code: 'list_name_taken',
        params: { kind: list.kind, name: list.name },
        cause: error,
      });
    }
  }
}

/**
 * Fastify plugin that decorates the instance with a {@link ListService}.
 *
 * Depends on `DatabasePlugin`, `AccessServicePlugin` and `TargetingServicePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function listServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('listService', new ListService(fastify.db, fastify.accessService, fastify.targetingService));
}

export default fastifyPlugin(listServicePlugin, {
  name: 'ListServicePlugin',
  dependencies: ['DatabasePlugin', 'AccessServicePlugin', 'TargetingServicePlugin'],
});
