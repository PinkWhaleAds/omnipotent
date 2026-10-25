/**
 * @module services/tree.helpers
 *
 * The mechanics the five levels of the campaign tree share, so that no service writes them twice
 * and none of them names a level in an `if` (`docs/phase-3.md` § 9.5):
 *
 * - the **delivery window** rules, pure, like the algebra of `services/budget.helpers.ts`;
 * - a **descriptor per level**, which is the only thing that differs between the five;
 * - the **cascade** of a soft-delete and of a restoration, on the subtree (D19);
 * - the **resolution of a budget**, which is read, never stored.
 *
 * The pure functions come first, the ones that read the database after.
 */
import { EntityManager, EntityTarget, In, ObjectLiteral } from 'typeorm';

import { AdGroupEntity, CampaignEntity, LeverEntity, LineEntity, TargetingGroupEntity } from '@src/database/entities';
import { BudgetBlock, Lever, PlatformShare, TreeLevel, VolumeUnit } from '@src/types';
import { carriesBudget } from '@src/levers/lever-profiles';
import { BudgetChild, distributeBudget, ResolvedBudget, splitByPlatform } from './budget.helpers';
import { httpError } from '@utils';

/**
 * A delivery window, in **days** (`YYYY-MM-DD`) of the campaign's timezone.
 *
 * Days rather than instants: a campaign runs from one day to another in its own timezone, and the
 * hours of a platform day are the pacing's business (`../../CADRAGE.md` § 4). ISO days compare
 * correctly as text, which is why nothing here parses a date.
 *
 * @property startsOn - First day of delivery, included
 * @property endsOn - Last day of delivery, included
 */
export type DeliveryWindow = {
  startsOn: string;
  endsOn: string;
};

/**
 * Refuse a window that is not inside its parent's.
 *
 * Dates are mandatory on the campaign; below, `null` means the parent's window and an override must
 * be **included** in it (`../../CADRAGE.md` § 4). A child delivering outside its parent is a plan
 * nobody could execute, so it is refused at write time rather than reported by the preview.
 *
 * @param child - The window asked for
 * @param parent - The parent's window
 * @returns Nothing
 * @throws Error with status 400 coded `dates_outside_parent`
 *
 * @example
 * ```typescript
 * assertWindowWithinParent({ startsOn: '2026-11-01', endsOn: '2026-11-30' }, { startsOn: '2026-11-05', endsOn: '2026-11-20' });
 * // throws: it starts before its parent and ends after it
 * ```
 */
export function assertWindowWithinParent(child: DeliveryWindow, parent: DeliveryWindow): void {
  if (child.startsOn >= parent.startsOn && child.endsOn <= parent.endsOn) return;
  throw httpError(400, `The window ${child.startsOn} → ${child.endsOn} is not inside its parent's`, {
    code: 'dates_outside_parent',
    params: { parentStart: parent.startsOn, parentEnd: parent.endsOn },
  });
}

/**
 * Refuse a window that ends before it starts.
 *
 * @param window - The window asked for
 * @returns Nothing
 * @throws Error with status 400 coded `dates_reversed`
 *
 * @example
 * ```typescript
 * assertWindowOrdered({ startsOn: '2026-11-30', endsOn: '2026-11-01' }); // throws
 * ```
 */
export function assertWindowOrdered(window: DeliveryWindow): void {
  if (window.startsOn <= window.endsOn) return;
  throw httpError(400, `The window ends on ${window.endsOn}, before it starts on ${window.startsOn}`, {
    code: 'dates_reversed',
    params: { startsOn: window.startsOn, endsOn: window.endsOn },
  });
}

/**
 * What one level of the tree needs to be handled without naming it.
 *
 * The five levels differ by their entity, their parent and their codes — nothing else — so the
 * mechanics below take a descriptor instead of being written five times. Each service keeps its own
 * class and its own public methods; what it delegates is the plumbing (`docs/phase-3.md` § 9.5).
 *
 * @property level - The level
 * @property entity - Its TypeORM entity
 * @property parentLevel - The level above, `null` for the campaign
 * @property parentIdColumn - The property holding its parent's id, `null` for the campaign
 * @property parentColumnSql - The same column as SQL names it, for a raw `where`
 * @property notFoundCode - The stable code of a 404 on this level
 * @property notDeletedCode - The stable code of a `restore` on a live node
 */
