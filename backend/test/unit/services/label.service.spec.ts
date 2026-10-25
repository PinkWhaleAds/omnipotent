import { FastifyInstance } from 'fastify';

import { LabelAssignmentEntity, LabelEntity } from '@src/database/entities';
import LabelServicePlugin, {
  assertDistinctIds,
  LabelService,
  toLabel,
  toLabelSummary,
} from '@src/services/label.service';
import { Paginated } from '@src/types/api.types';
import { BulkResult, DeletionResult } from '@src/types/crud.types';
import { Label, LabelSummary, LabelledResource, ListLabelsQuery } from '@src/types/label.types';
import { AccessServiceMock, buildServiceApp, createAccessMock } from '@test/unit/mocks/access.mock';
import { IDS, JANE, NOW } from '@test/unit/mocks/auth.fixtures';
import { createDataSourceMock, DataSourceMock, QueryBuilderMock } from '@test/unit/mocks/data-source.mock';
import { httpError } from '@utils';

/** The instant every row is created and updated at, as the API writes it. */
const ISO: string = NOW.toISOString();

/** Ids of the two Labels the specs work with. */
const LABEL_IDS = {
  spring: 'e0000000-0000-4000-8000-000000000001',
  q1: 'e0000000-0000-4000-8000-000000000002',
} as const;

/** The query a list route hands the service when the caller asked for nothing in particular. */
const DEFAULT_QUERY: ListLabelsQuery = {
  page: 1,
  limit: 50,
  sortBy: 'name',
  sortOrder: 'asc',
  includeDeleted: false,
};

/**
 * Build a Label row.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function labelRow(overrides: Partial<LabelEntity> = {}): LabelEntity {
  return {
    id: LABEL_IDS.spring,
    organizationId: IDS.organization,
    name: 'Printemps',
    color: '#1f6feb',
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  } as LabelEntity;
}

/**
 * Build a Label assignment row.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function assignmentRow(overrides: Partial<LabelAssignmentEntity> = {}): LabelAssignmentEntity {
  return {
    id: 'f0000000-0000-4000-8000-000000000001',
    labelId: LABEL_IDS.spring,
    resourceType: 'advertiser',
    resourceId: IDS.advertiser,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as LabelAssignmentEntity;
}

/** The API shape of {@link labelRow}. */
const PRINTEMPS: Label = {
  id: LABEL_IDS.spring,
  organizationId: IDS.organization,
  name: 'Printemps',
  color: '#1f6feb',
  createdAt: ISO,
  updatedAt: ISO,
  deletedAt: null,
};

