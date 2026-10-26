import { ObjectLiteral } from 'typeorm';

import {
  AdGroupEntity,
  BudgetDayEntity,
  CampaignEntity,
  LeverEntity,
  LineEntity,
  PlatformUnitEntity,
  TargetingGroupEntity,
} from '@src/database/entities';
import {
  assertExplicitBudgetFits,
  deleteNode,
  effectiveWindowOf,
  findNodeOrFail,
  normalizeNodeWrite,
  restoreNode,
  statusOfNewNode,
} from '@src/services/node.helpers';
import { DeletionResult } from '@src/types';
import { createTreeStore, TreeStore } from '@test/unit/mocks/tree-store.mock';

/** The Organization every row of these specs belongs to. */
const ORG = 'c0000000-0000-4000-8000-000000000001';

/** The window of the campaign the tree hangs from. */
const WINDOW = { startsOn: '2026-11-05', endsOn: '2026-11-20' };

/**
 * Seed a `dac` tree: a campaign of 1 000 € over a fortnight, one lever, two AdGroups, one
 * TargetingGroup under the first and one Line under it.
 *
 * @param store - The store to seed
 */
function seedTree(store: TreeStore): void {
  const node = (extra: ObjectLiteral): ObjectLiteral => ({
    organizationId: ORG,
    budgetCents: null,
    budgetVolume: null,
    budgetVolumeUnit: null,
    capping: null,
    startsOn: null,
    endsOn: null,
    deletedAt: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    ...extra,
  });
  store.seed(CampaignEntity, [node({ id: 'c1', budgetCents: 100_000, ...WINDOW })]);
  store.seed(LeverEntity, [node({ id: 'l1', campaignId: 'c1', lever: 'dac', platformShares: [] })]);
  store.seed(AdGroupEntity, [
    node({ id: 'g1', campaignId: 'c1', leverId: 'l1', lever: 'dac', bidAmountCents: 450 }),
    node({ id: 'g2', campaignId: 'c1', leverId: 'l1', lever: 'dac', bidAmountCents: null }),
  ]);
  store.seed(TargetingGroupEntity, [node({ id: 't1', campaignId: 'c1', adGroupId: 'g1', lever: 'dac' })]);
  store.seed(LineEntity, [node({ id: 'n1', campaignId: 'c1', targetingGroupId: 't1', lever: 'dac' })]);
}

/**
 * The row of an entity by id.
 *
 * @param store - The store
 * @param entity - Its entity
 * @param id - The id
 * @returns The row
 */
function row(store: TreeStore, entity: Parameters<TreeStore['rows']>[0], id: string): ObjectLiteral {
  return store.rows(entity).find((candidate: ObjectLiteral): boolean => candidate.id === id) as ObjectLiteral;
}

