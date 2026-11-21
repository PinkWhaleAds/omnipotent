import { FastifyInstance } from 'fastify';

import { ListEntity } from '@src/database/entities';
import ListServicePlugin, { ListService, toList } from '@src/services/list.service';
import TargetingServicePlugin from '@src/services/targeting.service';
import { BulkResult, DeletionResult, List, ListListsQuery, Paginated } from '@src/types';
import { AccessServiceMock, buildServiceApp, createAccessMock } from '@test/unit/mocks/access.mock';
import { IDS, JANE, NOW } from '@test/unit/mocks/auth.fixtures';
import { createDataSourceMock, DataSourceMock, QueryBuilderMock } from '@test/unit/mocks/data-source.mock';
import { httpError } from '@utils';

/** The list the specs work with. */
const LIST_ID = 'fa000000-0000-4000-8000-000000000001';

/** The TargetingGroup that references it in the specs about the move. */
const NODE_ID = 'f4000000-0000-4000-8000-000000000001';

/** The query a list route hands the service when the caller asked for nothing in particular. */
const DEFAULT_QUERY: ListListsQuery = {
  page: 1,
  limit: 50,
  sortBy: 'name',
  sortOrder: 'asc',
  includeDeleted: false,
};

/**
 * A list row.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function row(overrides: Partial<ListEntity> = {}): ListEntity {
  return {
    id: LIST_ID,
    organizationId: IDS.organization,
    kind: 'app_site',
    name: 'Sites à exclure',
    items: [{ value: 'example.com' }],
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  } as unknown as ListEntity;
}

describe('Unit::Services::ListService', () => {
  let db: DataSourceMock;
  let access: AccessServiceMock;
  let targeting: { referencesOfList: jest.Mock };
  let service: ListService;

  beforeEach((): void => {
    jest.clearAllMocks();
    db = createDataSourceMock();
    access = createAccessMock();
    targeting = { referencesOfList: jest.fn().mockResolvedValue([]) };
    service = new ListService(db.dataSource, access as never, targeting as never);
    // What the database answers a save: the row it was given, with its generated id and its stamps.
    db.manager.save.mockImplementation(async (_entity: unknown, saved: object): Promise<object> =>
      Promise.resolve({ id: LIST_ID, createdAt: NOW, updatedAt: NOW, deletedAt: null, ...saved })
    );
  });

  describe('list', () => {
    it('should answer a page of the live lists of the Organization', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('list');
      builder.getManyAndCount.mockResolvedValue([[row()], 1]);

      const page: Paginated<List> = await service.list(JANE, IDS.organization, DEFAULT_QUERY);

      expect(page).toEqual({ items: [toList(row())], total: 1, page: 1, limit: 50 });
      expect(builder.andWhere).toHaveBeenCalledWith('list.deleted_at IS NULL');
      expect(builder.addOrderBy).toHaveBeenCalledWith('list.name', 'ASC');
      expect(builder.addOrderBy).toHaveBeenCalledWith('list.id', 'ASC');
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
    });

    it('should list the deleted ones too when asked, filter on the kind and search the name', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('list');

      await service.list(JANE, IDS.organization, {
        ...DEFAULT_QUERY,
        includeDeleted: true,
        kind: 'poi',
        search: 'Écrans',
      });

      expect(builder.andWhere).not.toHaveBeenCalledWith('list.deleted_at IS NULL');
      expect(builder.andWhere).toHaveBeenCalledWith('list.kind = :kind', { kind: 'poi' });
      // The accents are stripped on both sides, and the comparison is case-insensitive in SQL.
      expect(builder.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE'), { search: '%Ecrans%' });
    });
  });

  describe('get', () => {
    it('should answer a list with its items, and how many it holds', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row());

      await expect(service.get(JANE, IDS.organization, LIST_ID)).resolves.toMatchObject({
        id: LIST_ID,
        kind: 'app_site',
        itemCount: 1,
      });
      expect(db.manager.findOne).toHaveBeenCalledWith(ListEntity, {
        where: { id: LIST_ID, organizationId: IDS.organization },
        withDeleted: true,
      });
    });

    it('should answer a deleted list, saying when it was deleted', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row({ deletedAt: NOW }));

      await expect(service.get(JANE, IDS.organization, LIST_ID)).resolves.toMatchObject({
        deletedAt: NOW.toISOString(),
      });
    });

    it('should not find a list of another Organization', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(service.get(JANE, IDS.organization, LIST_ID)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'list_not_found',
      });
    });
  });

  describe('create', () => {
    it('should create a list, empty when no item was given', async (): Promise<void> => {
      const created: List = await service.create(JANE, IDS.organization, { kind: 'poi', name: 'Magasins' });

      expect(db.manager.create).toHaveBeenCalledWith(ListEntity, {
        organizationId: IDS.organization,
        kind: 'poi',
        name: 'Magasins',
        items: [],
      });
      expect(created).toMatchObject({ kind: 'poi', name: 'Magasins', itemCount: 0 });
    });

    it('should refuse a name a live list of the same kind already carries', async (): Promise<void> => {
      db.manager.exists.mockResolvedValue(true);

      await expect(service.create(JANE, IDS.organization, { kind: 'poi', name: 'Magasins' })).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'list_name_taken',
        errorParams: { kind: 'poi', name: 'Magasins' },
      });
      expect(db.manager.save).not.toHaveBeenCalled();
    });

    it('should turn a lost race on the name into the same refusal', async (): Promise<void> => {
      db.manager.save.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));

      await expect(service.create(JANE, IDS.organization, { kind: 'poi', name: 'Magasins' })).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'list_name_taken',
      });
    });

    it('should let any other database failure through', async (): Promise<void> => {
      db.manager.save.mockRejectedValue(new Error('connection lost'));

      await expect(service.create(JANE, IDS.organization, { kind: 'poi', name: 'Magasins' })).rejects.toThrow(
        'connection lost'
      );
    });
  });

  describe('update', () => {
    it('should replace the items the list had', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row());

      const changed: List = await service.update(JANE, IDS.organization, LIST_ID, {
        items: [{ value: 'autre.test' }, { value: 'encore.test', label: 'Encore' }],
      });

      expect(changed.items).toEqual([{ value: 'autre.test' }, { value: 'encore.test', label: 'Encore' }]);
      expect(changed.itemCount).toBe(2);
    });

    it('should check the new name, and leave the old one alone when it does not change', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row());

      await service.update(JANE, IDS.organization, LIST_ID, { name: 'Sites à exclure' });
      expect(db.manager.exists).not.toHaveBeenCalled();

      await service.update(JANE, IDS.organization, LIST_ID, { name: 'Sites bloqués' });
      expect(db.manager.exists).toHaveBeenCalledWith(ListEntity, {
        where: {
          organizationId: IDS.organization,
          kind: 'app_site',
          name: 'Sites bloqués',
          deletedAt: expect.anything(),
        },
      });
    });
  });

  describe('delete and restore', () => {
    it('should soft-delete a list', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row());

      const deleted: DeletionResult = await service.delete(JANE, IDS.organization, LIST_ID);

      expect(deleted.id).toBe(LIST_ID);
      expect(deleted.deletedAt).toEqual(expect.any(String));
      expect(db.manager.update).toHaveBeenCalledWith(ListEntity, { id: LIST_ID }, { deletedAt: expect.any(Date) });
    });

    it('should restore a deleted list, its name still free', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row({ deletedAt: NOW }));

      await expect(service.restore(JANE, IDS.organization, LIST_ID)).resolves.toEqual({
        id: LIST_ID,
        deletedAt: null,
      });
      expect(db.manager.update).toHaveBeenCalledWith(ListEntity, { id: LIST_ID }, { deletedAt: null });
    });

    it('should refuse to restore a list that lives', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row());

      await expect(service.restore(JANE, IDS.organization, LIST_ID)).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'list_not_deleted',
      });
    });
  });

  describe('duplicate', () => {
    it('should copy the list into another Organization of the Seat', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row());

      const copy: List = await service.duplicate(JANE, IDS.organization, LIST_ID, {
        organizationId: IDS.otherOrganization,
      });

      expect(db.manager.create).toHaveBeenCalledWith(ListEntity, {
        organizationId: IDS.otherOrganization,
        kind: 'app_site',
        name: 'Sites à exclure',
        items: [{ value: 'example.com' }],
      });
      expect(copy.organizationId).toBe(IDS.otherOrganization);
      expect(access.assertSeatRole).toHaveBeenCalledWith(JANE, IDS.seat, 'seat_admin');
    });

    it('should refuse a copy into the Organization it already lives in', async (): Promise<void> => {
      await expect(
        service.duplicate(JANE, IDS.organization, LIST_ID, { organizationId: IDS.organization })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'list_same_organization' });
      expect(access.assertSeatRole).not.toHaveBeenCalled();
    });

    it('should refuse a copy into another Seat', async (): Promise<void> => {
      access.assertOrganizationRole
        .mockResolvedValueOnce({ organizationId: IDS.organization, seatId: IDS.seat, role: 'admin' })
        .mockResolvedValueOnce({
          organizationId: IDS.otherOrganization,
          seatId: 'b0000000-0000-4000-8000-000000000002',
          role: 'admin',
        });

      await expect(
        service.duplicate(JANE, IDS.organization, LIST_ID, { organizationId: IDS.otherOrganization })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'list_other_seat' });
      expect(access.assertSeatRole).not.toHaveBeenCalled();
    });
  });

  describe('move', () => {
    it('should move a list nothing references any more', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row());

      const moved: List = await service.move(JANE, IDS.organization, LIST_ID, {
        organizationId: IDS.otherOrganization,
      });

      expect(moved.organizationId).toBe(IDS.otherOrganization);
      expect(db.manager.update).toHaveBeenCalledWith(
        ListEntity,
        { id: LIST_ID },
        { organizationId: IDS.otherOrganization }
      );
    });

    it('should refuse to move a list a targeting still references, and say how many', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row());
      targeting.referencesOfList.mockResolvedValue([NODE_ID]);

      await expect(
        service.move(JANE, IDS.organization, LIST_ID, { organizationId: IDS.otherOrganization })
      ).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'list_referenced',
        errorParams: { listId: LIST_ID, references: 1 },
      });
      expect(db.manager.update).not.toHaveBeenCalled();
    });

    it('should refuse to move a list onto a name taken in the target Organization', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row());
      db.manager.exists.mockResolvedValue(true);

      await expect(
        service.move(JANE, IDS.organization, LIST_ID, { organizationId: IDS.otherOrganization })
      ).rejects.toMatchObject({ statusCode: 409, errorCode: 'list_name_taken' });
    });
  });

  describe('the bulks', () => {
    it('should create several lists', async (): Promise<void> => {
      const result: BulkResult<List> = await service.bulkCreate(JANE, IDS.organization, {
        mode: 'atomic',
        items: [{ kind: 'poi', name: 'Magasins' }],
      });

      expect(result.items).toHaveLength(1);
      expect(result.failed).toEqual([]);
    });

    it('should change several lists, each naming the one it changes', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row());

      const result: BulkResult<List> = await service.bulkUpdate(JANE, IDS.organization, {
        mode: 'atomic',
        items: [{ id: LIST_ID, name: 'Sites bloqués' }],
      });

      expect(result.items[0]).toMatchObject({ name: 'Sites bloqués' });
    });

    it('should delete and restore several lists', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row({ deletedAt: NOW }));

      const deleted: BulkResult<DeletionResult> = await service.bulkDelete(JANE, IDS.organization, {
        mode: 'atomic',
        ids: [LIST_ID],
      });
      const restored: BulkResult<DeletionResult> = await service.bulkRestore(JANE, IDS.organization, {
        mode: 'atomic',
        ids: [LIST_ID],
      });

      expect(deleted.items).toHaveLength(1);
      expect(restored.items).toEqual([{ id: LIST_ID, deletedAt: null }]);
    });

    it('should refuse the same id twice rather than collapsing it', async (): Promise<void> => {
      for (const call of [
        service.bulkUpdate(JANE, IDS.organization, {
          mode: 'atomic',
          items: [{ id: LIST_ID }, { id: LIST_ID }],
        }),
        service.bulkDelete(JANE, IDS.organization, { mode: 'atomic', ids: [LIST_ID, LIST_ID] }),
        service.bulkRestore(JANE, IDS.organization, { mode: 'atomic', ids: [LIST_ID, LIST_ID] }),
      ]) {
        await expect(call).rejects.toMatchObject({ statusCode: 400, errorCode: 'bulk_ids_duplicated' });
      }
    });
  });

  describe('refusals of the access service', () => {
    it('should relay a refusal of the role, before reading anything', async (): Promise<void> => {
      access.assertOrganizationRole.mockRejectedValue(httpError(403, 'Requires the manager role'));

      await expect(service.create(JANE, IDS.organization, { kind: 'poi', name: 'Magasins' })).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(db.mocks.transaction).not.toHaveBeenCalled();
    });
  });

  describe('ListServicePlugin', () => {
    it('should decorate the instance with a ListService wired to its dependencies', async (): Promise<void> => {
      const app: FastifyInstance = await buildServiceApp([TargetingServicePlugin, ListServicePlugin], {
        geo: {},
        db,
        access,
      });
      db.manager.findOne.mockResolvedValue(row());

      expect(app.listService).toBeInstanceOf(ListService);
      await expect(app.listService.get(JANE, IDS.organization, LIST_ID)).resolves.toMatchObject({ id: LIST_ID });

      await app.close();
    });
  });
});
