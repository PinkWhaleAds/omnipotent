import { FastifyInstance } from 'fastify';

import {
  AdGroupEntity,
  CampaignEntity,
  CreativeEntity,
  LeverEntity,
  LineEntity,
  PlatformUnitEntity,
  TargetingGroupEntity,
} from '@src/database/entities';
import LabelServicePlugin, { LabelService } from '@src/services/label.service';
import LineServicePlugin, { LineService, toLine } from '@src/services/line.service';
import { Paginated } from '@src/types/api.types';
import { BulkResult, DeletionResult } from '@src/types/crud.types';
import { LabelSummary } from '@src/types/label.types';
import { CreativeLine, Line, ListLinesQuery } from '@src/types/line.types';
import { BudgetBlock } from '@src/types/tree.types';
import { AccessServiceMock, buildServiceApp, createAccessMock } from '@test/unit/mocks/access.mock';
import { IDS, JANE, NOW } from '@test/unit/mocks/auth.fixtures';
import { createDataSourceMock, DataSourceMock, QueryBuilderMock } from '@test/unit/mocks/data-source.mock';
import { httpError } from '@utils';

/** The instant every row is created and updated at, as the API writes it. */
const ISO: string = NOW.toISOString();

/** Ids the specs work with. */
const CAMPAIGN_ID = 'f1000000-0000-4000-8000-000000000001';
const LEVER_ID = 'f2000000-0000-4000-8000-000000000001';
const AD_GROUP_ID = 'f3000000-0000-4000-8000-000000000001';
const TARGETING_GROUP_ID = 'f4000000-0000-4000-8000-000000000001';
const LINE_ID = 'f5000000-0000-4000-8000-000000000001';
const OTHER_LINE_ID = 'f5000000-0000-4000-8000-000000000002';

/** A Label as a Line carries it. */
const SPRING: LabelSummary = { id: 'e0000000-0000-4000-8000-000000000001', name: 'Printemps', color: '#1f6feb' };

/** The query a list route hands the service when the caller asked for nothing in particular. */
const DEFAULT_QUERY: ListLinesQuery = {
  page: 1,
  limit: 50,
  sortBy: 'name',
  sortOrder: 'asc',
  labelMode: 'any',
  includeDeleted: false,
};

/** Jest mocks of the {@link LabelService} methods a Line needs. */
type LabelServiceMock = { setOn: jest.Mock; summariesOf: jest.Mock };

/**
 * Build a Line row.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function lineRow(overrides: Partial<LineEntity> = {}): LineEntity {
  return {
    id: LINE_ID,
    organizationId: IDS.organization,
    campaignId: CAMPAIGN_ID,
    targetingGroupId: TARGETING_GROUP_ID,
    lever: 'dac',
    name: 'Bannière 300x250',
    status: 'active',
    creativeId: null,
    landingPageUrl: null,
    budgetCents: null,
    budgetVolume: null,
    budgetVolumeUnit: null,
    startsOn: null,
    endsOn: null,
    capping: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  } as LineEntity;
}

/**
 * Arrange the tree above a Line: a campaign of 1 000 € over a fortnight, one lever on one platform,
 * one AdGroup and one TargetingGroup.
 *
 * @param db - The data source mock to arrange
 * @param node - The Line `findOne` answers, `null` to answer nothing
 * @param siblings - The Lines of the TargetingGroup, which divide its budget
 * @param lever - The channel of the tree, `dac` by default
 */
