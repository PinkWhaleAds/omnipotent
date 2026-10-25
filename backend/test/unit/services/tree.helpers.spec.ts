import { ObjectLiteral } from 'typeorm';

import { AdGroupEntity, CampaignEntity, LeverEntity, LineEntity, TargetingGroupEntity } from '@src/database/entities';
import { ResolvedBudget } from '@src/services/budget.helpers';
import {
  assertWindowOrdered,
  assertWindowWithinParent,
  budgetBlockOf,
  cascadeDelete,
  cascadeRestore,
  childDescriptorOf,
  DeliveryWindow,
  descriptorOf,
  effectiveBudgetOf,
  NODE_DESCRIPTORS,
  resolvePlatformShares,
  resolveSiblingBudgets,
  TreeNodeRow,
} from '@src/services/tree.helpers';
import { BudgetBlock, PlatformShare, treeLevelSchema } from '@src/types';
import { createTreeStore, TreeStore } from '@test/unit/mocks/tree-store.mock';

/** The window of a campaign the children are checked against. */
const PARENT: DeliveryWindow = { startsOn: '2026-11-05', endsOn: '2026-11-20' };

/** The shares a lever of the specs distributes on. */
const SHARES: PlatformShare[] = [
  { platform: 'hawk', shareBasisPoints: 4_000 },
  { platform: 'dv360', shareBasisPoints: 6_000 },
];

/**
 * Seed a whole tree: one campaign of 1 000 €, one `dac` lever, two AdGroups, one TargetingGroup
 * under the first, one Line under that TargetingGroup.
 *
 * @param store - The store to seed
 * @returns Nothing; the ids are `c1`, `l1`, `g1`, `g2`, `t1`, `n1`
 */
function seedTree(store: TreeStore): void {
  const node = (extra: ObjectLiteral): ObjectLiteral => ({
    budgetCents: null,
    budgetVolume: null,
    budgetVolumeUnit: null,
    deletedAt: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    ...extra,
  });
  store.seed(CampaignEntity, [node({ id: 'c1', organizationId: 'org', budgetCents: 100_000 })]);
  store.seed(LeverEntity, [
    node({ id: 'l1', organizationId: 'org', campaignId: 'c1', lever: 'dac', platformShares: SHARES }),
  ]);
  store.seed(AdGroupEntity, [
    node({ id: 'g1', organizationId: 'org', campaignId: 'c1', leverId: 'l1', lever: 'dac', platformShares: null }),
    node({ id: 'g2', organizationId: 'org', campaignId: 'c1', leverId: 'l1', lever: 'dac', platformShares: null }),
  ]);
  store.seed(TargetingGroupEntity, [
    node({ id: 't1', organizationId: 'org', campaignId: 'c1', adGroupId: 'g1', lever: 'dac' }),
  ]);
  store.seed(LineEntity, [
    node({ id: 'n1', organizationId: 'org', campaignId: 'c1', targetingGroupId: 't1', lever: 'dac' }),
  ]);
}

/**
 * The row of an entity by id, deleted or not.
 *
 * @param store - The store
 * @param entity - Its entity
 * @param id - The id
 * @returns The row
 */
function row(store: TreeStore, entity: Parameters<TreeStore['rows']>[0], id: string): ObjectLiteral {
  return store.rows(entity).find((candidate: ObjectLiteral): boolean => candidate.id === id) as ObjectLiteral;
}

