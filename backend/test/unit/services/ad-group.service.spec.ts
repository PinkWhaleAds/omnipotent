import { FastifyInstance } from 'fastify';

import { AdGroupEntity, CampaignEntity, ConversionGoalEntity, LeverEntity } from '@src/database/entities';
import AdGroupServicePlugin, { AdGroupService, toAdGroup } from '@src/services/ad-group.service';
import LabelServicePlugin, { LabelService } from '@src/services/label.service';
import { AdGroup, ListAdGroupsQuery } from '@src/types/ad-group.types';
import { Paginated } from '@src/types/api.types';
import { BulkResult, DeletionResult } from '@src/types/crud.types';
import { LabelSummary } from '@src/types/label.types';
import { PlatformShare } from '@src/types/platform.types';
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
const OTHER_AD_GROUP_ID = 'f3000000-0000-4000-8000-000000000002';

/** A Label as an AdGroup carries it. */
const SPRING: LabelSummary = { id: 'e0000000-0000-4000-8000-000000000001', name: 'Printemps', color: '#1f6feb' };

/** The distribution key of the lever the AdGroups hang from. */
const SHARES: PlatformShare[] = [
  { platform: 'hawk', shareBasisPoints: 4_000 },
  { platform: 'dv360', shareBasisPoints: 6_000 },
];

/** The query a list route hands the service when the caller asked for nothing in particular. */
const DEFAULT_QUERY: ListAdGroupsQuery = {
  page: 1,
  limit: 50,
  sortBy: 'name',
  sortOrder: 'asc',
  labelMode: 'any',
  includeDeleted: false,
};

/** Jest mocks of the {@link LabelService} methods an AdGroup needs. */
type LabelServiceMock = { setOn: jest.Mock; summariesOf: jest.Mock };

/**
 * Build an AdGroup row.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function adGroupRow(overrides: Partial<AdGroupEntity> = {}): AdGroupEntity {
  return {
    id: AD_GROUP_ID,
    organizationId: IDS.organization,
    campaignId: CAMPAIGN_ID,
    leverId: LEVER_ID,
    lever: 'dac',
    name: 'Prospection',
    status: 'active',
    objective: 'awareness',
    bidStrategy: 'fixed_cpm',
    bidAmountCents: 450,
    platformShares: null,
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
  } as AdGroupEntity;
}

/**
 * The rows the tree above an AdGroup is made of: a campaign of 1 000 € and one `dac` lever.
 *
 * @param db - The data source mock to arrange
 * @param adGroup - The AdGroup `findOne` answers for its own entity, `null` to answer nothing
 * @param siblings - The AdGroups of the lever, which divide its budget
 */
function seedAbove(db: DataSourceMock, adGroup: AdGroupEntity | null, siblings: AdGroupEntity[] = []): void {
  db.manager.findOne.mockImplementation(async (entity: unknown): Promise<unknown> => {
    if (entity === CampaignEntity) {
      return {
        id: CAMPAIGN_ID,
        organizationId: IDS.organization,
        budgetCents: 100_000,
        startsOn: '2026-11-05',
        endsOn: '2026-11-20',
        deletedAt: null,
      };
    }
    if (entity === LeverEntity) {
      return {
        id: LEVER_ID,
        organizationId: IDS.organization,
        campaignId: CAMPAIGN_ID,
        lever: 'dac',
        platformShares: SHARES,
        budgetCents: null,
        startsOn: null,
        endsOn: null,
        deletedAt: null,
      };
    }
    return adGroup;
  });
  db.manager.find.mockImplementation(async (entity: unknown): Promise<unknown[]> => {
    if (entity === AdGroupEntity) return siblings.length > 0 ? siblings : adGroup ? [adGroup] : [];
    if (entity === LeverEntity) return [{ id: LEVER_ID, lever: 'dac', budgetCents: null }];
    return [];
  });
}

/** The budget block an only AdGroup of a 1 000 € campaign answers. */
const BUDGET: BudgetBlock = {
  explicitCents: null,
  effectiveCents: 100_000,
  source: 'inherited',
  volume: null,
  perPlatform: [
    { platform: 'hawk', shareBasisPoints: 4_000, cents: 40_000 },
    { platform: 'dv360', shareBasisPoints: 6_000, cents: 60_000 },
  ],
};