function seedAbove(
  db: DataSourceMock,
  node: LineEntity | null,
  siblings: LineEntity[] = [],
  lever: 'dac' | 'search' = 'dac'
): void {
  db.manager.findOne.mockImplementation(async (entity: unknown): Promise<unknown> => {
    if (entity === CampaignEntity) {
      return {
        id: CAMPAIGN_ID,
        advertiserId: IDS.advertiser,
        budgetCents: 100_000,
        startsOn: '2026-11-05',
        endsOn: '2026-11-20',
        deletedAt: null,
      };
    }
    if (entity === LeverEntity) {
      return {
        id: LEVER_ID,
        campaignId: CAMPAIGN_ID,
        lever,
        platformShares: [{ platform: lever === 'search' ? 'google_ads' : 'dv360', shareBasisPoints: 10_000 }],
        budgetCents: null,
        startsOn: null,
        endsOn: null,
        deletedAt: null,
      };
    }
    if (entity === AdGroupEntity) {
      return {
        id: AD_GROUP_ID,
        campaignId: CAMPAIGN_ID,
        leverId: LEVER_ID,
        lever,
        bidAmountCents: 450,
        platformShares: null,
        budgetCents: null,
        startsOn: null,
        endsOn: null,
        deletedAt: null,
      };
    }
    if (entity === TargetingGroupEntity) {
      return {
        id: TARGETING_GROUP_ID,
        organizationId: IDS.organization,
        campaignId: CAMPAIGN_ID,
        adGroupId: AD_GROUP_ID,
        lever,
        bidAmountCents: null,
        budgetCents: null,
        deletedAt: null,
      };
    }
    return node;
  });
  db.manager.find.mockImplementation(async (entity: unknown): Promise<unknown[]> => {
    if (entity === LineEntity) return siblings.length > 0 ? siblings : node ? [node] : [];
    if (entity === TargetingGroupEntity) return [{ id: TARGETING_GROUP_ID, lever, budgetCents: null }];
    if (entity === AdGroupEntity) return [{ id: AD_GROUP_ID, lever, budgetCents: null }];
    if (entity === LeverEntity) return [{ id: LEVER_ID, lever, budgetCents: null }];
    return [];
  });
}

/** The budget block an only Line of a 1 000 € campaign answers. */
const BUDGET: BudgetBlock = {
  explicitCents: null,
  effectiveCents: 100_000,
  source: 'inherited',
  volume: null,
  perPlatform: [{ platform: 'dv360', shareBasisPoints: 10_000, cents: 100_000 }],
};

/** The API shape of {@link lineRow}, with no Label. */
const BANNER: Line = {
  id: LINE_ID,
  organizationId: IDS.organization,
  campaignId: CAMPAIGN_ID,
  targetingGroupId: TARGETING_GROUP_ID,
  lever: 'dac',
  name: 'Bannière 300x250',
  status: 'active',
  creativeId: null,
  landingPageUrl: null,
  budget: BUDGET,
  startsOn: null,
  endsOn: null,
  capping: null,
  labels: [],
  createdAt: ISO,
  updatedAt: ISO,
  deletedAt: null,
};