export type NodeDescriptor = {
  level: TreeLevel;
  entity: EntityTarget<ObjectLiteral>;
  parentLevel: TreeLevel | null;
  parentIdColumn: string | null;
  parentColumnSql: string | null;
  notFoundCode: string;
  notDeletedCode: string;
};

/**
 * What the mechanics read on a row, whatever its level.
 *
 * Structural on purpose: the five entities all carry these columns (the campaign has no `lever`,
 * being above the channel), so one shape describes them all without a common base class.
 */
export type TreeNodeRow = ObjectLiteral & {
  id: string;
  organizationId: string;
  lever?: Lever;
  budgetCents: number | null;
  budgetVolume?: number | null;
  budgetVolumeUnit?: VolumeUnit | null;
  platformShares?: PlatformShare[] | null;
  deletedAt: Date | null;
};

/** The descriptor of each level, in the order of the tree. */
export const NODE_DESCRIPTORS: Readonly<Record<TreeLevel, NodeDescriptor>> = {
  campaign: {
    level: 'campaign',
    entity: CampaignEntity,
    parentLevel: null,
    parentIdColumn: null,
    parentColumnSql: null,
    notFoundCode: 'campaign_not_found',
    notDeletedCode: 'campaign_not_deleted',
  },
  lever: {
    level: 'lever',
    entity: LeverEntity,
    parentLevel: 'campaign',
    parentIdColumn: 'campaignId',
    parentColumnSql: 'campaign_id',
    notFoundCode: 'lever_not_found',
    notDeletedCode: 'lever_not_deleted',
  },
  ad_group: {
    level: 'ad_group',
    entity: AdGroupEntity,
    parentLevel: 'lever',
    parentIdColumn: 'leverId',
    parentColumnSql: 'lever_id',
    notFoundCode: 'ad_group_not_found',
    notDeletedCode: 'ad_group_not_deleted',
  },
  targeting_group: {
    level: 'targeting_group',
    entity: TargetingGroupEntity,
    parentLevel: 'ad_group',
    parentIdColumn: 'adGroupId',
    parentColumnSql: 'ad_group_id',
    notFoundCode: 'targeting_group_not_found',
    notDeletedCode: 'targeting_group_not_deleted',
  },
  line: {
    level: 'line',
    entity: LineEntity,
    parentLevel: 'targeting_group',
    parentIdColumn: 'targetingGroupId',
    parentColumnSql: 'targeting_group_id',
    notFoundCode: 'line_not_found',
    notDeletedCode: 'line_not_deleted',
  },
};

/**
 * The descriptor of one level.
 *
 * @param level - The level
 * @returns Its descriptor
 */
export function descriptorOf(level: TreeLevel): NodeDescriptor {
  return NODE_DESCRIPTORS[level];
}

/**
 * The descriptor of the level below one level.
 *
 * @param level - The level
 * @returns The descriptor of its children, `null` for the leaf
 *
 * @example
 * ```typescript
 * childDescriptorOf('campaign')?.level; // 'lever'
 * childDescriptorOf('line'); // null
 * ```
 */
export function childDescriptorOf(level: TreeLevel): NodeDescriptor | null {
  return (
    Object.values(NODE_DESCRIPTORS).find((descriptor: NodeDescriptor): boolean => descriptor.parentLevel === level) ??
    null
  );
}

/**
 * Soft-delete the whole subtree of a node, at the **same instant** as the node itself (D19).
 *
 * The shared instant is what makes a restoration honest: a child deleted _before_ its parent keeps
 * its own instant, so restoring the parent leaves it deleted. Without it, restoring a campaign would
 * revive everything that had ever been deleted under it.
 *
 * One query per level, never one per node: four at most.
 *
 * @param manager - The transaction
 * @param level - The level of the node being deleted
 * @param id - The node
 * @param deletedAt - The instant to stamp, the node's own
 * @returns How many descendants were deleted
 *
 * @example
 * ```typescript
 * const deletedAt = new Date();
 * await manager.update(AdGroupEntity, { id }, { deletedAt });
 * await cascadeDelete(manager, 'ad_group', id, deletedAt);
 * ```
 */
