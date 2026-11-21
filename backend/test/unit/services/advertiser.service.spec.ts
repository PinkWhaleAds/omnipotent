import { FastifyInstance } from 'fastify';

import { AdvertiserEntity } from '@src/database/entities';
import AdvertiserServicePlugin, { AdvertiserService, toAdvertiser } from '@src/services/advertiser.service';
import LabelServicePlugin, { LabelService } from '@src/services/label.service';
import { Advertiser, ListAdvertisersQuery } from '@src/types/advertiser.types';
import { Paginated } from '@src/types/api.types';
import { BulkResult, DeletionResult } from '@src/types/crud.types';
import { LabelSummary } from '@src/types/label.types';
import { AccessServiceMock, buildServiceApp, createAccessMock } from '@test/unit/mocks/access.mock';
import { IDS, JANE, NOW } from '@test/unit/mocks/auth.fixtures';
import { createDataSourceMock, DataSourceMock, QueryBuilderMock } from '@test/unit/mocks/data-source.mock';
import { httpError } from '@utils';

/** The instant every row is created and updated at, as the API writes it. */
const ISO: string = NOW.toISOString();

/** Ids the specs work with. */
const OTHER_ADVERTISER = 'd0000000-0000-4000-8000-000000000002';

/** A Label as an Advertiser carries it. */
const SPRING: LabelSummary = { id: 'e0000000-0000-4000-8000-000000000001', name: 'Printemps', color: '#1f6feb' };

/** The query a list route hands the service when the caller asked for nothing in particular. */
const DEFAULT_QUERY: ListAdvertisersQuery = {
  page: 1,
  limit: 50,
  sortBy: 'name',
  sortOrder: 'asc',
  labelMode: 'any',
  includeDeleted: false,
};

/** Jest mocks of the {@link LabelService} methods an Advertiser needs. */
type LabelServiceMock = { setOn: jest.Mock; summariesOf: jest.Mock };

/**
 * Build an Advertiser row.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function advertiserRow(overrides: Partial<AdvertiserEntity> = {}): AdvertiserEntity {
  return {
    id: IDS.advertiser,
    organizationId: IDS.organization,
    name: 'Herbéa',
    websiteUrl: 'https://herbea.test',
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  } as AdvertiserEntity;
}

/** The API shape of {@link advertiserRow}, with no Label. */
const HERBEA: Advertiser = {
  id: IDS.advertiser,
  organizationId: IDS.organization,
  name: 'Herbéa',
  websiteUrl: 'https://herbea.test',
  labels: [],
  createdAt: ISO,
  updatedAt: ISO,
  deletedAt: null,
};

