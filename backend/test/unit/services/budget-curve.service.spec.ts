import { FastifyInstance } from 'fastify';
import { ObjectLiteral } from 'typeorm';

import { AdGroupEntity, BudgetDayEntity, CampaignEntity, LeverEntity } from '@src/database/entities';
import BudgetCurveServicePlugin, { BudgetCurveService, dropCurve } from '@src/services/budget-curve.service';
import { AuthContext, BudgetCurve, BudgetDay, Pacing } from '@src/types';
import { AccessServiceMock, buildServiceApp, createAccessMock } from '@test/unit/mocks/access.mock';
import { actor, IDS, JANE } from '@test/unit/mocks/auth.fixtures';
import { createTreeStore, TreeStore } from '@test/unit/mocks/tree-store.mock';
import { httpError } from '@utils';

/** The ids the specs work with. */
const CAMPAIGN_ID = 'f1000000-0000-4000-8000-000000000001';
const LEVER_ID = 'f2000000-0000-4000-8000-000000000001';
const AD_GROUP_ID = 'f3000000-0000-4000-8000-000000000001';
const OTHER_AD_GROUP_ID = 'f3000000-0000-4000-8000-000000000002';

/** A fixed clock, inside the window of the campaign: Wednesday 6 January 2027, 10:00 UTC. */
const NOW: number = Date.parse('2027-01-06T10:00:00Z');

/** The window of the campaign: a week, Friday to Thursday. */
const WINDOW = { startsOn: '2027-01-01', endsOn: '2027-01-07' };

/**
 * Seed a **draft** campaign of 700 €, one `dac` lever, and one AdGroup carrying 140 € of its own.
 *
 * A draft has no day already past, which is how a curve gets shaped in the first place; the tests
 * that need frozen days seed a launched campaign themselves.
 *
 * @param store - The store to seed
 * @param overrides - Columns to change on the campaign and on the AdGroup
 * @param overrides.campaign - Columns of the campaign
 * @param overrides.adGroup - Columns of the AdGroup
 */
function seedTree(store: TreeStore, overrides: { campaign?: ObjectLiteral; adGroup?: ObjectLiteral } = {}): void {
  const node = (extra: ObjectLiteral): ObjectLiteral => ({
    organizationId: IDS.organization,
    budgetCents: null,
    deletedAt: null,
    createdAt: new Date('2026-12-01T00:00:00.000Z'),
    ...extra,
  });
  store.seed(CampaignEntity, [
    node({
      id: CAMPAIGN_ID,
      status: 'draft',
      timezone: null,
      budgetCents: 70_000,
      ...WINDOW,
      ...overrides.campaign,
    }),
  ]);
  store.seed(LeverEntity, [
    node({ id: LEVER_ID, campaignId: CAMPAIGN_ID, lever: 'dac', startsOn: null, endsOn: null, platformShares: [] }),
  ]);
  store.seed(AdGroupEntity, [
    node({
      id: AD_GROUP_ID,
      campaignId: CAMPAIGN_ID,
      leverId: LEVER_ID,
      lever: 'dac',
      budgetCents: 14_000,
      startsOn: null,
      endsOn: null,
      ...overrides.adGroup,
    }),
  ]);
}

/**
 * The amounts of a curve, in order.
 *
 * @param curve - The curve
 * @returns Its amounts in cents
 */
function amounts(curve: BudgetCurve): number[] {
  return curve.days.map((day: BudgetDay): number => day.cents);
}

/**
 * The rows the store holds for a node.
 *
 * @param store - The store
 * @param nodeId - The node
 * @returns Its stored days, in the order they were written
 */
function storedDays(store: TreeStore, nodeId: string): ObjectLiteral[] {
  return store.rows(BudgetDayEntity).filter((row: ObjectLiteral): boolean => row.nodeId === nodeId);
}

