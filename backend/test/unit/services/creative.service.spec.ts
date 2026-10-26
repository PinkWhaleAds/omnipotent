import { FastifyInstance } from 'fastify';

import { AssetEntity, CreativeEntity, CreativeVersionAssetEntity, CreativeVersionEntity } from '@src/database/entities';
import CreativeServicePlugin, { CreativeService } from '@src/services/creative.service';
import { Creative, CreativeVersion, LabelSummary, ListCreativesQuery, Paginated } from '@src/types';
import { AccessServiceMock, buildServiceApp, createAccessMock } from '@test/unit/mocks/access.mock';
import { IDS, JANE, NOW } from '@test/unit/mocks/auth.fixtures';
import { createDataSourceMock, DataSourceMock, QueryBuilderMock } from '@test/unit/mocks/data-source.mock';
import { httpError } from '@utils';

/** The ids the specs work with. */
const CREATIVE_ID = 'fe000000-0000-4000-8000-000000000001';
const VERSION_ID = 'fd000000-0000-4000-8000-000000000001';
const ASSET_ID = 'fc000000-0000-4000-8000-000000000001';
const ADVERTISER_ID = IDS.advertiser;

/** A Label a creative carries. */
const SPRING: LabelSummary = { id: 'e0000000-0000-4000-8000-000000000001', name: 'Printemps', color: '#1f6feb' };

/** The query a list route hands the service when the caller asked for nothing in particular. */
const DEFAULT_QUERY: ListCreativesQuery = {
  page: 1,
  limit: 50,
  sortBy: 'name',
  sortOrder: 'asc',
  includeDeleted: false,
  labelMode: 'any',
};

/** The first version of a display image creative, as a body sends it. */
const DISPLAY_VERSION = {
  payload: { altText: 'Bannière' },
  assets: [{ role: 'image' as const, assetId: ASSET_ID }],
  trackers: [],
};