describe('Unit::Services::LabelService', () => {
  let db: DataSourceMock;
  let access: AccessServiceMock;
  let service: LabelService;

  beforeEach((): void => {
    db = createDataSourceMock();
    access = createAccessMock();
    service = new LabelService(db.dataSource, access as never);
  });

  describe('toLabel', () => {
    it('should map a row to its API shape, dates as ISO strings', (): void => {
      expect(toLabel(labelRow())).toEqual(PRINTEMPS);
    });

    it('should carry the deletion instant of a deleted Label', (): void => {
      expect(toLabel(labelRow({ deletedAt: NOW })).deletedAt).toBe(ISO);
    });
  });

  describe('toLabelSummary', () => {
    it('should keep what a chip needs, and no more', (): void => {
      expect(toLabelSummary(labelRow())).toEqual({ id: LABEL_IDS.spring, name: 'Printemps', color: '#1f6feb' });
    });
  });

  describe('list', () => {
    it('should list the live Labels of the Organization, read by a viewer', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('label');
      builder.getManyAndCount.mockResolvedValue([[labelRow()], 1]);

      const page: Paginated<Label> = await service.list(JANE, IDS.organization, DEFAULT_QUERY);

      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
      expect(page).toEqual({ items: [PRINTEMPS], total: 1, page: 1, limit: 50 });
      expect(builder.andWhere).toHaveBeenCalledWith('label.deleted_at IS NULL');
      expect(builder.skip).toHaveBeenCalledWith(0);
      expect(builder.take).toHaveBeenCalledWith(50);
      expect(builder.addOrderBy).toHaveBeenCalledWith('label.name', 'ASC');
      expect(builder.addOrderBy).toHaveBeenCalledWith('label.id', 'ASC');
    });

    it('should search the name without case nor accents, and list the deleted ones when asked', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('label');

      await service.list(JANE, IDS.organization, {
        ...DEFAULT_QUERY,
        page: 3,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        search: 'Été 100%',
        includeDeleted: true,
      });

      expect(builder.andWhere).not.toHaveBeenCalledWith('label.deleted_at IS NULL');
      expect(builder.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE :search'), {
        search: '%Ete 100\\%%',
      });
      expect(builder.skip).toHaveBeenCalledWith(100);
      expect(builder.addOrderBy).toHaveBeenCalledWith('label.createdAt', 'DESC');
    });
  });

  describe('get', () => {
    it('should read one Label, deleted or not', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(labelRow());

      await expect(service.get(JANE, IDS.organization, LABEL_IDS.spring)).resolves.toEqual(PRINTEMPS);
      expect(db.manager.findOne).toHaveBeenCalledWith(LabelEntity, {
        where: { id: LABEL_IDS.spring, organizationId: IDS.organization },
        withDeleted: true,
      });
    });

    it('should answer 404 for a Label of another Organization', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(service.get(JANE, IDS.organization, LABEL_IDS.spring)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'label_not_found',
      });
    });
  });

  describe('create', () => {
    it('should create a Label whose name is free', async (): Promise<void> => {
      db.manager.save.mockResolvedValue(labelRow());

      await expect(service.create(JANE, IDS.organization, { name: 'Printemps', color: '#1f6feb' })).resolves.toEqual(
        PRINTEMPS
      );
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'manager');
      expect(db.manager.create).toHaveBeenCalledWith(LabelEntity, {
        organizationId: IDS.organization,
        name: 'Printemps',
        color: '#1f6feb',
      });
    });

    it('should refuse a name a live Label already carries', async (): Promise<void> => {
      db.manager.exists.mockResolvedValue(true);

      await expect(
        service.create(JANE, IDS.organization, { name: 'Printemps', color: '#1f6feb' })
      ).rejects.toMatchObject({ statusCode: 409, errorCode: 'label_name_taken', errorParams: { name: 'Printemps' } });
      expect(db.manager.save).not.toHaveBeenCalled();
    });

    it('should answer the same 409 when the unique index refuses a lost race', async (): Promise<void> => {
      db.manager.save.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));

      await expect(
        service.create(JANE, IDS.organization, { name: 'Printemps', color: '#1f6feb' })
      ).rejects.toMatchObject({ statusCode: 409, errorCode: 'label_name_taken' });
    });

    it('should let any other database failure through', async (): Promise<void> => {
      db.manager.save.mockRejectedValue(Object.assign(new Error('connection lost'), { code: '08006' }));

      await expect(service.create(JANE, IDS.organization, { name: 'Printemps', color: '#1f6feb' })).rejects.toThrow(
        'connection lost'
      );
    });
  });

  describe('update', () => {
    it('should rename a Label and change its colour', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(labelRow());
      db.manager.save.mockResolvedValue(labelRow({ name: 'Été', color: '#d29922' }));

      await expect(
        service.update(JANE, IDS.organization, LABEL_IDS.spring, { name: 'Été', color: '#d29922' })
      ).resolves.toMatchObject({ name: 'Été', color: '#d29922' });
      expect(db.manager.exists).toHaveBeenCalledWith(LabelEntity, {
        where: { organizationId: IDS.organization, name: 'Été', deletedAt: expect.anything() },
      });
    });

    it('should leave a field out of the body alone, and not check a name that does not change', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(labelRow());
      db.manager.save.mockResolvedValue(labelRow());

      await expect(service.update(JANE, IDS.organization, LABEL_IDS.spring, { name: 'Printemps' })).resolves.toEqual(
        PRINTEMPS
      );
      expect(db.manager.exists).not.toHaveBeenCalled();
    });

    it('should accept a body changing nothing', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(labelRow());
      db.manager.save.mockResolvedValue(labelRow());

      await expect(service.update(JANE, IDS.organization, LABEL_IDS.spring, {})).resolves.toEqual(PRINTEMPS);
    });
  });

  describe('delete', () => {
    it('should soft-delete a Label and answer when', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(labelRow());

      const result: DeletionResult = await service.delete(JANE, IDS.organization, LABEL_IDS.spring);

      expect(result.id).toBe(LABEL_IDS.spring);
      expect(Date.parse(result.deletedAt as string)).not.toBeNaN();
      expect(db.manager.update).toHaveBeenCalledWith(
        LabelEntity,
        { id: LABEL_IDS.spring },
        { deletedAt: expect.any(Date) }
      );
    });
  });

  describe('restore', () => {
    it('should restore a deleted Label whose name is free again', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(labelRow({ deletedAt: NOW }));

      await expect(service.restore(JANE, IDS.organization, LABEL_IDS.spring)).resolves.toEqual({
        id: LABEL_IDS.spring,
        deletedAt: null,
      });
      expect(db.manager.update).toHaveBeenCalledWith(LabelEntity, { id: LABEL_IDS.spring }, { deletedAt: null });
    });

    it('should answer 409 for a Label that is not deleted', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(labelRow());

      await expect(service.restore(JANE, IDS.organization, LABEL_IDS.spring)).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'label_not_deleted',
      });
    });

    it('should answer 409 when the name was taken again while it was deleted', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(labelRow({ deletedAt: NOW }));
      db.manager.exists.mockResolvedValue(true);

      await expect(service.restore(JANE, IDS.organization, LABEL_IDS.spring)).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'label_name_taken',
      });
    });
  });

  describe('bulkCreate', () => {
    it('should create every item of an atomic bulk', async (): Promise<void> => {
      db.manager.save.mockResolvedValue(labelRow());

      const result: BulkResult<Label> = await service.bulkCreate(JANE, IDS.organization, {
        mode: 'atomic',
        items: [
          { name: 'Printemps', color: '#1f6feb' },
          { name: 'Été', color: '#d29922' },
        ],
      });

      expect(result.items).toHaveLength(2);
      expect(result.failed).toEqual([]);
    });

    it('should report the items a partial bulk could not create', async (): Promise<void> => {
      db.manager.save.mockResolvedValue(labelRow());
      db.manager.exists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      const result: BulkResult<Label> = await service.bulkCreate(JANE, IDS.organization, {
        mode: 'partial',
        items: [
          { name: 'Printemps', color: '#1f6feb' },
          { name: 'Printemps', color: '#d29922' },
        ],
      });

      expect(result.items).toHaveLength(1);
      expect(result.failed).toEqual([
        { index: 1, code: 'label_name_taken', params: { name: 'Printemps' }, message: expect.any(String) },
      ]);
    });
  });

  describe('bulkUpdate', () => {
    it('should update every item, each naming its Label', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(labelRow());
      db.manager.save.mockResolvedValue(labelRow());

      const result: BulkResult<Label> = await service.bulkUpdate(JANE, IDS.organization, {
        mode: 'atomic',
        items: [
          { id: LABEL_IDS.spring, color: '#d29922' },
          { id: LABEL_IDS.q1, color: '#1f6feb' },
        ],
      });

      expect(result.items).toHaveLength(2);
    });

    it('should refuse a bulk naming the same Label twice', async (): Promise<void> => {
      await expect(
        service.bulkUpdate(JANE, IDS.organization, {
          mode: 'atomic',
          items: [
            { id: LABEL_IDS.spring, color: '#d29922' },
            { id: LABEL_IDS.spring, color: '#1f6feb' },
          ],
        })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'bulk_ids_duplicated' });
    });
  });

  describe('bulkDelete', () => {
    it('should delete every id', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(labelRow());

      const result: BulkResult<DeletionResult> = await service.bulkDelete(JANE, IDS.organization, {
        mode: 'atomic',
        ids: [LABEL_IDS.spring, LABEL_IDS.q1],
      });

      expect(result.items).toHaveLength(2);
    });

    it('should refuse a bulk naming the same id twice', async (): Promise<void> => {
      await expect(
        service.bulkDelete(JANE, IDS.organization, { mode: 'atomic', ids: [LABEL_IDS.spring, LABEL_IDS.spring] })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'bulk_ids_duplicated' });
    });
  });

  describe('bulkRestore', () => {
    it('should restore every id', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(labelRow({ deletedAt: NOW }));

      const result: BulkResult<DeletionResult> = await service.bulkRestore(JANE, IDS.organization, {
        mode: 'atomic',
        ids: [LABEL_IDS.spring],
      });

      expect(result.items).toEqual([{ id: LABEL_IDS.spring, deletedAt: null }]);
    });

    it('should refuse a bulk naming the same id twice', async (): Promise<void> => {
      await expect(
        service.bulkRestore(JANE, IDS.organization, { mode: 'atomic', ids: [LABEL_IDS.spring, LABEL_IDS.spring] })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'bulk_ids_duplicated' });
    });
  });

  describe('resources', () => {
    it('should list what a Label marks, with the name of each resource', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(labelRow());
      db.repository(LabelAssignmentEntity).findAndCount.mockResolvedValue([[assignmentRow()], 1]);
      db.builder().getRawMany.mockResolvedValue([{ id: IDS.advertiser, name: 'Herbéa' }]);

      const page: Paginated<LabelledResource> = await service.resources(JANE, IDS.organization, LABEL_IDS.spring, {
        page: 1,
        limit: 50,
      });

      expect(page.items).toEqual([{ resourceType: 'advertiser', resourceId: IDS.advertiser, name: 'Herbéa' }]);
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
    });

    it('should leave out an assignment whose resource is gone', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(labelRow());
      db.repository(LabelAssignmentEntity).findAndCount.mockResolvedValue([[assignmentRow()], 1]);

      const page: Paginated<LabelledResource> = await service.resources(JANE, IDS.organization, LABEL_IDS.spring, {
        page: 1,
        limit: 50,
      });

      expect(page.items).toEqual([]);
      expect(page.total).toBe(1);
    });

    it('should read no resource table when the Label marks nothing', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(labelRow());

      const page: Paginated<LabelledResource> = await service.resources(JANE, IDS.organization, LABEL_IDS.spring, {
        page: 1,
        limit: 50,
      });

      expect(page.items).toEqual([]);
      expect(db.mocks.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('setOn', () => {
    it('should replace the Labels of a resource, sorted by name', async (): Promise<void> => {
      db.manager.find.mockResolvedValue([labelRow({ id: LABEL_IDS.q1, name: 'Q1' }), labelRow()]);

      const posted: LabelSummary[] = await service.setOn(
        db.manager as never,
        IDS.organization,
        'advertiser',
        IDS.advertiser,
        [LABEL_IDS.spring, LABEL_IDS.q1, LABEL_IDS.q1]
      );

      expect(posted.map((summary: LabelSummary): string => summary.name)).toEqual(['Printemps', 'Q1']);
      expect(db.manager.delete).toHaveBeenCalledWith(LabelAssignmentEntity, {
        resourceType: 'advertiser',
        resourceId: IDS.advertiser,
      });
      expect(db.manager.insert).toHaveBeenCalledWith(LabelAssignmentEntity, [
        { labelId: LABEL_IDS.spring, resourceType: 'advertiser', resourceId: IDS.advertiser },
        { labelId: LABEL_IDS.q1, resourceType: 'advertiser', resourceId: IDS.advertiser },
      ]);
    });

    it('should clear the Labels of a resource when given an empty list', async (): Promise<void> => {
      await expect(
        service.setOn(db.manager as never, IDS.organization, 'advertiser', IDS.advertiser, [])
      ).resolves.toEqual([]);
      expect(db.manager.find).not.toHaveBeenCalled();
      expect(db.manager.delete).toHaveBeenCalled();
      expect(db.manager.insert).not.toHaveBeenCalled();
    });

    it('should answer 404 when a Label is absent or of another Organization', async (): Promise<void> => {
      db.manager.find.mockResolvedValue([labelRow()]);

      await expect(
        service.setOn(db.manager as never, IDS.organization, 'advertiser', IDS.advertiser, [
          LABEL_IDS.spring,
          LABEL_IDS.q1,
        ])
      ).rejects.toMatchObject({ statusCode: 404, errorCode: 'label_not_found' });
      expect(db.manager.delete).not.toHaveBeenCalled();
    });
  });

  describe('summariesOf', () => {
    it('should read the Labels of a whole page in one query, grouped by resource', async (): Promise<void> => {
      const other = 'd0000000-0000-4000-8000-000000000002';
      db.builder('assignment').getMany.mockResolvedValue([
        { resourceId: IDS.advertiser, label: labelRow() },
        { resourceId: IDS.advertiser, label: labelRow({ id: LABEL_IDS.q1, name: 'Q1' }) },
        { resourceId: other, label: labelRow({ id: LABEL_IDS.q1, name: 'Q1' }) },
      ]);

      const byResource: Map<string, LabelSummary[]> = await service.summariesOf(db.manager as never, 'advertiser', [
        IDS.advertiser,
        other,
      ]);

      expect(byResource.get(IDS.advertiser)).toHaveLength(2);
      expect(byResource.get(other)).toEqual([{ id: LABEL_IDS.q1, name: 'Q1', color: '#1f6feb' }]);
    });

    it('should read nothing for an empty page', async (): Promise<void> => {
      await expect(service.summariesOf(db.manager as never, 'advertiser', [])).resolves.toEqual(new Map());
      expect(db.manager.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('assertDistinctIds', () => {
    it('should accept distinct ids', (): void => {
      expect((): void => assertDistinctIds([LABEL_IDS.spring, LABEL_IDS.q1])).not.toThrow();
    });

    it('should refuse the same id twice, naming it', (): void => {
      expect((): void => assertDistinctIds([LABEL_IDS.spring, LABEL_IDS.spring])).toThrow(
        expect.objectContaining({ errorParams: { id: LABEL_IDS.spring } })
      );
    });
  });

  describe('LabelServicePlugin', () => {
    it('should decorate the instance with a LabelService wired to its dependencies', async (): Promise<void> => {
      const app: FastifyInstance = await buildServiceApp([LabelServicePlugin], { db, access });
      db.manager.findOne.mockResolvedValue(labelRow());

      expect(app.labelService).toBeInstanceOf(LabelService);
      await expect(app.labelService.get(JANE, IDS.organization, LABEL_IDS.spring)).resolves.toEqual(PRINTEMPS);

      await app.close();
    });
  });

  describe('refusals of the access service', () => {
    it('should let a refused role travel out untouched', async (): Promise<void> => {
      access.assertOrganizationRole.mockRejectedValue(
        httpError(403, 'Requires the manager role', { code: 'role_required' })
      );

      await expect(
        service.create(JANE, IDS.organization, { name: 'Printemps', color: '#1f6feb' })
      ).rejects.toMatchObject({ statusCode: 403, errorCode: 'role_required' });
      expect(db.mocks.transaction).not.toHaveBeenCalled();
    });
  });
});