export async function cascadeDelete(
  manager: EntityManager,
  level: TreeLevel,
  id: string,
  deletedAt: Date
): Promise<number> {
  let descriptor: NodeDescriptor | null = childDescriptorOf(level);
  let parentIds: string[] = [id];
  let deleted = 0;

  while (descriptor && parentIds.length > 0) {
    const column: string = descriptor.parentIdColumn as string;
    const rows: TreeNodeRow[] = (await manager.find(descriptor.entity, {
      where: { [column]: In(parentIds) },
    })) as TreeNodeRow[];
    const ids: string[] = rows.map((row: TreeNodeRow): string => row.id);
    if (ids.length > 0) await manager.update(descriptor.entity, { id: In(ids) }, { deletedAt });
    deleted += ids.length;
    parentIds = ids;
    descriptor = childDescriptorOf(descriptor.level);
  }
  return deleted;
}

/**
 * Restore the subtree a deletion took with it, and only that.
 *
 * A descendant is restored when it was deleted at **exactly** the instant the node was: that is the
 * subtree of this deletion. Anything deleted before stays deleted, which is what the user expects —
 * they undid one deletion, not every deletion that ever happened under that node.
 *
 * @param manager - The transaction
 * @param level - The level of the node being restored
 * @param id - The node
 * @param deletedAt - The instant the node carried before being restored
 * @returns How many descendants were restored
 *
 * @example
 * ```typescript
 * await cascadeRestore(manager, 'ad_group', id, adGroup.deletedAt);
 * ```
 */
export async function cascadeRestore(
  manager: EntityManager,
  level: TreeLevel,
  id: string,
  deletedAt: Date
): Promise<number> {
  let descriptor: NodeDescriptor | null = childDescriptorOf(level);
  let parentIds: string[] = [id];
  let restored = 0;

  while (descriptor && parentIds.length > 0) {
    const column: string = descriptor.parentIdColumn as string;
    const rows: TreeNodeRow[] = (await manager.find(descriptor.entity, {
      where: { [column]: In(parentIds), deletedAt },
      withDeleted: true,
    })) as TreeNodeRow[];
    const ids: string[] = rows.map((row: TreeNodeRow): string => row.id);
    if (ids.length > 0) await manager.update(descriptor.entity, { id: In(ids) }, { deletedAt: null });
    restored += ids.length;
    parentIds = ids;
    descriptor = childDescriptorOf(descriptor.level);
  }
  return restored;
}

/**
 * The effective budget of one node, resolved up the tree.
 *
 * The campaign carries its own amount; every level below is its parent's budget divided between its
 * siblings, explicit amounts first (`services/budget.helpers.ts`). So resolving a leaf reads one set
 * of siblings per level — four at most, and nothing is ever stored.
 *
 * @param manager - Where to read
 * @param level - The level of the node
 * @param id - The node
 * @returns What it may spend, in cents
 * @throws Error with status 404 when the node is gone, or 400 when a budget overflows its parent
 *
 * @example
 * ```typescript
 * await effectiveBudgetOf(manager, 'targeting_group', targetingGroupId); // 150000
 * ```
 */
export async function effectiveBudgetOf(manager: EntityManager, level: TreeLevel, id: string): Promise<number> {
  const descriptor: NodeDescriptor = descriptorOf(level);
  const node: TreeNodeRow | null = (await manager.findOne(descriptor.entity, {
    where: { id },
  })) as TreeNodeRow | null;
  if (!node) {
    throw httpError(404, `The ${level} this node hangs from is gone`, { code: descriptor.notFoundCode });
  }
  // The campaign's amount is mandatory in the schema, hence no fallback: its entity types it so.
  if (descriptor.parentLevel === null) return (node as CampaignEntity).budgetCents;

  const siblings: Map<string, ResolvedBudget> = await resolveSiblingBudgets(
    manager,
    level,
    node[descriptor.parentIdColumn as string] as string
  );
  // Nothing when the node is no longer among its parent's live children: someone else deleted it
  // between the two reads, which READ COMMITTED allows.
  return siblings.get(id)?.effectiveCents ?? 0;
}