/**
 * A creative row.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function creativeRow(overrides: Partial<CreativeEntity> = {}): CreativeEntity {
  return {
    id: CREATIVE_ID,
    organizationId: IDS.organization,
    advertiserId: ADVERTISER_ID,
    name: 'Bannière 300x250',
    format: 'display',
    subtype: 'image',
    iabCategories: [],
    iabTaxonomyVersion: null,
    clickThroughUrl: null,
    activeVersionId: VERSION_ID,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  } as unknown as CreativeEntity;
}

/**
 * A version row.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function versionRow(overrides: Partial<CreativeVersionEntity> = {}): CreativeVersionEntity {
  return {
    id: VERSION_ID,
    organizationId: IDS.organization,
    creativeId: CREATIVE_ID,
    version: 1,
    payload: { altText: 'Bannière' },
    trackers: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as unknown as CreativeVersionEntity;
}

describe('Unit::Services::CreativeService', () => {
  let db: DataSourceMock;
  let access: AccessServiceMock;
  let labels: { setOn: jest.Mock; summariesOf: jest.Mock };
  let service: CreativeService;

  beforeEach((): void => {
    jest.clearAllMocks();
    db = createDataSourceMock();
    access = createAccessMock();
    labels = { setOn: jest.fn().mockResolvedValue([SPRING]), summariesOf: jest.fn().mockResolvedValue(new Map()) };
    service = new CreativeService(db.dataSource, access as never, labels as never);
    db.manager.save.mockImplementation(async (entity: unknown, saved: object): Promise<object> =>
      Promise.resolve({
        id: entity === CreativeEntity ? CREATIVE_ID : VERSION_ID,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
        ...saved,
      })
    );
    // The asset a version claims exists, and belongs to the same Advertiser.
    db.manager.find.mockImplementation(async (entity: unknown): Promise<object[]> => {
      if (entity === AssetEntity) return Promise.resolve([{ id: ASSET_ID, advertiserId: ADVERTISER_ID }]);
      return Promise.resolve([]);
    });
  });

  describe('list', () => {
    it('should answer the live creatives of the Advertiser', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('creative');
      builder.getManyAndCount.mockResolvedValue([[creativeRow()], 1]);
      db.manager.find.mockImplementation(async (entity: unknown): Promise<object[]> => {
        if (entity === CreativeVersionEntity) return Promise.resolve([versionRow()]);
        return Promise.resolve([]);
      });

      const page: Paginated<Creative> = await service.list(JANE, IDS.organization, ADVERTISER_ID, DEFAULT_QUERY);

      expect(page.items[0]).toMatchObject({
        id: CREATIVE_ID,
        versionCount: 1,
        activeVersion: expect.objectContaining({ id: VERSION_ID, active: true }),
      });
      expect(builder.andWhere).toHaveBeenCalledWith('creative.deleted_at IS NULL');
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
    });

    it('should filter on the couple and on the name, and list the deleted ones when asked', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('creative');

      await service.list(JANE, IDS.organization, ADVERTISER_ID, {
        ...DEFAULT_QUERY,
        format: 'video',
        subtype: 'vast_url',
        search: 'Été',
        includeDeleted: true,
      });

      expect(builder.andWhere).toHaveBeenCalledWith('creative.format = :format', { format: 'video' });
      expect(builder.andWhere).toHaveBeenCalledWith('creative.subtype = :subtype', { subtype: 'vast_url' });
      expect(builder.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE'), { search: '%Ete%' });
      expect(builder.andWhere).not.toHaveBeenCalledWith('creative.deleted_at IS NULL');
    });

    it('should answer an empty page without asking for versions', async (): Promise<void> => {
      await expect(service.list(JANE, IDS.organization, ADVERTISER_ID, DEFAULT_QUERY)).resolves.toMatchObject({
        items: [],
        total: 0,
      });
      expect(db.manager.find).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('should answer a creative without an active version as null', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(creativeRow({ activeVersionId: null }));

      await expect(service.get(JANE, IDS.organization, CREATIVE_ID)).resolves.toMatchObject({
        activeVersion: null,
        versionCount: 0,
      });
    });

    it('should not find a creative of another Organization', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(service.get(JANE, IDS.organization, CREATIVE_ID)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'creative_not_found',
      });
    });
  });

  describe('create', () => {
    it('should create the creative, its first version, and make it deliver', async (): Promise<void> => {
      const created: Creative = await service.create(JANE, IDS.organization, ADVERTISER_ID, {
        name: 'Bannière 300x250',
        format: 'display',
        subtype: 'image',
        version: DISPLAY_VERSION,
      });

      expect(db.manager.update).toHaveBeenCalledWith(
        CreativeEntity,
        { id: CREATIVE_ID },
        { activeVersionId: VERSION_ID }
      );
      expect(db.manager.insert).toHaveBeenCalledWith(CreativeVersionAssetEntity, [
        { versionId: VERSION_ID, assetId: ASSET_ID, role: 'image' },
      ]);
      expect(created).toMatchObject({
        format: 'display',
        subtype: 'image',
        versionCount: 1,
        activeVersion: expect.objectContaining({ version: 1, active: true }),
      });
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'manager');
    });

    it('should post the labels the body named', async (): Promise<void> => {
      const created: Creative = await service.create(JANE, IDS.organization, ADVERTISER_ID, {
        name: 'Bannière',
        format: 'display',
        subtype: 'image',
        labelIds: [SPRING.id],
        version: DISPLAY_VERSION,
      });

      expect(labels.setOn).toHaveBeenCalledWith(db.manager, IDS.organization, 'creative', CREATIVE_ID, [SPRING.id]);
      expect(created.labels).toEqual([SPRING]);
    });

    it('should keep the categories and the click URL the body carried', async (): Promise<void> => {
      const created: Creative = await service.create(JANE, IDS.organization, ADVERTISER_ID, {
        name: 'Bannière',
        format: 'display',
        subtype: 'image',
        iabCategories: ['IAB2-3'],
        iabTaxonomyVersion: '3.0',
        clickThroughUrl: 'https://herbea.test/automne',
        version: DISPLAY_VERSION,
      });

      expect(created).toMatchObject({
        iabCategories: ['IAB2-3'],
        iabTaxonomyVersion: '3.0',
        clickThroughUrl: 'https://herbea.test/automne',
      });
    });

    it('should refuse a couple the registry does not know', async (): Promise<void> => {
      await expect(
        service.create(JANE, IDS.organization, ADVERTISER_ID, {
          name: 'Bannière',
          format: 'display',
          subtype: 'rsa',
          version: { payload: {}, assets: [], trackers: [] },
        })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'creative_couple_unknown' });
    });

    it('should refuse a payload that does not hold, and a missing asset role', async (): Promise<void> => {
      await expect(
        service.create(JANE, IDS.organization, ADVERTISER_ID, {
          name: 'Spot',
          format: 'video',
          subtype: 'vast_url',
          version: { payload: { vastUrl: 'not a url' }, assets: [], trackers: [] },
        })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'creative_payload_invalid' });

      await expect(
        service.create(JANE, IDS.organization, ADVERTISER_ID, {
          name: 'Spot',
          format: 'video',
          subtype: 'vast_url',
          version: { payload: { vastUrl: 'https://vast.test/tag.xml' }, assets: [], trackers: [] },
        })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'creative_asset_role_missing' });
    });

    it('should refuse an asset that does not exist, and one of another Advertiser', async (): Promise<void> => {
      db.manager.find.mockResolvedValue([]);
      await expect(
        service.create(JANE, IDS.organization, ADVERTISER_ID, {
          name: 'Bannière',
          format: 'display',
          subtype: 'image',
          version: DISPLAY_VERSION,
        })
      ).rejects.toMatchObject({ statusCode: 404, errorCode: 'asset_not_found' });

      db.manager.find.mockResolvedValue([{ id: ASSET_ID, advertiserId: 'd0000000-0000-4000-8000-000000000002' }]);
      await expect(
        service.create(JANE, IDS.organization, ADVERTISER_ID, {
          name: 'Bannière',
          format: 'display',
          subtype: 'image',
          version: DISPLAY_VERSION,
        })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'asset_other_advertiser' });
    });

    it('should link no asset when the couple needs none', async (): Promise<void> => {
      await service.create(JANE, IDS.organization, ADVERTISER_ID, {
        name: 'Vidéo YouTube',
        format: 'video',
        subtype: 'youtube_id',
        version: { payload: { youtubeVideoId: 'dQw4w9WgXcQ' }, assets: [], trackers: [] },
      });

      expect(db.manager.insert).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should change each field the body carries, and leave out what it does not', async (): Promise<void> => {
      db.manager.findOne.mockImplementation(async (): Promise<object> => Promise.resolve(creativeRow()));

      const changed: Creative = await service.update(JANE, IDS.organization, CREATIVE_ID, {
        name: 'Bannière automne',
        iabCategories: ['IAB2-3'],
        iabTaxonomyVersion: '3.0',
        clickThroughUrl: 'https://herbea.test',
      });

      expect(changed).toMatchObject({
        name: 'Bannière automne',
        iabCategories: ['IAB2-3'],
        iabTaxonomyVersion: '3.0',
        clickThroughUrl: 'https://herbea.test',
      });

      const untouched: Creative = await service.update(JANE, IDS.organization, CREATIVE_ID, {});
      expect(untouched).toMatchObject({ name: 'Bannière 300x250' });
    });

    it('should clear the taxonomy version and the click URL on null', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(
        creativeRow({ iabTaxonomyVersion: '3.0', clickThroughUrl: 'https://herbea.test' })
      );

      await expect(
        service.update(JANE, IDS.organization, CREATIVE_ID, { iabTaxonomyVersion: null, clickThroughUrl: null })
      ).resolves.toMatchObject({ iabTaxonomyVersion: null, clickThroughUrl: null });
    });
  });

  describe('delete and restore', () => {
    it('should delete a creative, its versions hidden with it', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(creativeRow());

      await expect(service.delete(JANE, IDS.organization, CREATIVE_ID)).resolves.toMatchObject({ id: CREATIVE_ID });
      expect(db.manager.update).toHaveBeenCalledWith(
        CreativeEntity,
        { id: CREATIVE_ID },
        { deletedAt: expect.any(Date) }
      );
    });

    it('should restore a deleted creative, and refuse one that lives', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(creativeRow({ deletedAt: NOW }));
      await expect(service.restore(JANE, IDS.organization, CREATIVE_ID)).resolves.toEqual({
        id: CREATIVE_ID,
        deletedAt: null,
      });

      db.manager.findOne.mockResolvedValue(creativeRow());
      await expect(service.restore(JANE, IDS.organization, CREATIVE_ID)).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'creative_not_deleted',
      });
    });
  });

  describe('setLabels', () => {
    it('should replace the labels a creative carried', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(creativeRow());
      labels.summariesOf.mockResolvedValue(new Map([[CREATIVE_ID, [SPRING]]]));

      const labelled: Creative = await service.setLabels(JANE, IDS.organization, CREATIVE_ID, {
        labelIds: [SPRING.id],
      });

      expect(labels.setOn).toHaveBeenCalledWith(db.manager, IDS.organization, 'creative', CREATIVE_ID, [SPRING.id]);
      expect(labelled.labels).toEqual([SPRING]);
    });
  });

  describe('the versions', () => {
    it('should list them with the most recent first, saying which one delivers', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(creativeRow());
      db.manager.findAndCount.mockResolvedValue([[versionRow({ version: 2, id: 'other' }), versionRow()], 2]);
      db.manager.find.mockResolvedValue([{ versionId: VERSION_ID, assetId: ASSET_ID, role: 'image' }]);

      const page: Paginated<CreativeVersion> = await service.listVersions(JANE, IDS.organization, CREATIVE_ID, {
        page: 1,
        limit: 50,
      });

      expect(db.manager.findAndCount).toHaveBeenCalledWith(
        CreativeVersionEntity,
        expect.objectContaining({ order: { version: 'DESC' } })
      );
      expect(page.items.map((version: CreativeVersion): boolean => version.active)).toEqual([false, true]);
      expect(page.items[1].assets).toEqual([{ role: 'image', assetId: ASSET_ID }]);
    });

    it('should read one version with its assets', async (): Promise<void> => {
      db.manager.findOne.mockImplementation(async (entity: unknown): Promise<object> => {
        return Promise.resolve(entity === CreativeVersionEntity ? versionRow() : creativeRow());
      });

      await expect(service.getVersion(JANE, IDS.organization, VERSION_ID)).resolves.toMatchObject({
        id: VERSION_ID,
        version: 1,
        active: true,
      });
    });

    it('should not find a version of another Organization', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(service.getVersion(JANE, IDS.organization, VERSION_ID)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'creative_version_not_found',
      });
    });

    it('should number a new version after the ones already there, without activating it', async (): Promise<void> => {
      // The creative already delivers another version: the new one must not take over by itself.
      db.manager.findOne.mockResolvedValue(creativeRow({ activeVersionId: 'fd000000-0000-4000-8000-000000000009' }));
      db.manager.count.mockResolvedValue(2);

      const added: CreativeVersion = await service.createVersion(JANE, IDS.organization, CREATIVE_ID, {
        payload: { altText: 'Automne' },
        assets: [{ role: 'image', assetId: ASSET_ID }],
        trackers: [{ event: 'impression', url: 'https://tracker.test/i' }],
      });

      expect(added).toMatchObject({ version: 3, active: false, trackers: [{ event: 'impression' }] });
      expect(db.manager.update).not.toHaveBeenCalled();
    });

    it('should put a version in delivery', async (): Promise<void> => {
      db.manager.findOne.mockImplementation(async (entity: unknown): Promise<object> => {
        return Promise.resolve(
          entity === CreativeVersionEntity ? versionRow() : creativeRow({ activeVersionId: null })
        );
      });

      const activated: CreativeVersion = await service.activateVersion(JANE, IDS.organization, VERSION_ID);

      expect(db.manager.update).toHaveBeenCalledWith(
        CreativeEntity,
        { id: CREATIVE_ID },
        { activeVersionId: VERSION_ID }
      );
      expect(activated.active).toBe(true);
    });
  });

  describe('the bulks', () => {
    it('should create several creatives', async (): Promise<void> => {
      const result = await service.bulkCreate(JANE, IDS.organization, ADVERTISER_ID, {
        mode: 'atomic',
        items: [{ name: 'Bannière', format: 'display', subtype: 'image', version: DISPLAY_VERSION }],
      });

      expect(result.items).toHaveLength(1);
      expect(result.failed).toEqual([]);
    });

    it('should change, delete and restore several creatives', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(creativeRow({ deletedAt: NOW }));

      await expect(
        service.bulkUpdate(JANE, IDS.organization, { mode: 'atomic', items: [{ id: CREATIVE_ID, name: 'Automne' }] })
      ).resolves.toMatchObject({ items: [expect.objectContaining({ name: 'Automne' })] });
      await expect(
        service.bulkDelete(JANE, IDS.organization, { mode: 'atomic', ids: [CREATIVE_ID] })
      ).resolves.toMatchObject({ items: [expect.objectContaining({ id: CREATIVE_ID })] });
      await expect(
        service.bulkRestore(JANE, IDS.organization, { mode: 'atomic', ids: [CREATIVE_ID] })
      ).resolves.toMatchObject({ items: [{ id: CREATIVE_ID, deletedAt: null }] });
    });

    it('should refuse the same id twice rather than collapsing it', async (): Promise<void> => {
      for (const call of [
        service.bulkUpdate(JANE, IDS.organization, {
          mode: 'atomic',
          items: [{ id: CREATIVE_ID }, { id: CREATIVE_ID }],
        }),
        service.bulkDelete(JANE, IDS.organization, { mode: 'atomic', ids: [CREATIVE_ID, CREATIVE_ID] }),
        service.bulkRestore(JANE, IDS.organization, { mode: 'atomic', ids: [CREATIVE_ID, CREATIVE_ID] }),
      ]) {
        await expect(call).rejects.toMatchObject({ statusCode: 400, errorCode: 'bulk_ids_duplicated' });
      }
    });
  });

  describe('refusals of the access service', () => {
    it('should relay a refusal of the role, before reading anything', async (): Promise<void> => {
      access.assertOrganizationRole.mockRejectedValue(httpError(403, 'Requires the manager role'));

      await expect(service.delete(JANE, IDS.organization, CREATIVE_ID)).rejects.toMatchObject({ statusCode: 403 });
      expect(db.mocks.transaction).not.toHaveBeenCalled();
    });
  });

  describe('CreativeServicePlugin', () => {
    it('should decorate the instance with a CreativeService wired to its dependencies', async (): Promise<void> => {
      const app: FastifyInstance = await buildServiceApp([CreativeServicePlugin], { db, access, labels });
      db.manager.findOne.mockResolvedValue(creativeRow());

      expect(app.creativeService).toBeInstanceOf(CreativeService);
      await expect(app.creativeService.get(JANE, IDS.organization, CREATIVE_ID)).resolves.toMatchObject({
        id: CREATIVE_ID,
      });

      await app.close();
    });
  });
});