describe('Unit::Services::LineService', () => {
  let db: DataSourceMock;
  let access: AccessServiceMock;
  let labels: LabelServiceMock;
  let service: LineService;

  beforeEach((): void => {
    db = createDataSourceMock();
    access = createAccessMock();
    labels = { setOn: jest.fn().mockResolvedValue([SPRING]), summariesOf: jest.fn().mockResolvedValue(new Map()) };
    service = new LineService(db.dataSource, access as never, labels as unknown as LabelService);
    seedAbove(db, lineRow());
    db.manager.save.mockResolvedValue(lineRow());
  });

  describe('toLine', () => {
    it('should map a row to its API shape, dates as ISO strings', (): void => {
      expect(toLine(lineRow(), BUDGET)).toEqual(BANNER);
    });

    it('should carry the deletion instant, its landing page and the Labels', (): void => {
      const line: Line = toLine(lineRow({ deletedAt: NOW, landingPageUrl: 'https://herbea.test/automne' }), BUDGET, [
        SPRING,
      ]);

      expect(line).toMatchObject({
        deletedAt: ISO,
        landingPageUrl: 'https://herbea.test/automne',
        labels: [SPRING],
      });
    });
  });

  describe('list', () => {
    it('should list the Lines of the TargetingGroup, read by a viewer', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('line');
      builder.getManyAndCount.mockResolvedValue([[lineRow()], 1]);
      labels.summariesOf.mockResolvedValue(new Map([[LINE_ID, [SPRING]]]));

      const page: Paginated<Line> = await service.list(JANE, IDS.organization, TARGETING_GROUP_ID, DEFAULT_QUERY);

      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
      expect(page).toEqual({ items: [{ ...BANNER, labels: [SPRING] }], total: 1, page: 1, limit: 50 });
      expect(builder.andWhere).toHaveBeenCalledWith('line.targeting_group_id = :parentId', {
        parentId: TARGETING_GROUP_ID,
      });
    });

    it('should search the name without case nor accents', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('line');

      await service.list(JANE, IDS.organization, TARGETING_GROUP_ID, { ...DEFAULT_QUERY, search: 'Bannière' });

      expect(builder.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE :search'), {
        search: '%Banniere%',
      });
    });

    it('should answer 404 for a TargetingGroup of another Organization', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(service.list(JANE, IDS.organization, TARGETING_GROUP_ID, DEFAULT_QUERY)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'targeting_group_not_found',
      });
    });
  });

  describe('listByCreative', () => {
    const CREATIVE_ID = 'fe000000-0000-4000-8000-000000000001';
    const OTHER_TARGETING_GROUP_ID = 'f4000000-0000-4000-8000-000000000002';

    /**
     * Seed the units of the AdGroups, and the AdGroup each TargetingGroup hangs from.
     *
     * @param units - The units
     * @returns Nothing
     */
    function seedUnits(units: Partial<PlatformUnitEntity>[]): void {
      const above = db.manager.find.getMockImplementation() as (entity: unknown, options?: unknown) => unknown;
      db.manager.find.mockImplementation(
        async (entity: unknown, options?: { select?: { adGroupId?: boolean } }): Promise<unknown> => {
          if (entity === PlatformUnitEntity) return units;
          if (entity === TargetingGroupEntity && options?.select?.adGroupId) {
            return [{ id: TARGETING_GROUP_ID, adGroupId: AD_GROUP_ID }];
          }
          return above(entity, options);
        }
      );
    }

    it('should list the Lines of a creative, each with what every platform made of its ad', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('line');
      builder.getManyAndCount.mockResolvedValue([
        [
          lineRow({ creativeId: CREATIVE_ID }),
          lineRow({ id: OTHER_LINE_ID, targetingGroupId: OTHER_TARGETING_GROUP_ID, creativeId: CREATIVE_ID }),
        ],
        2,
      ]);
      seedUnits([
        {
          platform: 'google_ads',
          adGroupId: AD_GROUP_ID,
          reviews: { [`line:${LINE_ID}`]: { status: 'rejected', reasons: ['ALCOHOL'] } },
        },
        { platform: 'microsoft', adGroupId: AD_GROUP_ID, reviews: {} },
        {
          platform: 'google_ads',
          adGroupId: 'f3000000-0000-4000-8000-000000000009',
          reviews: { [`line:${LINE_ID}`]: { status: 'approved', reasons: [] } },
        },
      ]);

      const page: Paginated<CreativeLine> = await service.listByCreative(
        JANE,
        IDS.organization,
        CREATIVE_ID,
        DEFAULT_QUERY
      );

      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
      expect(builder.andWhere).toHaveBeenCalledWith('line.creative_id = :creativeId', { creativeId: CREATIVE_ID });
      expect(page.total).toBe(2);
      // A verdict is the one of the Line's own AdGroup, at each platform that read it.
      expect(page.items[0]).toMatchObject({
        id: LINE_ID,
        creativeId: CREATIVE_ID,
        reviews: [{ platform: 'google_ads', status: 'rejected', reasons: ['ALCOHOL'] }],
      });
      expect(page.items[1]).toMatchObject({ id: OTHER_LINE_ID, reviews: [] });
      expect(db.manager.find).toHaveBeenCalledWith(
        PlatformUnitEntity,
        expect.objectContaining({ order: { platform: 'ASC' } })
      );
    });

    it('should read no unit for a creative no Line delivers', async (): Promise<void> => {
      seedUnits([]);

      const page: Paginated<CreativeLine> = await service.listByCreative(
        JANE,
        IDS.organization,
        CREATIVE_ID,
        DEFAULT_QUERY
      );

      expect(page).toEqual({ items: [], total: 0, page: 1, limit: 50 });
      expect(db.manager.find).not.toHaveBeenCalledWith(PlatformUnitEntity, expect.anything());
    });

    it('should answer 404 for a creative of another Organization', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(service.listByCreative(JANE, IDS.organization, CREATIVE_ID, DEFAULT_QUERY)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'creative_not_found',
      });
      expect(db.manager.findOne).toHaveBeenCalledWith(CreativeEntity, {
        where: { id: CREATIVE_ID, organizationId: IDS.organization },
        withDeleted: true,
      });
    });
  });

  describe('get', () => {
    it('should read one Line, its budget resolved up the tree', async (): Promise<void> => {
      await expect(service.get(JANE, IDS.organization, LINE_ID)).resolves.toEqual(BANNER);
    });

    it('should say a Line of the Search lever carries no budget (D12)', async (): Promise<void> => {
      seedAbove(db, lineRow({ lever: 'search' }), [], 'search');

      const line: Line = await service.get(JANE, IDS.organization, LINE_ID);

      expect(line.budget).toMatchObject({ effectiveCents: 0, source: 'forbidden', perPlatform: [] });
    });

    it('should answer 404 for a Line of another Organization', async (): Promise<void> => {
      seedAbove(db, null);

      await expect(service.get(JANE, IDS.organization, LINE_ID)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'line_not_found',
      });
    });
  });

  describe('the creative a Line delivers', () => {
    const CREATIVE_ID = 'fe000000-0000-4000-8000-000000000001';

    /**
     * Answer the creative, and the Line of the same TargetingGroup that already delivers it.
     *
     * @param creative - What the creative read answers
     * @param taken - The Line already delivering it, if any
     * @returns Nothing
     */
    function withCreative(creative: object | null, taken: LineEntity | null = null): void {
      const above = db.manager.findOne.getMockImplementation() as (
        entity: unknown,
        options: unknown
      ) => Promise<unknown>;
      db.manager.findOne.mockImplementation(
        async (entity: unknown, options: { where?: { creativeId?: string } }): Promise<unknown> => {
          if (entity === CreativeEntity) return creative;
          if (entity === LineEntity && options?.where?.creativeId) return taken;
          return above(entity, options);
        }
      );
    }

    it('should create a Line delivering a creative of the campaign brand', async (): Promise<void> => {
      withCreative({ id: CREATIVE_ID });
      db.manager.save.mockResolvedValue(lineRow({ creativeId: CREATIVE_ID }));

      await expect(
        service.create(JANE, IDS.organization, TARGETING_GROUP_ID, { name: 'Annonce', creativeId: CREATIVE_ID })
      ).resolves.toMatchObject({ creativeId: CREATIVE_ID });
      expect(db.manager.create).toHaveBeenCalledWith(LineEntity, expect.objectContaining({ creativeId: CREATIVE_ID }));
      expect(db.manager.findOne).toHaveBeenCalledWith(CreativeEntity, {
        where: expect.objectContaining({
          id: CREATIVE_ID,
          organizationId: IDS.organization,
          advertiserId: IDS.advertiser,
        }),
      });
    });

    it('should not find a creative of another brand, or one deleted', async (): Promise<void> => {
      withCreative(null);

      await expect(
        service.create(JANE, IDS.organization, TARGETING_GROUP_ID, { name: 'Annonce', creativeId: CREATIVE_ID })
      ).rejects.toMatchObject({ statusCode: 404, errorCode: 'creative_not_found' });
    });

    it('should refuse a creative another Line of the TargetingGroup already delivers', async (): Promise<void> => {
      withCreative({ id: CREATIVE_ID }, lineRow({ id: OTHER_LINE_ID, name: 'Annonce A' }));

      await expect(service.update(JANE, IDS.organization, LINE_ID, { creativeId: CREATIVE_ID })).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'line_creative_duplicated',
        errorParams: { line: 'Annonce A' },
      });
    });

    it('should let a Line keep the creative it delivers, and give it back', async (): Promise<void> => {
      withCreative({ id: CREATIVE_ID }, lineRow({ creativeId: CREATIVE_ID }));

      await service.update(JANE, IDS.organization, LINE_ID, { creativeId: CREATIVE_ID });
      expect(db.manager.save).toHaveBeenLastCalledWith(
        LineEntity,
        expect.objectContaining({ creativeId: CREATIVE_ID })
      );

      await service.update(JANE, IDS.organization, LINE_ID, { creativeId: null });
      expect(db.manager.save).toHaveBeenLastCalledWith(LineEntity, expect.objectContaining({ creativeId: null }));
    });
  });

  describe('create', () => {
    it('should create a Line with its landing page and its Labels', async (): Promise<void> => {
      db.manager.save.mockResolvedValue(lineRow({ landingPageUrl: 'https://herbea.test/automne' }));

      await expect(
        service.create(JANE, IDS.organization, TARGETING_GROUP_ID, {
          name: 'Bannière 300x250',
          landingPageUrl: 'https://herbea.test/automne',
          labelIds: [SPRING.id],
        })
      ).resolves.toMatchObject({ landingPageUrl: 'https://herbea.test/automne', labels: [SPRING] });
      expect(db.manager.create).toHaveBeenCalledWith(
        LineEntity,
        expect.objectContaining({
          campaignId: CAMPAIGN_ID,
          targetingGroupId: TARGETING_GROUP_ID,
          lever: 'dac',
          landingPageUrl: 'https://herbea.test/automne',
        })
      );
    });

    it('should create a Line with no landing page and no Label', async (): Promise<void> => {
      await expect(
        service.create(JANE, IDS.organization, TARGETING_GROUP_ID, { name: 'Bannière 300x250' })
      ).resolves.toEqual(BANNER);
      expect(labels.setOn).not.toHaveBeenCalled();
    });

    it('should refuse a budget on a Line of the Search lever (D12)', async (): Promise<void> => {
      seedAbove(db, lineRow({ lever: 'search' }), [], 'search');

      await expect(
        service.create(JANE, IDS.organization, TARGETING_GROUP_ID, { name: 'Annonce RSA', budgetCents: 10_000 })
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'lever_field_forbidden',
        errorParams: { lever: 'search', level: 'line', field: 'budget' },
      });
    });

    it('should accept a window inside its parents', async (): Promise<void> => {
      await service.create(JANE, IDS.organization, TARGETING_GROUP_ID, {
        name: 'Bannière 300x250',
        startsOn: '2026-11-10',
        endsOn: '2026-11-15',
      });

      expect(db.manager.create).toHaveBeenCalledWith(
        LineEntity,
        expect.objectContaining({ startsOn: '2026-11-10', endsOn: '2026-11-15' })
      );
    });

    it('should refuse a window outside the campaign', async (): Promise<void> => {
      await expect(
        service.create(JANE, IDS.organization, TARGETING_GROUP_ID, {
          name: 'Bannière 300x250',
          startsOn: '2026-10-01',
          endsOn: '2026-11-10',
        })
      ).rejects.toMatchObject({ errorCode: 'dates_outside_parent' });
    });

    it('should refuse a budget that overflows its TargetingGroup', async (): Promise<void> => {
      seedAbove(db, lineRow(), [lineRow({ id: OTHER_LINE_ID, budgetCents: 90_000 })]);

      await expect(
        service.create(JANE, IDS.organization, TARGETING_GROUP_ID, { name: 'Bannière', budgetCents: 20_000 })
      ).rejects.toMatchObject({ errorCode: 'budget_exceeds_parent' });
    });

    it('should answer 404 for a TargetingGroup of another Organization', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(
        service.create(JANE, IDS.organization, TARGETING_GROUP_ID, { name: 'Bannière' })
      ).rejects.toMatchObject({ statusCode: 404, errorCode: 'targeting_group_not_found' });
    });
  });

  describe('update', () => {
    it('should rename a Line', async (): Promise<void> => {
      db.manager.save.mockResolvedValue(lineRow({ name: 'Bannière 728x90' }));

      await expect(service.update(JANE, IDS.organization, LINE_ID, { name: 'Bannière 728x90' })).resolves.toMatchObject(
        { name: 'Bannière 728x90' }
      );
    });

    it('should set its landing page, and clear it', async (): Promise<void> => {
      await service.update(JANE, IDS.organization, LINE_ID, { landingPageUrl: 'https://herbea.test/hiver' });
      expect(db.manager.save).toHaveBeenCalledWith(
        LineEntity,
        expect.objectContaining({ landingPageUrl: 'https://herbea.test/hiver' })
      );

      await service.update(JANE, IDS.organization, LINE_ID, { landingPageUrl: null });
      expect(db.manager.save).toHaveBeenCalledWith(LineEntity, expect.objectContaining({ landingPageUrl: null }));
    });

    it('should accept a body changing nothing', async (): Promise<void> => {
      await expect(service.update(JANE, IDS.organization, LINE_ID, {})).resolves.toMatchObject({ id: LINE_ID });
    });

    it('should answer 404 for a Line of another Organization', async (): Promise<void> => {
      seedAbove(db, null);

      await expect(service.update(JANE, IDS.organization, LINE_ID, {})).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'line_not_found',
      });
    });
  });

  describe('delete and restore', () => {
    it('should soft-delete a Line and answer when', async (): Promise<void> => {
      const result: DeletionResult = await service.delete(JANE, IDS.organization, LINE_ID);

      expect(result.id).toBe(LINE_ID);
      expect(Date.parse(result.deletedAt as string)).not.toBeNaN();
    });

    it('should restore a deleted Line', async (): Promise<void> => {
      seedAbove(db, lineRow({ deletedAt: NOW }));

      await expect(service.restore(JANE, IDS.organization, LINE_ID)).resolves.toEqual({
        id: LINE_ID,
        deletedAt: null,
      });
    });

    it('should answer 409 for a Line that is not deleted', async (): Promise<void> => {
      await expect(service.restore(JANE, IDS.organization, LINE_ID)).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'line_not_deleted',
      });
    });
  });

  describe('setLabels', () => {
    it('should replace the Labels of a Line', async (): Promise<void> => {
      await expect(service.setLabels(JANE, IDS.organization, LINE_ID, { labelIds: [SPRING.id] })).resolves.toEqual({
        ...BANNER,
        labels: [SPRING],
      });
    });

    it('should answer 404 for a deleted Line', async (): Promise<void> => {
      seedAbove(db, null);

      await expect(service.setLabels(JANE, IDS.organization, LINE_ID, { labelIds: [] })).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'line_not_found',
      });
    });
  });

  describe('the bulk routes', () => {
    it('should create every item of an atomic bulk under the TargetingGroup', async (): Promise<void> => {
      const result: BulkResult<Line> = await service.bulkCreate(JANE, IDS.organization, TARGETING_GROUP_ID, {
        mode: 'atomic',
        items: [{ name: 'Bannière 300x250' }, { name: 'Bannière 728x90' }],
      });

      expect(result.items).toHaveLength(2);
      expect(result.failed).toEqual([]);
    });

    it('should report what a partial bulk could not create', async (): Promise<void> => {
      seedAbove(db, lineRow({ lever: 'search' }), [], 'search');

      const result: BulkResult<Line> = await service.bulkCreate(JANE, IDS.organization, TARGETING_GROUP_ID, {
        mode: 'partial',
        items: [{ name: 'Annonce RSA' }, { name: 'Avec budget', budgetCents: 1_000 }],
      });

      expect(result.items).toHaveLength(1);
      expect(result.failed).toEqual([
        { index: 1, code: 'lever_field_forbidden', params: expect.any(Object), message: expect.any(String) },
      ]);
    });

    it('should update, delete and restore several Lines', async (): Promise<void> => {
      await expect(
        service.bulkUpdate(JANE, IDS.organization, { mode: 'atomic', items: [{ id: LINE_ID, name: 'Bannière' }] })
      ).resolves.toMatchObject({ items: [{ id: LINE_ID }] });

      await expect(
        service.bulkDelete(JANE, IDS.organization, { mode: 'atomic', ids: [LINE_ID] })
      ).resolves.toMatchObject({ items: [{ id: LINE_ID }] });

      seedAbove(db, lineRow({ deletedAt: NOW }));
      await expect(
        service.bulkRestore(JANE, IDS.organization, { mode: 'atomic', ids: [LINE_ID] })
      ).resolves.toMatchObject({ items: [{ id: LINE_ID, deletedAt: null }] });
    });

    it('should refuse a bulk naming the same Line twice', async (): Promise<void> => {
      for (const call of [
        service.bulkUpdate(JANE, IDS.organization, {
          mode: 'atomic',
          items: [
            { id: LINE_ID, name: 'A' },
            { id: LINE_ID, name: 'B' },
          ],
        }),
        service.bulkDelete(JANE, IDS.organization, { mode: 'atomic', ids: [LINE_ID, LINE_ID] }),
        service.bulkRestore(JANE, IDS.organization, { mode: 'atomic', ids: [LINE_ID, LINE_ID] }),
      ]) {
        await expect(call).rejects.toMatchObject({ statusCode: 400, errorCode: 'bulk_ids_duplicated' });
      }
    });
  });

  describe('LineServicePlugin', () => {
    it('should decorate the instance with a LineService wired to its dependencies', async (): Promise<void> => {
      const app: FastifyInstance = await buildServiceApp([LabelServicePlugin, LineServicePlugin], { db, access });

      expect(app.lineService).toBeInstanceOf(LineService);
      await expect(app.lineService.get(JANE, IDS.organization, LINE_ID)).resolves.toMatchObject({ id: LINE_ID });

      await app.close();
    });
  });

  describe('refusals of the access service', () => {
    it('should let a refused role travel out untouched', async (): Promise<void> => {
      access.assertOrganizationRole.mockRejectedValue(
        httpError(403, 'Requires the manager role', { code: 'role_required' })
      );

      await expect(
        service.create(JANE, IDS.organization, TARGETING_GROUP_ID, { name: 'Bannière' })
      ).rejects.toMatchObject({ statusCode: 403, errorCode: 'role_required' });
      expect(db.mocks.transaction).not.toHaveBeenCalled();
    });
  });
});