/**
 * The budgets of every living child of one parent.
 *
 * Resolved together because they divide one amount: asking for one child's budget without its
 * siblings would be asking half the question.
 *
 * @param manager - Where to read
 * @param level - The level of the children
 * @param parentId - Their parent
 * @returns What each child may spend, by id
 *
 * @example
 * ```typescript
 * const budgets = await resolveSiblingBudgets(manager, 'ad_group', leverId);
 * budgets.get(adGroupId); // { effectiveCents: 30000, source: 'inherited' }
 * ```
 */
export async function resolveSiblingBudgets(
  manager: EntityManager,
  level: TreeLevel,
  parentId: string
): Promise<Map<string, ResolvedBudget>> {
  const descriptor: NodeDescriptor = descriptorOf(level);
  const parentBudget: number = await effectiveBudgetOf(manager, descriptor.parentLevel as TreeLevel, parentId);
  const rows: TreeNodeRow[] = (await manager.find(descriptor.entity, {
    where: { [descriptor.parentIdColumn as string]: parentId },
    order: { createdAt: 'ASC', id: 'ASC' },
  })) as TreeNodeRow[];

  return distributeBudget(
    parentBudget,
    rows.map((row: TreeNodeRow): BudgetChild => ({
      id: row.id,
      explicitCents: row.budgetCents,
      carriesBudget: carriesBudget(row.lever as Lever, level),
    }))
  );
}

/**
 * The distribution key that applies to a node: the AdGroup's override if it has one, else its
 * Lever's (`../../CADRAGE.md` § 4).
 *
 * A campaign has none — each of its levers has its own key, and summing them would describe nothing.
 *
 * @param manager - Where to read
 * @param level - The level of the node
 * @param node - The row
 * @returns Its shares, empty for a campaign
 *
 * @example
 * ```typescript
 * await resolvePlatformShares(manager, 'line', line); // the key of its AdGroup, or of its Lever
 * ```
 */
export async function resolvePlatformShares(
  manager: EntityManager,
  level: TreeLevel,
  node: TreeNodeRow
): Promise<PlatformShare[]> {
  if (level === 'campaign') return [];
  // A lever always carries a key: the column is mandatory, which its entity types.
  if (level === 'lever') return (node as LeverEntity).platformShares;

  const adGroupId: string = level === 'ad_group' ? node.id : await adGroupIdOf(manager, level, node);
  const adGroup: TreeNodeRow | null = (await manager.findOne(AdGroupEntity, {
    where: { id: adGroupId },
    withDeleted: true,
  })) as TreeNodeRow | null;
  if (!adGroup) return [];
  if (adGroup.platformShares && adGroup.platformShares.length > 0) return adGroup.platformShares;

  const lever: TreeNodeRow | null = (await manager.findOne(LeverEntity, {
    where: { id: adGroup.leverId as string },
    withDeleted: true,
  })) as TreeNodeRow | null;
  return lever?.platformShares ?? [];
}

/**
 * The AdGroup a TargetingGroup or a Line belongs to.
 *
 * @param manager - Where to read
 * @param level - The level of the node, below the AdGroup
 * @param node - The row
 * @returns The AdGroup id
 */
async function adGroupIdOf(manager: EntityManager, level: TreeLevel, node: TreeNodeRow): Promise<string> {
  if (level === 'targeting_group') return node.adGroupId as string;
  const targetingGroup: TreeNodeRow | null = (await manager.findOne(TargetingGroupEntity, {
    where: { id: node.targetingGroupId as string },
    withDeleted: true,
  })) as TreeNodeRow | null;
  return (targetingGroup?.adGroupId as string) ?? '';
}

/**
 * The budget of a node as every read answers it: what it carries, what it may spend, where that
 * comes from, the volume that was entered, and the split per platform.
 *
 * @param manager - Where to read
 * @param level - The level of the node
 * @param node - The row
 * @returns Its budget block
 *
 * @example
 * ```typescript
 * const budget = await budgetBlockOf(manager, 'lever', lever);
 * budget.source; // 'inherited'
 * ```
 */