/** The API shape of {@link adGroupRow}, with no Label. */
const PROSPECTION: AdGroup = {
  id: AD_GROUP_ID,
  organizationId: IDS.organization,
  campaignId: CAMPAIGN_ID,
  leverId: LEVER_ID,
  lever: 'dac',
  name: 'Prospection',
  status: 'active',
  objective: 'awareness',
  bidStrategy: 'fixed_cpm',
  bidAmountCents: 450,
  conversionGoalId: null,
  platformShares: null,
  locationIntent: null,
  budget: BUDGET,
  startsOn: null,
  endsOn: null,
  capping: null,
  labels: [],
  createdAt: ISO,
  updatedAt: ISO,
  deletedAt: null,
};

describe('Unit::Services::AdGroupService', () => {
  let db: DataSourceMock;
  let access: AccessServiceMock;
  let labels: LabelServiceMock;
  let service: AdGroupService;

  beforeEach((): void => {
    db = createDataSourceMock();
    access = createAccessMock();
    labels = { setOn: jest.fn().mockResolvedValue([SPRING]), summariesOf: jest.fn().mockResolvedValue(new Map()) };
    service = new AdGroupService(db.dataSource, access as never, labels as unknown as LabelService);
    seedAbove(db, adGroupRow());
    db.manager.save.mockResolvedValue(adGroupRow());
  });

  describe('toAdGroup', () => {
    it('should map a row to its API shape, dates as ISO strings', (): void => {
      expect(toAdGroup(adGroupRow(), BUDGET)).toEqual(PROSPECTION);
    });

    it('should carry the deletion instant, its own key and the Labels', (): void => {
      const adGroup: AdGroup = toAdGroup(adGroupRow({ deletedAt: NOW, platformShares: SHARES }), BUDGET, [SPRING]);

      expect(adGroup).toMatchObject({ deletedAt: ISO, platformShares: SHARES, labels: [SPRING] });
    });
  });

  describe('list', () => {
    it('should list the AdGroups of the lever, read by a viewer', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('ad_group');
      builder.getManyAndCount.mockResolvedValue([[adGroupRow()], 1]);
      labels.summariesOf.mockResolvedValue(new Map([[AD_GROUP_ID, [SPRING]]]));

      const page: Paginated<AdGroup> = await service.list(JANE, IDS.organization, LEVER_ID, DEFAULT_QUERY);

      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
      expect(page).toEqual({ items: [{ ...PROSPECTION, labels: [SPRING] }], total: 1, page: 1, limit: 50 });
      expect(builder.andWhere).toHaveBeenCalledWith('ad_group.lever_id = :parentId', { parentId: LEVER_ID });
    });

    it('should search the name without case nor accents', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('ad_group');

      await service.list(JANE, IDS.organization, LEVER_ID, { ...DEFAULT_QUERY, search: 'Prospéction' });

      expect(builder.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE :search'), {
        search: '%Prospection%',
      });
    });

    it('should answer 404 for a lever of another Organization', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(service.list(JANE, IDS.organization, LEVER_ID, DEFAULT_QUERY)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'lever_not_found',
      });
    });
  });

  describe('get', () => {
    it('should read one AdGroup, its budget resolved up the tree', async (): Promise<void> => {
      await expect(service.get(JANE, IDS.organization, AD_GROUP_ID)).resolves.toEqual(PROSPECTION);
    });

    it('should divide the lever between the AdGroups that share it', async (): Promise<void> => {
      seedAbove(db, adGroupRow(), [adGroupRow(), adGroupRow({ id: OTHER_AD_GROUP_ID })]);

      const adGroup: AdGroup = await service.get(JANE, IDS.organization, AD_GROUP_ID);

      expect(adGroup.budget.effectiveCents).toBe(50_000);
      expect(adGroup.budget.perPlatform).toEqual([
        { platform: 'hawk', shareBasisPoints: 4_000, cents: 20_000 },
        { platform: 'dv360', shareBasisPoints: 6_000, cents: 30_000 },
      ]);
    });

    it('should answer 404 for an AdGroup of another Organization', async (): Promise<void> => {
      seedAbove(db, null);

      await expect(service.get(JANE, IDS.organization, AD_GROUP_ID)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'ad_group_not_found',
      });
    });
  });

  describe('create', () => {
    it('should create an AdGroup with the objective and the strategy its lever defaults to', async (): Promise<void> => {
      await expect(
        service.create(JANE, IDS.organization, LEVER_ID, { name: 'Prospection', labelIds: [SPRING.id] })
      ).resolves.toEqual({ ...PROSPECTION, labels: [SPRING] });
      expect(db.manager.create).toHaveBeenCalledWith(
        AdGroupEntity,
        expect.objectContaining({
          campaignId: CAMPAIGN_ID,
          leverId: LEVER_ID,
          lever: 'dac',
          objective: 'awareness',
          bidStrategy: 'fixed_cpm',
        })
      );
      expect(labels.setOn).toHaveBeenCalledWith(db.manager, IDS.organization, 'ad_group', AD_GROUP_ID, [SPRING.id]);
    });

    it('should create an AdGroup with no Label and no key of its own', async (): Promise<void> => {
      await expect(service.create(JANE, IDS.organization, LEVER_ID, { name: 'Prospection' })).resolves.toEqual(
        PROSPECTION
      );
      expect(labels.setOn).not.toHaveBeenCalled();
    });

    it('should accept an objective and a strategy its lever permits', async (): Promise<void> => {
      await service.create(JANE, IDS.organization, LEVER_ID, {
        name: 'Prospection',
        objective: 'awareness',
        bidStrategy: 'maximize_reach',
        bidAmountCents: 300,
      });

      expect(db.manager.create).toHaveBeenCalledWith(
        AdGroupEntity,
        expect.objectContaining({ bidStrategy: 'maximize_reach', bidAmountCents: 300 })
      );
    });

    it('should refuse an objective its lever does not permit', async (): Promise<void> => {
      await expect(
        service.create(JANE, IDS.organization, LEVER_ID, { name: 'Prospection', objective: 'app_installs' })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'objective_not_permitted' });
    });

    it('should refuse a strategy of another paradigm', async (): Promise<void> => {
      await expect(
        service.create(JANE, IDS.organization, LEVER_ID, { name: 'Prospection', bidStrategy: 'maximize_clicks' })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'bid_strategy_not_permitted' });
    });

    it('should accept its own distribution key', async (): Promise<void> => {
      const own: PlatformShare[] = [{ platform: 'dv360', shareBasisPoints: 10_000 }];
      db.manager.save.mockResolvedValue(adGroupRow({ platformShares: own }));

      await expect(
        service.create(JANE, IDS.organization, LEVER_ID, { name: 'Prospection', platformShares: own })
      ).resolves.toMatchObject({ platformShares: own });
    });

    it('should refuse a key with a platform its lever does not serve', async (): Promise<void> => {
      await expect(
        service.create(JANE, IDS.organization, LEVER_ID, {
          name: 'Prospection',
          platformShares: [{ platform: 'google_ads', shareBasisPoints: 10_000 }],
        })
      ).rejects.toMatchObject({ errorCode: 'platform_not_eligible' });
    });

    it('should convert a budget entered in volume through its bid CPM', async (): Promise<void> => {
      await service.create(JANE, IDS.organization, LEVER_ID, {
        name: 'Prospection',
        bidAmountCents: 450,
        budgetVolume: { amount: 100_000, unit: 'impressions' },
      });

      expect(db.manager.create).toHaveBeenCalledWith(
        AdGroupEntity,
        expect.objectContaining({ budgetCents: 45_000, budgetVolume: 100_000, budgetVolumeUnit: 'impressions' })
      );
    });

    it('should refuse a volume with no CPM to convert it', async (): Promise<void> => {
      await expect(
        service.create(JANE, IDS.organization, LEVER_ID, {
          name: 'Prospection',
          budgetVolume: { amount: 100_000, unit: 'impressions' },
        })
      ).rejects.toMatchObject({ errorCode: 'volume_without_bid' });
    });

    it('should refuse a budget that overflows its lever', async (): Promise<void> => {
      seedAbove(db, adGroupRow(), [adGroupRow({ budgetCents: 80_000, id: OTHER_AD_GROUP_ID })]);

      await expect(
        service.create(JANE, IDS.organization, LEVER_ID, { name: 'Prospection', budgetCents: 40_000 })
      ).rejects.toMatchObject({ errorCode: 'budget_exceeds_parent' });
    });

    it('should answer 404 for a lever of another Organization', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(service.create(JANE, IDS.organization, LEVER_ID, { name: 'Prospection' })).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'lever_not_found',
      });
    });
  });

  describe('who its places reach', () => {
    it('should keep it on a Search AdGroup, and answer it', async (): Promise<void> => {
      seedAbove(db, adGroupRow({ lever: 'search' }));
      db.manager.save.mockResolvedValue(adGroupRow({ lever: 'search', locationIntent: 'presence_or_interest' }));

      await expect(
        service.update(JANE, IDS.organization, AD_GROUP_ID, { locationIntent: 'presence_or_interest' })
      ).resolves.toMatchObject({ locationIntent: 'presence_or_interest' });
      expect(db.manager.save).toHaveBeenCalledWith(
        AdGroupEntity,
        expect.objectContaining({ locationIntent: 'presence_or_interest' })
      );
    });

    it('should refuse it on a lever that has no use for it', async (): Promise<void> => {
      await expect(
        service.create(JANE, IDS.organization, LEVER_ID, { name: 'Prospection', locationIntent: 'presence' })
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'lever_field_forbidden',
        errorParams: { lever: 'dac', level: 'ad_group', field: 'locationIntent' },
      });
      await expect(
        service.update(JANE, IDS.organization, AD_GROUP_ID, { locationIntent: 'presence' })
      ).rejects.toMatchObject({ errorCode: 'lever_field_forbidden' });
    });

    it('should accept giving it back, on any lever', async (): Promise<void> => {
      await service.update(JANE, IDS.organization, AD_GROUP_ID, { locationIntent: null });

      expect(db.manager.save).toHaveBeenCalledWith(AdGroupEntity, expect.objectContaining({ locationIntent: null }));
    });
  });

  describe('the conversion goal it optimizes (D58)', () => {
    /** The goal of these specs. */
    const GOAL_ID = 'f9000000-0000-4000-8000-000000000001';

    /**
     * Answer the goal the AdGroup names, and the Advertiser of its campaign.
     *
     * @param goal - The goal the lookup finds, `null` for none
     * @returns Nothing
     */
    function seedGoal(goal: object | null): void {
      const above = db.manager.findOne.getMockImplementation() as (entity: unknown) => Promise<unknown>;
      db.manager.findOne.mockImplementation(async (entity: unknown): Promise<unknown> => {
        if (entity === ConversionGoalEntity) return goal;
        if (entity === CampaignEntity) return { ...((await above(entity)) as object), advertiserId: IDS.advertiser };
        return above(entity);
      });
    }

    it("should name a goal of its campaign's Advertiser on create", async (): Promise<void> => {
      seedGoal({ id: GOAL_ID, name: 'Achat', status: 'active' });

      await service.create(JANE, IDS.organization, LEVER_ID, { name: 'Prospection', conversionGoalId: GOAL_ID });

      expect(db.manager.findOne).toHaveBeenCalledWith(ConversionGoalEntity, {
        where: { id: GOAL_ID, organizationId: IDS.organization, advertiserId: IDS.advertiser },
      });
      expect(db.manager.create).toHaveBeenCalledWith(
        AdGroupEntity,
        expect.objectContaining({ conversionGoalId: GOAL_ID })
      );
    });

    it('should refuse a goal of another Advertiser, and an archived one', async (): Promise<void> => {
      seedGoal(null);
      await expect(
        service.create(JANE, IDS.organization, LEVER_ID, { name: 'Prospection', conversionGoalId: GOAL_ID })
      ).rejects.toMatchObject({ statusCode: 404, errorCode: 'conversion_goal_not_found' });

      seedGoal({ id: GOAL_ID, name: 'Achat', status: 'archived' });
      await expect(
        service.update(JANE, IDS.organization, AD_GROUP_ID, { conversionGoalId: GOAL_ID })
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'conversion_goal_archived',
        errorParams: { goalName: 'Achat' },
      });
    });

    it('should check a goal on update only when it changes, and let null name none', async (): Promise<void> => {
      seedAbove(db, adGroupRow({ conversionGoalId: GOAL_ID }));
      seedGoal({ id: GOAL_ID, name: 'Achat', status: 'archived' });

      await service.update(JANE, IDS.organization, AD_GROUP_ID, { conversionGoalId: GOAL_ID });
      await service.update(JANE, IDS.organization, AD_GROUP_ID, { conversionGoalId: null });

      expect(db.manager.findOne).not.toHaveBeenCalledWith(ConversionGoalEntity, expect.anything());
      expect(db.manager.save).toHaveBeenLastCalledWith(
        AdGroupEntity,
        expect.objectContaining({ conversionGoalId: null })
      );
    });

    it('should answer the goal it names', (): void => {
      expect(toAdGroup(adGroupRow({ conversionGoalId: GOAL_ID }), BUDGET).conversionGoalId).toBe(GOAL_ID);
    });
  });

  describe('update', () => {
    it('should rename an AdGroup and leave the rest alone', async (): Promise<void> => {
      db.manager.save.mockResolvedValue(adGroupRow({ name: 'Retargeting' }));

      await expect(service.update(JANE, IDS.organization, AD_GROUP_ID, { name: 'Retargeting' })).resolves.toMatchObject(
        { name: 'Retargeting' }
      );
    });

    it('should change the objective, the strategy, the amount and the key', async (): Promise<void> => {
      const own: PlatformShare[] = [{ platform: 'hawk', shareBasisPoints: 10_000 }];

      await service.update(JANE, IDS.organization, AD_GROUP_ID, {
        objective: 'awareness',
        bidStrategy: 'from_deal',
        bidAmountCents: null,
        platformShares: own,
      });

      expect(db.manager.save).toHaveBeenCalledWith(
        AdGroupEntity,
        expect.objectContaining({ bidStrategy: 'from_deal', bidAmountCents: null, platformShares: own })
      );
    });

    it('should refuse an objective or a strategy its lever does not permit', async (): Promise<void> => {
      await expect(
        service.update(JANE, IDS.organization, AD_GROUP_ID, { objective: 'store_visits' })
      ).rejects.toMatchObject({ errorCode: 'objective_not_permitted' });
      await expect(
        service.update(JANE, IDS.organization, AD_GROUP_ID, { bidStrategy: 'max_cpc' })
      ).rejects.toMatchObject({ errorCode: 'bid_strategy_not_permitted' });
    });

    it('should refuse a key its lever cannot serve', async (): Promise<void> => {
      await expect(
        service.update(JANE, IDS.organization, AD_GROUP_ID, {
          platformShares: [{ platform: 'snap', shareBasisPoints: 10_000 }],
        })
      ).rejects.toMatchObject({ errorCode: 'platform_not_eligible' });
    });

    it('should convert a volume through the amount it already carries', async (): Promise<void> => {
      await service.update(JANE, IDS.organization, AD_GROUP_ID, {
        budgetVolume: { amount: 10_000, unit: 'impressions' },
      });

      expect(db.manager.save).toHaveBeenCalledWith(
        AdGroupEntity,
        expect.objectContaining({ budgetCents: 4_500, budgetVolume: 10_000 })
      );
    });

    it('should accept a body changing nothing', async (): Promise<void> => {
      await expect(service.update(JANE, IDS.organization, AD_GROUP_ID, {})).resolves.toMatchObject({
        id: AD_GROUP_ID,
      });
    });

    it('should answer 404 for an AdGroup of another Organization', async (): Promise<void> => {
      seedAbove(db, null);

      await expect(service.update(JANE, IDS.organization, AD_GROUP_ID, {})).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'ad_group_not_found',
      });
    });
  });

  describe('delete and restore', () => {
    it('should soft-delete an AdGroup and answer when', async (): Promise<void> => {
      const result: DeletionResult = await service.delete(JANE, IDS.organization, AD_GROUP_ID);

      expect(result.id).toBe(AD_GROUP_ID);
      expect(Date.parse(result.deletedAt as string)).not.toBeNaN();
    });

    it('should restore a deleted AdGroup', async (): Promise<void> => {
      seedAbove(db, adGroupRow({ deletedAt: NOW }));

      await expect(service.restore(JANE, IDS.organization, AD_GROUP_ID)).resolves.toEqual({
        id: AD_GROUP_ID,
        deletedAt: null,
      });
    });

    it('should answer 409 for an AdGroup that is not deleted', async (): Promise<void> => {
      await expect(service.restore(JANE, IDS.organization, AD_GROUP_ID)).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'ad_group_not_deleted',
      });
    });
  });

  describe('setLabels', () => {
    it('should replace the Labels of an AdGroup', async (): Promise<void> => {
      await expect(service.setLabels(JANE, IDS.organization, AD_GROUP_ID, { labelIds: [SPRING.id] })).resolves.toEqual({
        ...PROSPECTION,
        labels: [SPRING],
      });
    });

    it('should answer 404 for a deleted AdGroup', async (): Promise<void> => {
      seedAbove(db, null);

      await expect(service.setLabels(JANE, IDS.organization, AD_GROUP_ID, { labelIds: [] })).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'ad_group_not_found',
      });
    });
  });

  describe('the bulk routes', () => {
    it('should create every item of an atomic bulk under the lever', async (): Promise<void> => {
      const result: BulkResult<AdGroup> = await service.bulkCreate(JANE, IDS.organization, LEVER_ID, {
        mode: 'atomic',
        items: [{ name: 'Prospection' }, { name: 'Retargeting' }],
      });

      expect(result.items).toHaveLength(2);
      expect(result.failed).toEqual([]);
    });

    it('should report what a partial bulk could not create', async (): Promise<void> => {
      const result: BulkResult<AdGroup> = await service.bulkCreate(JANE, IDS.organization, LEVER_ID, {
        mode: 'partial',
        items: [{ name: 'Prospection' }, { name: 'Impossible', objective: 'app_installs' }],
      });

      expect(result.items).toHaveLength(1);
      expect(result.failed).toEqual([
        { index: 1, code: 'objective_not_permitted', params: expect.any(Object), message: expect.any(String) },
      ]);
    });

    it('should update, delete and restore several AdGroups', async (): Promise<void> => {
      await expect(
        service.bulkUpdate(JANE, IDS.organization, {
          mode: 'atomic',
          items: [{ id: AD_GROUP_ID, name: 'Prospection' }],
        })
      ).resolves.toMatchObject({ items: [{ id: AD_GROUP_ID }] });

      await expect(
        service.bulkDelete(JANE, IDS.organization, { mode: 'atomic', ids: [AD_GROUP_ID] })
      ).resolves.toMatchObject({ items: [{ id: AD_GROUP_ID }] });

      seedAbove(db, adGroupRow({ deletedAt: NOW }));
      await expect(
        service.bulkRestore(JANE, IDS.organization, { mode: 'atomic', ids: [AD_GROUP_ID] })
      ).resolves.toMatchObject({ items: [{ id: AD_GROUP_ID, deletedAt: null }] });
    });

    it('should refuse a bulk naming the same AdGroup twice', async (): Promise<void> => {
      for (const call of [
        service.bulkUpdate(JANE, IDS.organization, {
          mode: 'atomic',
          items: [
            { id: AD_GROUP_ID, name: 'A' },
            { id: AD_GROUP_ID, name: 'B' },
          ],
        }),
        service.bulkDelete(JANE, IDS.organization, { mode: 'atomic', ids: [AD_GROUP_ID, AD_GROUP_ID] }),
        service.bulkRestore(JANE, IDS.organization, { mode: 'atomic', ids: [AD_GROUP_ID, AD_GROUP_ID] }),
      ]) {
        await expect(call).rejects.toMatchObject({ statusCode: 400, errorCode: 'bulk_ids_duplicated' });
      }
    });
  });

  describe('AdGroupServicePlugin', () => {
    it('should decorate the instance with an AdGroupService wired to its dependencies', async (): Promise<void> => {
      const app: FastifyInstance = await buildServiceApp([LabelServicePlugin, AdGroupServicePlugin], { db, access });

      expect(app.adGroupService).toBeInstanceOf(AdGroupService);
      await expect(app.adGroupService.get(JANE, IDS.organization, AD_GROUP_ID)).resolves.toMatchObject({
        id: AD_GROUP_ID,
      });

      await app.close();
    });
  });

  describe('refusals of the access service', () => {
    it('should let a refused role travel out untouched', async (): Promise<void> => {
      access.assertOrganizationRole.mockRejectedValue(
        httpError(403, 'Requires the manager role', { code: 'role_required' })
      );

      await expect(service.create(JANE, IDS.organization, LEVER_ID, { name: 'Prospection' })).rejects.toMatchObject({
        statusCode: 403,
        errorCode: 'role_required',
      });
      expect(db.mocks.transaction).not.toHaveBeenCalled();
    });
  });
});