describe('Unit::Services::TreeHelpers', () => {
  describe('assertWindowWithinParent', () => {
    it('should accept a window inside its parent', (): void => {
      expect((): void =>
        assertWindowWithinParent({ startsOn: '2026-11-10', endsOn: '2026-11-15' }, PARENT)
      ).not.toThrow();
    });

    it('should accept a window equal to its parent, which is what inheriting resolves to', (): void => {
      expect((): void => assertWindowWithinParent({ ...PARENT }, PARENT)).not.toThrow();
    });

    it('should refuse a window starting before its parent', (): void => {
      expect((): void => assertWindowWithinParent({ startsOn: '2026-11-01', endsOn: '2026-11-15' }, PARENT)).toThrow(
        expect.objectContaining({
          statusCode: 400,
          errorCode: 'dates_outside_parent',
          errorParams: { parentStart: '2026-11-05', parentEnd: '2026-11-20' },
        })
      );
    });

    it('should refuse a window ending after its parent', (): void => {
      expect((): void => assertWindowWithinParent({ startsOn: '2026-11-10', endsOn: '2026-11-30' }, PARENT)).toThrow(
        expect.objectContaining({ errorCode: 'dates_outside_parent' })
      );
    });
  });

  describe('assertWindowOrdered', () => {
    it('should accept a window of one day', (): void => {
      expect((): void => assertWindowOrdered({ startsOn: '2026-11-05', endsOn: '2026-11-05' })).not.toThrow();
    });

    it('should refuse a window that ends before it starts', (): void => {
      expect((): void => assertWindowOrdered({ startsOn: '2026-11-30', endsOn: '2026-11-01' })).toThrow(
        expect.objectContaining({
          statusCode: 400,
          errorCode: 'dates_reversed',
          errorParams: { startsOn: '2026-11-30', endsOn: '2026-11-01' },
        })
      );
    });
  });

  describe('the descriptors', () => {
    it('should describe every level, and chain them from the campaign to the line', (): void => {
      expect(Object.keys(NODE_DESCRIPTORS).sort()).toEqual([...treeLevelSchema.options].sort());
      expect(descriptorOf('campaign').parentLevel).toBeNull();
      expect(childDescriptorOf('campaign')?.level).toBe('lever');
      expect(childDescriptorOf('lever')?.level).toBe('ad_group');
      expect(childDescriptorOf('ad_group')?.level).toBe('targeting_group');
      expect(childDescriptorOf('targeting_group')?.level).toBe('line');
      expect(childDescriptorOf('line')).toBeNull();
    });

    it('should give every level the codes of its own 404 and of its own 409', (): void => {
      for (const level of treeLevelSchema.options) {
        expect(descriptorOf(level).notFoundCode).toBe(`${level}_not_found`);
        expect(descriptorOf(level).notDeletedCode).toBe(`${level}_not_deleted`);
      }
    });
  });

  describe('cascadeDelete', () => {
    let store: TreeStore;

    beforeEach((): void => {
      store = createTreeStore();
      seedTree(store);
    });

    it('should delete the whole subtree at the very instant of the node', async (): Promise<void> => {
      const deletedAt = new Date('2026-10-25T10:00:00.000Z');

      await expect(cascadeDelete(store.manager, 'campaign', 'c1', deletedAt)).resolves.toBe(5);

      for (const [entity, id] of [
        [LeverEntity, 'l1'],
        [AdGroupEntity, 'g1'],
        [AdGroupEntity, 'g2'],
        [TargetingGroupEntity, 't1'],
        [LineEntity, 'n1'],
      ] as const) {
        expect(row(store, entity, id).deletedAt).toBe(deletedAt);
      }
    });

    it('should delete only what hangs from the node, not its siblings', async (): Promise<void> => {
      await cascadeDelete(store.manager, 'ad_group', 'g1', new Date('2026-10-25T10:00:00.000Z'));

      expect(row(store, TargetingGroupEntity, 't1').deletedAt).not.toBeNull();
      expect(row(store, LineEntity, 'n1').deletedAt).not.toBeNull();
      expect(row(store, AdGroupEntity, 'g2').deletedAt).toBeNull();
    });

    it('should stop at the leaf', async (): Promise<void> => {
      await expect(cascadeDelete(store.manager, 'line', 'n1', new Date())).resolves.toBe(0);
    });

    it('should leave what was already deleted with its own instant', async (): Promise<void> => {
      const first = new Date('2026-10-20T10:00:00.000Z');
      row(store, LineEntity, 'n1').deletedAt = first;

      await cascadeDelete(store.manager, 'campaign', 'c1', new Date('2026-10-25T10:00:00.000Z'));

      expect(row(store, LineEntity, 'n1').deletedAt).toBe(first);
    });
  });

  describe('cascadeRestore', () => {
    let store: TreeStore;
    const deletedAt = new Date('2026-10-25T10:00:00.000Z');

    beforeEach(async (): Promise<void> => {
      store = createTreeStore();
      seedTree(store);
    });

    it('should bring back the subtree one deletion took', async (): Promise<void> => {
      await cascadeDelete(store.manager, 'campaign', 'c1', deletedAt);

      await expect(cascadeRestore(store.manager, 'campaign', 'c1', deletedAt)).resolves.toBe(5);

      expect(row(store, LeverEntity, 'l1').deletedAt).toBeNull();
      expect(row(store, LineEntity, 'n1').deletedAt).toBeNull();
    });

    it('should leave deleted what had been deleted before, and only that', async (): Promise<void> => {
      // A Line deleted on its own, then the whole campaign deleted, then the campaign restored.
      const earlier = new Date('2026-10-20T10:00:00.000Z');
      row(store, LineEntity, 'n1').deletedAt = earlier;
      await cascadeDelete(store.manager, 'campaign', 'c1', deletedAt);

      await cascadeRestore(store.manager, 'campaign', 'c1', deletedAt);

      expect(row(store, TargetingGroupEntity, 't1').deletedAt).toBeNull();
      expect(row(store, LineEntity, 'n1').deletedAt).toBe(earlier);
    });

    it('should stop at the leaf', async (): Promise<void> => {
      await expect(cascadeRestore(store.manager, 'line', 'n1', deletedAt)).resolves.toBe(0);
    });
  });

  describe('effectiveBudgetOf', () => {
    let store: TreeStore;

    beforeEach((): void => {
      store = createTreeStore();
      seedTree(store);
    });

    it('should give a campaign the amount it carries', async (): Promise<void> => {
      await expect(effectiveBudgetOf(store.manager, 'campaign', 'c1')).resolves.toBe(100_000);
    });

    it('should give an only child everything its parent has', async (): Promise<void> => {
      await expect(effectiveBudgetOf(store.manager, 'lever', 'l1')).resolves.toBe(100_000);
    });

    it('should divide between siblings, down the levels', async (): Promise<void> => {
      // One lever of 1 000 €, two AdGroups: 500 € each. The TargetingGroup of the first gets its 500 €,
      // and the Line under it the same, being alone at each level.
      await expect(effectiveBudgetOf(store.manager, 'ad_group', 'g1')).resolves.toBe(50_000);
      await expect(effectiveBudgetOf(store.manager, 'targeting_group', 't1')).resolves.toBe(50_000);
      await expect(effectiveBudgetOf(store.manager, 'line', 'n1')).resolves.toBe(50_000);
    });

    it('should serve an explicit amount first, the rest sharing what is left', async (): Promise<void> => {
      row(store, AdGroupEntity, 'g1').budgetCents = 70_000;

      await expect(effectiveBudgetOf(store.manager, 'ad_group', 'g1')).resolves.toBe(70_000);
      await expect(effectiveBudgetOf(store.manager, 'ad_group', 'g2')).resolves.toBe(30_000);
    });

    it('should answer 404 for a node that is gone', async (): Promise<void> => {
      await expect(effectiveBudgetOf(store.manager, 'lever', 'nope')).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'lever_not_found',
      });
    });

    it('should answer nothing for a node someone else deleted between the two reads', async (): Promise<void> => {
      // READ COMMITTED allows it: the node is read, then another transaction commits its deletion,
      // so it is no longer among its parent's live children.
      const find: jest.Mock = store.manager.find as unknown as jest.Mock;
      find.mockResolvedValueOnce([]);

      await expect(effectiveBudgetOf(store.manager, 'ad_group', 'g1')).resolves.toBe(0);
    });

    it('should answer nothing for a node whose level carries no budget', async (): Promise<void> => {
      // A Line of the `search` lever: D12 forbids a budget there, so it has no effective budget.
      row(store, LineEntity, 'n1').lever = 'search';

      await expect(effectiveBudgetOf(store.manager, 'line', 'n1')).resolves.toBe(0);
    });
  });

  describe('resolveSiblingBudgets', () => {
    it('should resolve the children of one parent together', async (): Promise<void> => {
      const store: TreeStore = createTreeStore();
      seedTree(store);

      const budgets: Map<string, ResolvedBudget> = await resolveSiblingBudgets(store.manager, 'ad_group', 'l1');

      expect(budgets.get('g1')).toEqual({ effectiveCents: 50_000, source: 'inherited' });
      expect(budgets.get('g2')).toEqual({ effectiveCents: 50_000, source: 'inherited' });
    });
  });

  describe('resolvePlatformShares', () => {
    let store: TreeStore;

    beforeEach((): void => {
      store = createTreeStore();
      seedTree(store);
    });

    it('should give a campaign no key: each of its levers has its own', async (): Promise<void> => {
      await expect(
        resolvePlatformShares(store.manager, 'campaign', row(store, CampaignEntity, 'c1') as TreeNodeRow)
      ).resolves.toEqual([]);
    });

    it('should give a lever its own key', async (): Promise<void> => {
      await expect(
        resolvePlatformShares(store.manager, 'lever', row(store, LeverEntity, 'l1') as TreeNodeRow)
      ).resolves.toEqual(SHARES);
    });

    it('should give a node below the AdGroup the key of its lever when the AdGroup overrides nothing', async (): Promise<void> => {
      await expect(
        resolvePlatformShares(store.manager, 'line', row(store, LineEntity, 'n1') as TreeNodeRow)
      ).resolves.toEqual(SHARES);
    });

    it('should prefer the override of the AdGroup', async (): Promise<void> => {
      const override: PlatformShare[] = [{ platform: 'dv360', shareBasisPoints: 10_000 }];
      row(store, AdGroupEntity, 'g1').platformShares = override;

      await expect(
        resolvePlatformShares(store.manager, 'targeting_group', row(store, TargetingGroupEntity, 't1') as TreeNodeRow)
      ).resolves.toEqual(override);
      await expect(
        resolvePlatformShares(store.manager, 'ad_group', row(store, AdGroupEntity, 'g1') as TreeNodeRow)
      ).resolves.toEqual(override);
    });

    it('should answer nothing when the AdGroup or the Lever is gone', async (): Promise<void> => {
      store.rows(AdGroupEntity).length = 0;

      await expect(
        resolvePlatformShares(store.manager, 'targeting_group', row(store, TargetingGroupEntity, 't1') as TreeNodeRow)
      ).resolves.toEqual([]);
    });

    it('should answer nothing for a Line whose TargetingGroup is gone', async (): Promise<void> => {
      store.rows(TargetingGroupEntity).length = 0;

      await expect(
        resolvePlatformShares(store.manager, 'line', row(store, LineEntity, 'n1') as TreeNodeRow)
      ).resolves.toEqual([]);
    });

    it('should fall back to the lever when the AdGroup has an empty override', async (): Promise<void> => {
      row(store, AdGroupEntity, 'g1').platformShares = [];

      await expect(
        resolvePlatformShares(store.manager, 'ad_group', row(store, AdGroupEntity, 'g1') as TreeNodeRow)
      ).resolves.toEqual(SHARES);
    });

    it('should answer nothing when the lever of an AdGroup is gone', async (): Promise<void> => {
      store.rows(LeverEntity).length = 0;

      await expect(
        resolvePlatformShares(store.manager, 'ad_group', row(store, AdGroupEntity, 'g1') as TreeNodeRow)
      ).resolves.toEqual([]);
    });
  });

  describe('budgetBlockOf', () => {
    let store: TreeStore;

    beforeEach((): void => {
      store = createTreeStore();
      seedTree(store);
    });

    it('should answer what a campaign carries, with no platform split', async (): Promise<void> => {
      const budget: BudgetBlock = await budgetBlockOf(
        store.manager,
        'campaign',
        row(store, CampaignEntity, 'c1') as TreeNodeRow
      );

      expect(budget).toEqual({
        explicitCents: 100_000,
        effectiveCents: 100_000,
        source: 'explicit',
        volume: null,
        perPlatform: [],
      });
    });

    it('should split the resolved amount on the key of the node', async (): Promise<void> => {
      const budget: BudgetBlock = await budgetBlockOf(
        store.manager,
        'ad_group',
        row(store, AdGroupEntity, 'g1') as TreeNodeRow
      );

      expect(budget.effectiveCents).toBe(50_000);
      expect(budget.source).toBe('inherited');
      expect(budget.perPlatform).toEqual([
        { platform: 'hawk', shareBasisPoints: 4_000, cents: 20_000 },
        { platform: 'dv360', shareBasisPoints: 6_000, cents: 30_000 },
      ]);
    });

    it('should carry the volume that produced the amount', async (): Promise<void> => {
      Object.assign(row(store, AdGroupEntity, 'g1'), {
        budgetCents: 22_500,
        budgetVolume: 500_000,
        budgetVolumeUnit: 'impressions',
      });

      const budget: BudgetBlock = await budgetBlockOf(
        store.manager,
        'ad_group',
        row(store, AdGroupEntity, 'g1') as TreeNodeRow
      );

      expect(budget).toMatchObject({
        explicitCents: 22_500,
        source: 'explicit',
        volume: { amount: 500_000, unit: 'impressions' },
      });
    });

    it('should say a level carries no budget when its lever forbids one', async (): Promise<void> => {
      row(store, LineEntity, 'n1').lever = 'search';

      const budget: BudgetBlock = await budgetBlockOf(
        store.manager,
        'line',
        row(store, LineEntity, 'n1') as TreeNodeRow
      );

      expect(budget).toMatchObject({ effectiveCents: 0, source: 'forbidden', perPlatform: [] });
    });

    it('should answer nothing for a node whose parent no longer lists it', async (): Promise<void> => {
      const orphan: TreeNodeRow = {
        id: 'ghost',
        organizationId: 'org',
        campaignId: 'c1',
        leverId: 'l1',
        lever: 'dac',
        budgetCents: null,
        deletedAt: null,
      };

      const budget: BudgetBlock = await budgetBlockOf(store.manager, 'ad_group', orphan);

      expect(budget).toMatchObject({ effectiveCents: 0, source: 'forbidden' });
    });
  });
});