export async function budgetBlockOf(manager: EntityManager, level: TreeLevel, node: TreeNodeRow): Promise<BudgetBlock> {
  const descriptor: NodeDescriptor = descriptorOf(level);
  const resolved: ResolvedBudget =
    descriptor.parentLevel === null
      ? { effectiveCents: (node as CampaignEntity).budgetCents, source: 'explicit' }
      : ((await resolveSiblingBudgets(manager, level, node[descriptor.parentIdColumn as string] as string)).get(
          node.id
        ) ?? { effectiveCents: 0, source: 'forbidden' });

  // A level its lever forbids a budget to has none to split: showing platforms at zero would read
  // as "nothing spent here yet" instead of "nothing can be spent here".
  const shares: PlatformShare[] =
    resolved.source === 'forbidden' ? [] : await resolvePlatformShares(manager, level, node);
  return {
    explicitCents: node.budgetCents,
    effectiveCents: resolved.effectiveCents,
    source: resolved.source,
    volume:
      node.budgetVolume !== null && node.budgetVolume !== undefined && node.budgetVolumeUnit
        ? { amount: node.budgetVolume, unit: node.budgetVolumeUnit }
        : null,
    perPlatform: splitByPlatform(resolved.effectiveCents, shares),
  };
}

/**
 * Load a node of an Organization, or answer the 404 of its level.
 *
 * 404 and not 403: a caller who cannot see a node must not learn that it exists
 * (`CLAUDE.md`).
 *
 * @param manager - Where to read
 * @param level - The level of the node
 * @param organizationId - The Organization it must belong to
 * @param id - The node
 * @param options - Whether a deleted node is accepted
 * @param options.deleted - `true` to also find a soft-deleted one
 * @returns The row
 * @throws Error with status 404 coded `<level>_not_found`
 *
 * @example
 * ```typescript
 * const campaign = await findNodeOrFail(manager, 'campaign', organizationId, id);
 * ```
 */
export async function findNodeOrFail(
  manager: EntityManager,
  level: TreeLevel,
  organizationId: string,
  id: string,
  options: { deleted?: boolean } = {}
): Promise<TreeNodeRow> {
  const descriptor: NodeDescriptor = descriptorOf(level);
  const node: TreeNodeRow | null = (await manager.findOne(descriptor.entity, {
    where: { id, organizationId },
    withDeleted: options.deleted === true,
  })) as TreeNodeRow | null;
  if (!node) {
    throw httpError(404, `No ${level.replace('_', ' ')} of this Organization has this id`, {
      code: descriptor.notFoundCode,
    });
  }
  return node;
}

/**
 * The window a node actually delivers on: its own when it overrides, else its parent's, resolved up
 * to the campaign (`../../CADRAGE.md` § 4).
 *
 * @param manager - Where to read
 * @param level - The level of the node
 * @param id - The node
 * @returns Its window
 * @throws Error with status 404 when the node is gone
 *
 * @example
 * ```typescript
 * await effectiveWindowOf(manager, 'ad_group', adGroupId); // { startsOn: '2026-11-05', endsOn: '2026-11-20' }
 * ```
 */
export async function effectiveWindowOf(manager: EntityManager, level: TreeLevel, id: string): Promise<DeliveryWindow> {
  const descriptor: NodeDescriptor = descriptorOf(level);
  const node: TreeNodeRow | null = (await manager.findOne(descriptor.entity, { where: { id } })) as TreeNodeRow | null;
  if (!node) {
    throw httpError(404, `The ${level.replace('_', ' ')} this node hangs from is gone`, {
      code: descriptor.notFoundCode,
    });
  }
  if (descriptor.parentLevel === null) {
    return { startsOn: node.startsOn as string, endsOn: node.endsOn as string };
  }

  const parent: DeliveryWindow = await effectiveWindowOf(
    manager,
    descriptor.parentLevel,
    node[descriptor.parentIdColumn as string] as string
  );
  return {
    startsOn: (node.startsOn as string | null) ?? parent.startsOn,
    endsOn: (node.endsOn as string | null) ?? parent.endsOn,
  };
}