describe('Unit::Services::BudgetCurveService', () => {
  let store: TreeStore;
  let access: AccessServiceMock;
  let service: BudgetCurveService;

  beforeEach((): void => {
    store = createTreeStore();
    access = createAccessMock();
    seedTree(store);
    service = new BudgetCurveService(store.dataSource as never, access as never, (): number => NOW);
  });

  describe('get', () => {
    it('should spread a budget evenly over the window when nobody shaped it', async (): Promise<void> => {
      const curve: BudgetCurve = await service.get(JANE, IDS.organization, 'campaign', CAMPAIGN_ID);

      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
      expect(curve).toMatchObject({ level: 'campaign', nodeId: CAMPAIGN_ID, source: 'own', totalCents: 70_000 });
      expect(amounts(curve)).toEqual([10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000]);
      expect(storedDays(store, CAMPAIGN_ID)).toHaveLength(0);
    });

    it('should flag the weekend of the window', async (): Promise<void> => {
      const curve: BudgetCurve = await service.get(JANE, IDS.organization, 'campaign', CAMPAIGN_ID);

      expect(
        curve.days.filter((day: BudgetDay): boolean => day.weekend).map((day: BudgetDay): string => day.day)
      ).toEqual(['2027-01-02', '2027-01-03']);
    });

    it('should answer the days it has stored, and keep them through a read', async (): Promise<void> => {
      await service.update(JANE, IDS.organization, 'campaign', CAMPAIGN_ID, {
        days: [{ day: '2027-01-01', cents: 40_000, locked: true }],
      });

      const curve: BudgetCurve = await service.get(JANE, IDS.organization, 'campaign', CAMPAIGN_ID);

      expect(amounts(curve)).toEqual([40_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000]);
      expect(curve.days[0].locked).toBe(true);
    });

    it('should give a node with no budget of its own the shape of its parent', async (): Promise<void> => {
      // The campaign is shaped, the lever inherits: it follows the shape for its own amount.
      await service.applyPreset(JANE, IDS.organization, 'campaign', CAMPAIGN_ID, {
        preset: 'selected_days',
        weekdays: ['friday'],
      });

      const curve: BudgetCurve = await service.get(JANE, IDS.organization, 'lever', LEVER_ID);

      expect(curve.source).toBe('inherited');
      // The window holds one Friday, its first day: the whole campaign budget lands there, and so
      // does the lever's, which follows the shape of its parent.
      expect(amounts(curve)).toEqual([70_000, 0, 0, 0, 0, 0, 0]);
    });

    it('should answer the window of the node, not of its campaign', async (): Promise<void> => {
      store.rows(AdGroupEntity)[0].startsOn = '2027-01-02';
      store.rows(AdGroupEntity)[0].endsOn = '2027-01-03';

      const curve: BudgetCurve = await service.get(JANE, IDS.organization, 'ad_group', AD_GROUP_ID);

      expect(curve.days.map((day: BudgetDay): string => day.day)).toEqual(['2027-01-02', '2027-01-03']);
      expect(amounts(curve)).toEqual([7_000, 7_000]);
    });

    it('should answer 404 for a node of another Organization', async (): Promise<void> => {
      await expect(service.get(JANE, IDS.organization, 'ad_group', 'nope')).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'ad_group_not_found',
      });
    });
  });

  describe('update', () => {
    it('should pin the edited day and let the others absorb it, then store the curve', async (): Promise<void> => {
      const curve: BudgetCurve = await service.update(JANE, IDS.organization, 'ad_group', AD_GROUP_ID, {
        days: [{ day: '2027-01-01', cents: 8_000 }],
      });

      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'manager');
      expect(amounts(curve)).toEqual([8_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000]);
      expect(storedDays(store, AD_GROUP_ID)).toHaveLength(7);
    });

    it('should replace the days it had stored rather than adding to them', async (): Promise<void> => {
      await service.update(JANE, IDS.organization, 'ad_group', AD_GROUP_ID, {
        days: [{ day: '2027-01-01', cents: 8_000 }],
      });
      await service.update(JANE, IDS.organization, 'ad_group', AD_GROUP_ID, {
        days: [{ day: '2027-01-02', cents: 8_000 }],
      });

      expect(storedDays(store, AD_GROUP_ID)).toHaveLength(7);
      expect(amounts(await service.get(JANE, IDS.organization, 'ad_group', AD_GROUP_ID))[1]).toBe(8_000);
    });

    it('should freeze the days before today of a launched campaign', async (): Promise<void> => {
      store = createTreeStore();
      seedTree(store, { campaign: { status: 'active' } });
      service = new BudgetCurveService(store.dataSource as never, access as never, (): number => NOW);

      await expect(
        service.update(JANE, IDS.organization, 'campaign', CAMPAIGN_ID, {
          days: [{ day: '2027-01-05', cents: 1 }],
        })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'budget_day_past', errorParams: { day: '2027-01-05' } });
    });

    it('should let a draft campaign change any of its days', async (): Promise<void> => {
      const curve: BudgetCurve = await service.update(JANE, IDS.organization, 'campaign', CAMPAIGN_ID, {
        days: [{ day: '2027-01-01', cents: 70_000 }],
      });

      expect(amounts(curve)).toEqual([70_000, 0, 0, 0, 0, 0, 0]);
    });

    it('should refuse a curve on a node with no budget of its own', async (): Promise<void> => {
      await expect(
        service.update(JANE, IDS.organization, 'lever', LEVER_ID, { days: [{ day: '2027-01-01', cents: 1 }] })
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'budget_curve_not_allowed',
        errorParams: { level: 'lever' },
      });
      expect(storedDays(store, LEVER_ID)).toHaveLength(0);
    });

    it('should let a refused role travel out untouched', async (): Promise<void> => {
      access.assertOrganizationRole.mockRejectedValue(
        httpError(403, 'Requires the manager role', { code: 'role_required' })
      );

      await expect(
        service.update(JANE, IDS.organization, 'campaign', CAMPAIGN_ID, { days: [{ day: '2027-01-01', cents: 1 }] })
      ).rejects.toMatchObject({ statusCode: 403, errorCode: 'role_required' });
    });
  });

  describe('applyPreset', () => {
    it('should boost the weekend', async (): Promise<void> => {
      const curve: BudgetCurve = await service.applyPreset(JANE, IDS.organization, 'campaign', CAMPAIGN_ID, {
        preset: 'weekend_boost',
        factor: 2,
      });

      // The week starts on a Friday: five days weighing 1 and two weekend days weighing 2, so nine
      // shares of 777,77 €, and the largest remainder gives the odd cents to the lighter days.
      expect(amounts(curve)).toEqual([7_778, 15_555, 15_555, 7_778, 7_778, 7_778, 7_778]);
      expect(amounts(curve).reduce((sum: number, cents: number): number => sum + cents, 0)).toBe(70_000);
    });

    it('should let only the chosen weekdays deliver', async (): Promise<void> => {
      const curve: BudgetCurve = await service.applyPreset(JANE, IDS.organization, 'campaign', CAMPAIGN_ID, {
        preset: 'selected_days',
        weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      });

      // « Pas le week-end » : the Saturday and the Sunday hold nothing.
      expect(amounts(curve)).toEqual([14_000, 0, 0, 14_000, 14_000, 14_000, 14_000]);
    });

    it('should take a named day out of any shape', async (): Promise<void> => {
      const curve: BudgetCurve = await service.applyPreset(JANE, IDS.organization, 'campaign', CAMPAIGN_ID, {
        preset: 'flat',
        excludedDays: ['2027-01-04'],
      });

      // « Pas le 4 janvier » : the day holds nothing, the six others share the budget.
      expect(curve.days[3].cents).toBe(0);
      expect(amounts(curve).reduce((sum: number, cents: number): number => sum + cents, 0)).toBe(70_000);
    });

    it('should refuse a shape that leaves no day able to deliver', async (): Promise<void> => {
      await expect(
        service.applyPreset(JANE, IDS.organization, 'campaign', CAMPAIGN_ID, {
          preset: 'selected_days',
          weekdays: ['sunday'],
          excludedDays: ['2027-01-03'],
        })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'budget_no_free_day' });
    });
  });

  describe('reset', () => {
    it('should forget the shape and go back to spreading evenly', async (): Promise<void> => {
      await service.update(JANE, IDS.organization, 'ad_group', AD_GROUP_ID, {
        days: [{ day: '2027-01-01', cents: 8_000 }],
      });

      const curve: BudgetCurve = await service.reset(JANE, IDS.organization, 'ad_group', AD_GROUP_ID);

      expect(storedDays(store, AD_GROUP_ID)).toHaveLength(0);
      expect(amounts(curve)).toEqual([2_000, 2_000, 2_000, 2_000, 2_000, 2_000, 2_000]);
    });

    it('should answer 404 for a node of another Organization', async (): Promise<void> => {
      await expect(service.reset(JANE, IDS.organization, 'campaign', 'nope')).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'campaign_not_found',
      });
    });
  });

  describe('pacing', () => {
    it('should answer a plan nobody has spent against yet', async (): Promise<void> => {
      const pacing: Pacing = await service.pacing(JANE, IDS.organization, 'campaign', CAMPAIGN_ID);

      expect(pacing).toEqual({
        plannedCents: 70_000,
        plannedToDateCents: 50_000,
        remainingCents: 70_000,
        // Nothing was spent, so the whole budget is still to spend over the two days left, in the
        // shape of the curve: today weighs half of them.
        todayCents: 35_000,
        budgetReached: false,
        status: 'underspending',
      });
    });

    it('should answer the day and the average to the synchronization, with no caller to check', async (): Promise<void> => {
      // The entry point of the engine: a job is not a request, so it hands the timezone and no actor
      // (`docs/phase-9.md` § 3).
      await expect(service.pacedDay(store.manager, IDS.organization, 'campaign', CAMPAIGN_ID, 'UTC')).resolves.toEqual({
        todayCents: 35_000,
        averageCents: 10_000,
      });
    });

    it('should answer nothing for a node whose window holds no day', async (): Promise<void> => {
      const empty: BudgetCurve = { level: 'campaign', nodeId: CAMPAIGN_ID, source: 'own', totalCents: 0, days: [] };
      jest.spyOn(service as never, 'curveOf').mockResolvedValue(empty as never);

      await expect(service.pacedDay(store.manager, IDS.organization, 'campaign', CAMPAIGN_ID, 'UTC')).resolves.toEqual({
        todayCents: 0,
        averageCents: 0,
      });
    });

    it('should count today in the timezone of the campaign', async (): Promise<void> => {
      // 10:00 UTC on the 6th is still the 6th in UTC, and already the 7th in Kiritimati (UTC+14), so
      // one more day is behind.
      store.rows(CampaignEntity)[0].timezone = 'Pacific/Kiritimati';

      const pacing: Pacing = await service.pacing(JANE, IDS.organization, 'campaign', CAMPAIGN_ID);

      expect(pacing.plannedToDateCents).toBe(60_000);
    });

    it('should fall back on the timezone of the Organization, then on UTC', async (): Promise<void> => {
      const inTokyo: AuthContext = actor(
        { id: JANE.userId, email: JANE.email, isSuperAdmin: false },
        { organizations: [{ id: IDS.organization, seatId: IDS.seat, role: 'manager', timezone: 'Asia/Tokyo' }] }
      );

      // 10:00 UTC on the 6th is already the 6th at 19:00 in Tokyo, so five days are behind.
      expect((await service.pacing(inTokyo, IDS.organization, 'campaign', CAMPAIGN_ID)).plannedToDateCents).toBe(
        50_000
      );

      const nowhere: AuthContext = actor({ id: JANE.userId, email: JANE.email, isSuperAdmin: false });
      expect((await service.pacing(nowhere, IDS.organization, 'campaign', CAMPAIGN_ID)).plannedToDateCents).toBe(
        50_000
      );
    });

    it('should pace a node that inherits its budget', async (): Promise<void> => {
      const pacing: Pacing = await service.pacing(JANE, IDS.organization, 'lever', LEVER_ID);

      // The lever carries no budget of its own, and it is the only child of the campaign.
      expect(pacing.plannedCents).toBe(70_000);
    });

    it('should keep a day the curve paused at nothing', async (): Promise<void> => {
      await service.applyPreset(JANE, IDS.organization, 'ad_group', AD_GROUP_ID, {
        preset: 'flat',
        excludedDays: ['2027-01-06'],
      });

      expect((await service.pacing(JANE, IDS.organization, 'ad_group', AD_GROUP_ID)).todayCents).toBe(0);
    });
  });

  describe('dropCurve', () => {
    it('should forget the days of one node and leave the others alone', async (): Promise<void> => {
      await service.update(JANE, IDS.organization, 'ad_group', AD_GROUP_ID, {
        days: [{ day: '2027-01-01', cents: 8_000 }],
      });
      store.seed(BudgetDayEntity, [
        { level: 'ad_group', nodeId: OTHER_AD_GROUP_ID, day: '2027-01-01', cents: 1, locked: false },
      ]);

      await dropCurve(store.manager, 'ad_group', AD_GROUP_ID);

      expect(storedDays(store, AD_GROUP_ID)).toHaveLength(0);
      expect(storedDays(store, OTHER_AD_GROUP_ID)).toHaveLength(1);
    });
  });

  describe('BudgetCurveServicePlugin', () => {
    it('should decorate the instance with a BudgetCurveService wired to its dependencies', async (): Promise<void> => {
      const app: FastifyInstance = await buildServiceApp([BudgetCurveServicePlugin], {
        db: store as never,
        access: access as never,
      });

      expect(app.budgetCurveService).toBeInstanceOf(BudgetCurveService);
      await expect(app.budgetCurveService.get(JANE, IDS.organization, 'campaign', CAMPAIGN_ID)).resolves.toMatchObject({
        totalCents: 70_000,
      });

      await app.close();
    });
  });
});