describe('Unit::Services::NodeHelpers', () => {
  let store: TreeStore;

  beforeEach((): void => {
    store = createTreeStore();
    seedTree(store);
  });

  describe('findNodeOrFail', () => {
    it('should read a node of the Organization', async (): Promise<void> => {
      await expect(findNodeOrFail(store.manager, 'lever', ORG, 'l1')).resolves.toMatchObject({ id: 'l1' });
    });

    it('should answer the 404 of its level for a node of another Organization', async (): Promise<void> => {
      await expect(findNodeOrFail(store.manager, 'targeting_group', 'other-org', 't1')).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'targeting_group_not_found',
      });
    });

    it('should hide a deleted node unless it is asked for', async (): Promise<void> => {
      row(store, LineEntity, 'n1').deletedAt = new Date();

      await expect(findNodeOrFail(store.manager, 'line', ORG, 'n1')).rejects.toMatchObject({
        errorCode: 'line_not_found',
      });
      await expect(findNodeOrFail(store.manager, 'line', ORG, 'n1', { deleted: true })).resolves.toMatchObject({
        id: 'n1',
      });
    });
  });

  describe('effectiveWindowOf', () => {
    it('should give a campaign its own window', async (): Promise<void> => {
      await expect(effectiveWindowOf(store.manager, 'campaign', 'c1')).resolves.toEqual(WINDOW);
    });

    it('should hand a node the window of its parent when it overrides nothing', async (): Promise<void> => {
      await expect(effectiveWindowOf(store.manager, 'line', 'n1')).resolves.toEqual(WINDOW);
    });

    it('should keep the override of a node, and only the day it overrides', async (): Promise<void> => {
      row(store, AdGroupEntity, 'g1').startsOn = '2026-11-10';

      await expect(effectiveWindowOf(store.manager, 'ad_group', 'g1')).resolves.toEqual({
        startsOn: '2026-11-10',
        endsOn: '2026-11-20',
      });
    });

    it('should answer 404 for a node that is gone', async (): Promise<void> => {
      await expect(effectiveWindowOf(store.manager, 'ad_group', 'nope')).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'ad_group_not_found',
      });
    });
  });

  describe('assertExplicitBudgetFits', () => {
    it('should accept an amount the siblings leave room for', async (): Promise<void> => {
      await expect(assertExplicitBudgetFits(store.manager, 'ad_group', 'l1', 'g1', 60_000)).resolves.toBeUndefined();
    });

    it('should count the explicit siblings, and not the node being written', async (): Promise<void> => {
      row(store, AdGroupEntity, 'g2').budgetCents = 60_000;

      await expect(assertExplicitBudgetFits(store.manager, 'ad_group', 'l1', 'g1', 40_000)).resolves.toBeUndefined();
      await expect(assertExplicitBudgetFits(store.manager, 'ad_group', 'l1', 'g1', 41_000)).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'budget_exceeds_parent',
      });
    });

    it('should count every sibling when the node is being created', async (): Promise<void> => {
      row(store, AdGroupEntity, 'g1').budgetCents = 60_000;
      row(store, AdGroupEntity, 'g2').budgetCents = 30_000;

      await expect(assertExplicitBudgetFits(store.manager, 'ad_group', 'l1', null, 20_000)).rejects.toMatchObject({
        errorCode: 'budget_exceeds_parent',
        errorParams: { parentCents: 100_000, childrenCents: 110_000 },
      });
    });
  });

  describe('normalizeNodeWrite', () => {
    it('should refuse a budget on a Line of the Search lever (D12)', async (): Promise<void> => {
      await expect(
        normalizeNodeWrite(
          store.manager,
          { level: 'line', levers: ['search'], parentId: 't1', nodeId: null },
          { budgetCents: 10_000 }
        )
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'lever_field_forbidden',
        errorParams: { lever: 'search', level: 'line', field: 'budget' },
      });
    });

    it('should refuse a capping anywhere on the Search lever (L6)', async (): Promise<void> => {
      await expect(
        normalizeNodeWrite(
          store.manager,
          { level: 'ad_group', levers: ['search'], parentId: 'l1', nodeId: null },
          { capping: [{ maxImpressions: 3, period: 'day' }] }
        )
      ).rejects.toMatchObject({ errorCode: 'lever_field_forbidden', errorParams: { field: 'capping' } });
    });

    it('should refuse a field any lever of a campaign forbids', async (): Promise<void> => {
      // A capping written on a campaign applies to every lever it carries, Search included.
      await expect(
        normalizeNodeWrite(
          store.manager,
          { level: 'campaign', levers: ['dac', 'search'], parentId: null, nodeId: 'c1' },
          { capping: [{ maxImpressions: 3, period: 'day' }] }
        )
      ).rejects.toMatchObject({ errorCode: 'lever_field_forbidden', errorParams: { lever: 'search' } });
    });

    it('should accept on a campaign with no lever yet what a lever would refuse', async (): Promise<void> => {
      await expect(
        normalizeNodeWrite(
          store.manager,
          { level: 'campaign', levers: [], parentId: null, nodeId: null },
          { capping: [{ maxImpressions: 3, period: 'day' }] }
        )
      ).resolves.toEqual({ capping: [{ maxImpressions: 3, period: 'day' }] });
    });

    it('should convert a volume through the bid CPM and store the amount (L25)', async (): Promise<void> => {
      const columns: ObjectLiteral = await normalizeNodeWrite(
        store.manager,
        { level: 'ad_group', levers: ['dac'], parentId: 'l1', nodeId: 'g1', bidAmountCents: 450 },
        { budgetVolume: { amount: 100_000, unit: 'impressions' } }
      );

      expect(columns).toEqual({ budgetCents: 45_000, budgetVolume: 100_000, budgetVolumeUnit: 'impressions' });
    });

    it('should refuse a volume with no CPM to convert it', async (): Promise<void> => {
      await expect(
        normalizeNodeWrite(
          store.manager,
          { level: 'ad_group', levers: ['dac'], parentId: 'l1', nodeId: 'g2' },
          { budgetVolume: { amount: 100_000, unit: 'impressions' } }
        )
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'volume_without_bid' });
    });

    it('should refuse a volume in a unit the lever does not take', async (): Promise<void> => {
      await expect(
        normalizeNodeWrite(
          store.manager,
          { level: 'ad_group', levers: ['dac'], parentId: 'l1', nodeId: 'g1', bidAmountCents: 450 },
          { budgetVolume: { amount: 1_000, unit: 'completions' } }
        )
      ).rejects.toMatchObject({ errorCode: 'volume_not_permitted' });
    });

    it('should refuse a budget entered twice, since one of the two would be a lie', async (): Promise<void> => {
      await expect(
        normalizeNodeWrite(
          store.manager,
          { level: 'ad_group', levers: ['dac'], parentId: 'l1', nodeId: 'g1', bidAmountCents: 450 },
          { budgetCents: 10_000, budgetVolume: { amount: 1_000, unit: 'impressions' } }
        )
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'budget_entered_twice' });
    });

    it('should drop the volume when an amount is entered by hand', async (): Promise<void> => {
      const columns: ObjectLiteral = await normalizeNodeWrite(
        store.manager,
        { level: 'ad_group', levers: ['dac'], parentId: 'l1', nodeId: 'g1' },
        { budgetCents: 30_000 }
      );

      expect(columns).toEqual({ budgetCents: 30_000, budgetVolume: null, budgetVolumeUnit: null });
    });

    it('should let a node give its budget back, and forget the curve it no longer explains', async (): Promise<void> => {
      store.seed(BudgetDayEntity, [
        { level: 'ad_group', nodeId: 'g1', day: '2027-01-01', cents: 30_000, locked: false },
        { level: 'ad_group', nodeId: 'g2', day: '2027-01-01', cents: 30_000, locked: false },
      ]);

      const columns: ObjectLiteral = await normalizeNodeWrite(
        store.manager,
        { level: 'ad_group', levers: ['dac'], parentId: 'l1', nodeId: 'g1' },
        { budgetCents: null }
      );

      expect(columns).toEqual({ budgetCents: null, budgetVolume: null, budgetVolumeUnit: null });
      expect(store.rows(BudgetDayEntity).map((row: ObjectLiteral): string => row.nodeId as string)).toEqual(['g2']);
    });

    it('should leave the curve of a node that keeps its budget alone', async (): Promise<void> => {
      store.seed(BudgetDayEntity, [
        { level: 'ad_group', nodeId: 'g1', day: '2027-01-01', cents: 30_000, locked: false },
      ]);

      await normalizeNodeWrite(
        store.manager,
        { level: 'ad_group', levers: ['dac'], parentId: 'l1', nodeId: 'g1' },
        { budgetCents: 30_000 }
      );

      expect(store.rows(BudgetDayEntity)).toHaveLength(1);
    });

    it('should refuse an amount that overflows the parent', async (): Promise<void> => {
      await expect(
        normalizeNodeWrite(
          store.manager,
          { level: 'ad_group', levers: ['dac'], parentId: 'l1', nodeId: 'g1' },
          { budgetCents: 150_000 }
        )
      ).rejects.toMatchObject({ errorCode: 'budget_exceeds_parent' });
    });

    it('should refuse a window outside its parent', async (): Promise<void> => {
      await expect(
        normalizeNodeWrite(
          store.manager,
          { level: 'ad_group', levers: ['dac'], parentId: 'l1', nodeId: 'g1' },
          { startsOn: '2026-11-01', endsOn: '2026-11-10' }
        )
      ).rejects.toMatchObject({ errorCode: 'dates_outside_parent' });
    });

    it('should refuse a window that ends before it starts', async (): Promise<void> => {
      await expect(
        normalizeNodeWrite(
          store.manager,
          { level: 'campaign', levers: [], parentId: null, nodeId: null },
          { startsOn: '2026-11-20', endsOn: '2026-11-05' }
        )
      ).rejects.toMatchObject({ errorCode: 'dates_reversed' });
    });

    it('should check a half-written window against the day the node already holds', async (): Promise<void> => {
      const current: ObjectLiteral = row(store, AdGroupEntity, 'g1');
      current.startsOn = '2026-11-10';
      current.endsOn = '2026-11-15';

      await expect(
        normalizeNodeWrite(
          store.manager,
          { level: 'ad_group', levers: ['dac'], parentId: 'l1', nodeId: 'g1', current: current as never },
          { endsOn: '2026-11-30' }
        )
      ).rejects.toMatchObject({ errorCode: 'dates_outside_parent' });
    });

    it('should accept a full window inside its parent, and keep both days', async (): Promise<void> => {
      const columns: ObjectLiteral = await normalizeNodeWrite(
        store.manager,
        { level: 'ad_group', levers: ['dac'], parentId: 'l1', nodeId: 'g1' },
        { startsOn: '2026-11-10', endsOn: '2026-11-15' }
      );

      expect(columns).toEqual({ startsOn: '2026-11-10', endsOn: '2026-11-15' });
    });

    it('should not check a window that is still half missing', async (): Promise<void> => {
      // Only the last day, on a node that inherits its first: there is no window to check yet, and a
      // node being written is not an error (`CADRAGE.md` § 13).
      const columns: ObjectLiteral = await normalizeNodeWrite(
        store.manager,
        { level: 'ad_group', levers: ['dac'], parentId: 'l1', nodeId: 'g1' },
        { endsOn: '2026-12-31' }
      );

      expect(columns).toEqual({ endsOn: '2026-12-31' });
    });

    it('should accept a window a node only half overrides', async (): Promise<void> => {
      const columns: ObjectLiteral = await normalizeNodeWrite(
        store.manager,
        { level: 'ad_group', levers: ['dac'], parentId: 'l1', nodeId: 'g1' },
        { startsOn: '2026-11-10' }
      );

      expect(columns).toEqual({ startsOn: '2026-11-10' });
    });

    it('should write nothing when the caller sent nothing of a node that inherits everything', async (): Promise<void> => {
      // The row carries no window of its own, and the body names none: nothing to write, nothing to
      // check.
      await expect(
        normalizeNodeWrite(
          store.manager,
          {
            level: 'line',
            levers: ['dac'],
            parentId: 't1',
            nodeId: 'n1',
            current: row(store, LineEntity, 'n1') as never,
          },
          {}
        )
      ).resolves.toEqual({});
    });
  });

  describe('deleteNode', () => {
    it('should delete a node and its subtree, and answer when', async (): Promise<void> => {
      const result: DeletionResult = await deleteNode(store.manager, 'ad_group', ORG, 'g1');

      expect(result.id).toBe('g1');
      expect(Date.parse(result.deletedAt as string)).not.toBeNaN();
      expect(row(store, AdGroupEntity, 'g1').deletedAt).not.toBeNull();
      expect(row(store, TargetingGroupEntity, 't1').deletedAt).not.toBeNull();
      expect(row(store, LineEntity, 'n1').deletedAt).not.toBeNull();
      expect(row(store, AdGroupEntity, 'g2').deletedAt).toBeNull();
    });

    it('should answer 404 for a node of another Organization', async (): Promise<void> => {
      await expect(deleteNode(store.manager, 'ad_group', 'other-org', 'g1')).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'ad_group_not_found',
      });
    });

    it('should mark the units of the campaign, in the same transaction', async (): Promise<void> => {
      store.seed(PlatformUnitEntity, [{ id: 'u1', campaignId: 'c1', syncState: 'synced', attempts: 0 }]);

      await deleteNode(store.manager, 'ad_group', ORG, 'g1');

      // A node that disappears must disappear over there too (`services/sync.helpers.ts`).
      expect(row(store, PlatformUnitEntity, 'u1').syncState).toBe('pending');
    });

    it('should find the campaign of a campaign in itself', async (): Promise<void> => {
      store.seed(PlatformUnitEntity, [{ id: 'u1', campaignId: 'c1', syncState: 'synced', attempts: 0 }]);

      await deleteNode(store.manager, 'campaign', ORG, 'c1');

      expect(row(store, PlatformUnitEntity, 'u1').syncState).toBe('pending');
    });
  });

  describe('restoreNode', () => {
    it('should restore a node and the subtree its deletion took', async (): Promise<void> => {
      await deleteNode(store.manager, 'ad_group', ORG, 'g1');

      await expect(restoreNode(store.manager, 'ad_group', ORG, 'g1')).resolves.toEqual({ id: 'g1', deletedAt: null });
      expect(row(store, TargetingGroupEntity, 't1').deletedAt).toBeNull();
      expect(row(store, LineEntity, 'n1').deletedAt).toBeNull();
    });

    it('should answer the 409 of its level for a node that is not deleted', async (): Promise<void> => {
      await expect(restoreNode(store.manager, 'ad_group', ORG, 'g1')).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'ad_group_not_deleted',
      });
    });

    it('should mark the units of the campaign, in the same transaction', async (): Promise<void> => {
      await deleteNode(store.manager, 'ad_group', ORG, 'g1');
      store.seed(PlatformUnitEntity, [{ id: 'u1', campaignId: 'c1', syncState: 'synced', attempts: 0 }]);

      await restoreNode(store.manager, 'ad_group', ORG, 'g1');

      expect(row(store, PlatformUnitEntity, 'u1').syncState).toBe('pending');
    });

    it('should leave deleted what had been deleted before', async (): Promise<void> => {
      const earlier = new Date('2026-10-20T10:00:00.000Z');
      row(store, LineEntity, 'n1').deletedAt = earlier;
      await deleteNode(store.manager, 'ad_group', ORG, 'g1');

      await restoreNode(store.manager, 'ad_group', ORG, 'g1');

      expect(row(store, LineEntity, 'n1').deletedAt).toBe(earlier);
    });
  });

  describe('statusOfNewNode', () => {
    it('should let a node of a draft campaign deliver, and pause one added to a live campaign', async (): Promise<void> => {
      // A node added to a campaign that already launched reaches no platform until someone activates
      // it (`../../CADRAGE.md` § 13), which is what keeps an unfinished AdGroup from spending money
      // the hour it is written.
      store.seed(CampaignEntity, [{ id: 'c-draft', status: 'draft' }]);
      store.seed(CampaignEntity, [{ id: 'c-live', status: 'active' }]);

      await expect(statusOfNewNode(store.manager, 'c-draft')).resolves.toBe('active');
      await expect(statusOfNewNode(store.manager, 'c-live')).resolves.toBe('paused');
    });

    it('should let a node deliver when the campaign cannot be read at all', async (): Promise<void> => {
      // Nothing to pause for: the write that follows will fail on its own foreign key.
      await expect(statusOfNewNode(store.manager, 'c-gone')).resolves.toBe('active');
    });
  });
});