describe('Unit::Services::AdvertiserService', () => {
  let db: DataSourceMock;
  let access: AccessServiceMock;
  let labels: LabelServiceMock;
  let tracking: { request: jest.Mock };
  let service: AdvertiserService;

  beforeEach((): void => {
    db = createDataSourceMock();
    access = createAccessMock();
    labels = { setOn: jest.fn().mockResolvedValue([SPRING]), summariesOf: jest.fn().mockResolvedValue(new Map()) };
    tracking = { request: jest.fn().mockResolvedValue(undefined) };
    service = new AdvertiserService(db.dataSource, access as never, labels as unknown as LabelService, tracking);
  });

  describe('toAdvertiser', () => {
    it('should map a row to its API shape, with the Labels it carries', (): void => {
      expect(toAdvertiser(advertiserRow(), [SPRING])).toEqual({ ...HERBEA, labels: [SPRING] });
    });

    it('should carry the deletion instant of a deleted Advertiser, and no Label by default', (): void => {
      expect(toAdvertiser(advertiserRow({ deletedAt: NOW, websiteUrl: null }))).toEqual({
        ...HERBEA,
        websiteUrl: null,
        deletedAt: ISO,
      });
    });
  });

  describe('list', () => {
    it('should list the live Advertisers of the Organization, read by a viewer', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('advertiser');
      builder.getManyAndCount.mockResolvedValue([[advertiserRow()], 1]);
      labels.summariesOf.mockResolvedValue(new Map([[IDS.advertiser, [SPRING]]]));

      const page: Paginated<Advertiser> = await service.list(JANE, IDS.organization, DEFAULT_QUERY);

      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
      expect(page).toEqual({ items: [{ ...HERBEA, labels: [SPRING] }], total: 1, page: 1, limit: 50 });
      expect(builder.andWhere).toHaveBeenCalledWith('advertiser.deleted_at IS NULL');
      expect(builder.addOrderBy).toHaveBeenCalledWith('advertiser.name', 'ASC');
      expect(builder.addOrderBy).toHaveBeenCalledWith('advertiser.id', 'ASC');
    });

    it('should search the name without case nor accents, filter on Labels and list the deleted ones', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('advertiser');

      await service.list(JANE, IDS.organization, {
        ...DEFAULT_QUERY,
        search: 'herbéa',
        labelIds: [SPRING.id],
        labelMode: 'all',
        includeDeleted: true,
      });

      expect(builder.andWhere).not.toHaveBeenCalledWith('advertiser.deleted_at IS NULL');
      expect(builder.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE :search'), { search: '%herbea%' });
      expect(builder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('HAVING COUNT(DISTINCT assignment.label_id) = :labelCount'),
        expect.objectContaining({ labelResourceType: 'advertiser', labelIds: [SPRING.id], labelCount: 1 })
      );
    });

    it('should answer an empty page without reading any Label', async (): Promise<void> => {
      await expect(service.list(JANE, IDS.organization, DEFAULT_QUERY)).resolves.toEqual({
        items: [],
        total: 0,
        page: 1,
        limit: 50,
      });
    });
  });

  describe('get', () => {
    it('should read one Advertiser, deleted or not, with its Labels', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(advertiserRow());
      labels.summariesOf.mockResolvedValue(new Map([[IDS.advertiser, [SPRING]]]));

      await expect(service.get(JANE, IDS.organization, IDS.advertiser)).resolves.toEqual({
        ...HERBEA,
        labels: [SPRING],
      });
      expect(db.manager.findOne).toHaveBeenCalledWith(AdvertiserEntity, {
        where: { id: IDS.advertiser, organizationId: IDS.organization },
        withDeleted: true,
      });
    });

    it('should answer 404 for an Advertiser of another Organization', async (): Promise<void> => {
      await expect(service.get(JANE, IDS.organization, IDS.advertiser)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'advertiser_not_found',
      });
    });
  });

  describe('create', () => {
    it('should create an Advertiser and post the Labels it was given', async (): Promise<void> => {
      db.manager.save.mockResolvedValue(advertiserRow());

      await expect(
        service.create(JANE, IDS.organization, {
          name: 'Herbéa',
          websiteUrl: 'https://herbea.test',
          labelIds: [SPRING.id],
        })
      ).resolves.toEqual({ ...HERBEA, labels: [SPRING] });
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'manager');
      expect(labels.setOn).toHaveBeenCalledWith(db.manager, IDS.organization, 'advertiser', IDS.advertiser, [
        SPRING.id,
      ]);
    });

    it('should create an Advertiser with no website and no Label', async (): Promise<void> => {
      db.manager.save.mockResolvedValue(advertiserRow({ websiteUrl: null }));

      await expect(service.create(JANE, IDS.organization, { name: 'Herbéa', labelIds: [] })).resolves.toEqual({
        ...HERBEA,
        websiteUrl: null,
      });
      expect(db.manager.create).toHaveBeenCalledWith(AdvertiserEntity, {
        organizationId: IDS.organization,
        name: 'Herbéa',
        websiteUrl: null,
      });
      expect(labels.setOn).not.toHaveBeenCalled();
    });

    it('should refuse a name a live Advertiser already carries', async (): Promise<void> => {
      db.manager.exists.mockResolvedValue(true);

      await expect(service.create(JANE, IDS.organization, { name: 'Herbéa' })).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'advertiser_name_taken',
        errorParams: { name: 'Herbéa' },
      });
      expect(db.manager.save).not.toHaveBeenCalled();
    });

    it('should answer the same 409 when the unique index refuses a lost race', async (): Promise<void> => {
      db.manager.save.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));

      await expect(service.create(JANE, IDS.organization, { name: 'Herbéa' })).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'advertiser_name_taken',
      });
    });

    it('should let any other database failure through', async (): Promise<void> => {
      db.manager.save.mockRejectedValue(Object.assign(new Error('connection lost'), { code: '08006' }));

      await expect(service.create(JANE, IDS.organization, { name: 'Herbéa' })).rejects.toThrow('connection lost');
    });
  });

  describe('update', () => {
    it('should rename an Advertiser and clear its website', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(advertiserRow());
      db.manager.save.mockResolvedValue(advertiserRow({ name: 'Herbéa Bio', websiteUrl: null }));

      await expect(
        service.update(JANE, IDS.organization, IDS.advertiser, { name: 'Herbéa Bio', websiteUrl: null })
      ).resolves.toMatchObject({ name: 'Herbéa Bio', websiteUrl: null });
      expect(db.manager.exists).toHaveBeenCalledWith(AdvertiserEntity, {
        where: { organizationId: IDS.organization, name: 'Herbéa Bio', deletedAt: expect.anything() },
      });
      // Its name is in the names of its conversion goals at the platforms (`docs/phase-10.md` § 8.10).
      expect(tracking.request).toHaveBeenCalledWith(IDS.advertiser);
    });

    it('should leave a field out of the body alone, and not check a name that does not change', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(advertiserRow());
      db.manager.save.mockResolvedValue(advertiserRow());

      await expect(service.update(JANE, IDS.organization, IDS.advertiser, { name: 'Herbéa' })).resolves.toEqual(HERBEA);
      expect(db.manager.exists).not.toHaveBeenCalled();
      expect(tracking.request).not.toHaveBeenCalled();
    });

    it('should accept a body changing nothing', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(advertiserRow());
      db.manager.save.mockResolvedValue(advertiserRow());

      await expect(service.update(JANE, IDS.organization, IDS.advertiser, {})).resolves.toEqual(HERBEA);
    });
  });

  describe('delete', () => {
    it('should soft-delete an Advertiser and answer when', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(advertiserRow());

      const result: DeletionResult = await service.delete(JANE, IDS.organization, IDS.advertiser);

      expect(result.id).toBe(IDS.advertiser);
      expect(Date.parse(result.deletedAt as string)).not.toBeNaN();
      expect(db.manager.update).toHaveBeenCalledWith(
        AdvertiserEntity,
        { id: IDS.advertiser },
        { deletedAt: expect.any(Date) }
      );
    });
  });

  describe('restore', () => {
    it('should restore a deleted Advertiser whose name is free again', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(advertiserRow({ deletedAt: NOW }));

      await expect(service.restore(JANE, IDS.organization, IDS.advertiser)).resolves.toEqual({
        id: IDS.advertiser,
        deletedAt: null,
      });
      expect(db.manager.update).toHaveBeenCalledWith(AdvertiserEntity, { id: IDS.advertiser }, { deletedAt: null });
    });

    it('should answer 409 for an Advertiser that is not deleted', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(advertiserRow());

      await expect(service.restore(JANE, IDS.organization, IDS.advertiser)).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'advertiser_not_deleted',
      });
    });

    it('should answer 409 when the name was taken again while it was deleted', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(advertiserRow({ deletedAt: NOW }));
      db.manager.exists.mockResolvedValue(true);

      await expect(service.restore(JANE, IDS.organization, IDS.advertiser)).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'advertiser_name_taken',
      });
    });
  });

  describe('setLabels', () => {
    it('should replace the Labels of an Advertiser', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(advertiserRow());

      await expect(
        service.setLabels(JANE, IDS.organization, IDS.advertiser, { labelIds: [SPRING.id] })
      ).resolves.toEqual({ ...HERBEA, labels: [SPRING] });
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'manager');
      expect(labels.setOn).toHaveBeenCalledWith(db.manager, IDS.organization, 'advertiser', IDS.advertiser, [
        SPRING.id,
      ]);
    });

    it('should answer 404 for an Advertiser that is deleted', async (): Promise<void> => {
      await expect(service.setLabels(JANE, IDS.organization, IDS.advertiser, { labelIds: [] })).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'advertiser_not_found',
      });
      expect(labels.setOn).not.toHaveBeenCalled();
    });
  });

  describe('bulkCreate', () => {
    it('should create every item of an atomic bulk', async (): Promise<void> => {
      db.manager.save.mockResolvedValue(advertiserRow());

      const result: BulkResult<Advertiser> = await service.bulkCreate(JANE, IDS.organization, {
        mode: 'atomic',
        items: [{ name: 'Herbéa' }, { name: 'Maison Lune' }],
      });

      expect(result.items).toHaveLength(2);
      expect(result.failed).toEqual([]);
    });

    it('should report the items a partial bulk could not create', async (): Promise<void> => {
      db.manager.save.mockResolvedValue(advertiserRow());
      db.manager.exists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      const result: BulkResult<Advertiser> = await service.bulkCreate(JANE, IDS.organization, {
        mode: 'partial',
        items: [{ name: 'Herbéa' }, { name: 'Herbéa' }],
      });

      expect(result.items).toHaveLength(1);
      expect(result.failed).toEqual([
        { index: 1, code: 'advertiser_name_taken', params: { name: 'Herbéa' }, message: expect.any(String) },
      ]);
    });
  });

  describe('bulkUpdate', () => {
    it('should update every item, each naming its Advertiser', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(advertiserRow());
      db.manager.save.mockResolvedValue(advertiserRow());

      const result: BulkResult<Advertiser> = await service.bulkUpdate(JANE, IDS.organization, {
        mode: 'atomic',
        items: [
          { id: IDS.advertiser, websiteUrl: null },
          { id: OTHER_ADVERTISER, websiteUrl: 'https://maison-lune.test' },
        ],
      });

      expect(result.items).toHaveLength(2);
    });

    it('should refuse a bulk naming the same Advertiser twice', async (): Promise<void> => {
      await expect(
        service.bulkUpdate(JANE, IDS.organization, {
          mode: 'atomic',
          items: [
            { id: IDS.advertiser, websiteUrl: null },
            { id: IDS.advertiser, name: 'Herbéa' },
          ],
        })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'bulk_ids_duplicated' });
    });
  });

  describe('bulkDelete', () => {
    it('should delete every id', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(advertiserRow());

      const result: BulkResult<DeletionResult> = await service.bulkDelete(JANE, IDS.organization, {
        mode: 'atomic',
        ids: [IDS.advertiser, OTHER_ADVERTISER],
      });

      expect(result.items).toHaveLength(2);
    });

    it('should refuse a bulk naming the same id twice', async (): Promise<void> => {
      await expect(
        service.bulkDelete(JANE, IDS.organization, { mode: 'atomic', ids: [IDS.advertiser, IDS.advertiser] })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'bulk_ids_duplicated' });
    });
  });

  describe('bulkRestore', () => {
    it('should restore every id', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(advertiserRow({ deletedAt: NOW }));

      const result: BulkResult<DeletionResult> = await service.bulkRestore(JANE, IDS.organization, {
        mode: 'atomic',
        ids: [IDS.advertiser],
      });

      expect(result.items).toEqual([{ id: IDS.advertiser, deletedAt: null }]);
    });

    it('should refuse a bulk naming the same id twice', async (): Promise<void> => {
      await expect(
        service.bulkRestore(JANE, IDS.organization, { mode: 'atomic', ids: [IDS.advertiser, IDS.advertiser] })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'bulk_ids_duplicated' });
    });
  });

  describe('AdvertiserServicePlugin', () => {
    it('should decorate the instance with an AdvertiserService wired to its dependencies', async (): Promise<void> => {
      const app: FastifyInstance = await buildServiceApp([LabelServicePlugin, AdvertiserServicePlugin], {
        db,
        access,
        tracking,
      });
      db.manager.findOne.mockResolvedValue(advertiserRow());

      expect(app.advertiserService).toBeInstanceOf(AdvertiserService);
      await expect(app.advertiserService.get(JANE, IDS.organization, IDS.advertiser)).resolves.toEqual(HERBEA);

      await app.close();
    });
  });

  describe('refusals of the access service', () => {
    it('should let a refused role travel out untouched', async (): Promise<void> => {
      access.assertOrganizationRole.mockRejectedValue(
        httpError(403, 'Requires the manager role', { code: 'role_required' })
      );

      await expect(service.create(JANE, IDS.organization, { name: 'Herbéa' })).rejects.toMatchObject({
        statusCode: 403,
        errorCode: 'role_required',
      });
      expect(db.mocks.transaction).not.toHaveBeenCalled();
    });
  });
});
