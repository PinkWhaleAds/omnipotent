/**
 * @module services/node.helpers
 *
 * The write mechanics of a node of the campaign tree: find it, validate what the caller sent against
 * its lever profile, delete it with its subtree, restore it.
 *
 * `tree.helpers.ts` says what the tree **is** (the levels, the cascade, the resolution of a budget);
 * this module says what a **write** on it is allowed to do. The five services call it instead of
 * repeating it, and each keeps what belongs to its own resource: its name, its own columns, its API
 * shape (`docs/phase-3.md` § 9.5).
 */
import { EntityManager, Not, ObjectLiteral } from 'typeorm';

import { assertFieldAllowedForLevers, assertVolumeUnitPermitted, carriesBudget } from '@src/levers/lever-profiles';
import { BudgetVolume, Capping, DeletionResult, Lever, TreeLevel } from '@src/types';
import { httpError } from '@utils';
import { assertWithinParent, volumeToCents } from './budget.helpers';
import {
  cascadeDelete,
  cascadeRestore,
  DeliveryWindow,
  descriptorOf,
  effectiveBudgetOf,
  NodeDescriptor,
  TreeNodeRow,
  assertWindowOrdered,
  assertWindowWithinParent,
} from './tree.helpers';

/** The fields of a node every level shares, as a request sends them. */
export type NodeWriteInput = {
  budgetCents?: number | null;
  budgetVolume?: BudgetVolume | null;
  startsOn?: string | null;
  endsOn?: string | null;
  capping?: Capping | null;
};

/**
 * What the validation needs to know about the node being written.
 *
 * @property level - Its level
 * @property levers - The channels the node spans, each carrying a profile: exactly one below the
 *   campaign, and those the campaign already carries at the campaign level — none at its creation
 * @property parentId - Its parent, `null` for a campaign
 * @property nodeId - The node, `null` while it is being created
 * @property bidAmountCents - The bid CPM a volume entry converts through (L3, L25)
 * @property current - The row as it stands, on an update
 */
export type NodeWriteContext = {
  level: TreeLevel;
  levers: Lever[];
  parentId: string | null;
  nodeId: string | null;
  bidAmountCents?: number | null;
  current?: TreeNodeRow;
};

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

/**
 * Refuse an explicit amount that would make the siblings overflow their parent (D8).
 *
 * The node being written is left out of the sum, since the amount replaces its own.
 *
 * @param manager - Where to read
 * @param level - The level of the node
 * @param parentId - Its parent
 * @param nodeId - The node, `null` while it is being created
 * @param explicitCents - The amount asked for
 * @returns Nothing
 * @throws Error with status 400 coded `budget_exceeds_parent`
 *
 * @example
 * ```typescript
 * await assertExplicitBudgetFits(manager, 'ad_group', leverId, adGroupId, 70000);
 * ```
 */
export async function assertExplicitBudgetFits(
  manager: EntityManager,
  level: TreeLevel,
  parentId: string,
  nodeId: string | null,
  explicitCents: number
): Promise<void> {
  const descriptor: NodeDescriptor = descriptorOf(level);
  const parentBudget: number = await effectiveBudgetOf(manager, descriptor.parentLevel as TreeLevel, parentId);
  const siblings: TreeNodeRow[] = (await manager.find(descriptor.entity, {
    where: {
      [descriptor.parentIdColumn as string]: parentId,
      ...(nodeId === null ? {} : { id: Not(nodeId) }),
    },
  })) as TreeNodeRow[];

  const explicitTotal: number = siblings.reduce(
    (total: number, sibling: TreeNodeRow): number => total + (sibling.budgetCents ?? 0),
    explicitCents
  );
  assertWithinParent(parentBudget, explicitTotal);
}

/**
 * Validate what a caller wrote on a node against its lever profile, and turn it into columns.
 *
 * What it enforces, in this order (`docs/phase-3.md` § 6):
 *
 * 1. a field a profile declares `forbidden` at this level is refused — `budget` on a Search Line
 *    (D12), any `capping` on the Search (L6). At the campaign level the rule is the union of the
 *    levers it carries, since a value written there applies to all of them;
 * 2. a budget entered **in volume** is converted through the bid CPM, and the amount is what is
 *    stored (L25); entering both is refused, since one of the two would be a lie;
 * 3. a window must be ordered and **inside its parent's**;
 * 4. an explicit amount must leave `Σ children ≤ parent` true.
 *
 * What it does **not** enforce is completeness: a node missing something is a node being written,
 * which the preview reports (`../../CADRAGE.md` § 13).
 *
 * @param manager - The transaction
 * @param context - The node being written
 * @param input - What the caller sent
 * @returns The columns to write
 * @throws Error with status 400 for any of the four rules above
 *
 * @example
 * ```typescript
 * const columns = await normalizeNodeWrite(manager, { level: 'line', levers: ['search'], parentId, nodeId: null }, body);
 * ```
 */
export async function normalizeNodeWrite(
  manager: EntityManager,
  context: NodeWriteContext,
  input: NodeWriteInput
): Promise<ObjectLiteral> {
  const { level, levers } = context;
  assertFieldAllowedForLevers(levers, level, 'budget', input.budgetCents != null || input.budgetVolume != null);
  assertFieldAllowedForLevers(levers, level, 'dates', input.startsOn != null || input.endsOn != null);
  assertFieldAllowedForLevers(levers, level, 'capping', input.capping != null);

  const columns: ObjectLiteral = {};
  if (input.capping !== undefined) columns.capping = input.capping;
  Object.assign(columns, await budgetColumns(manager, context, input));
  Object.assign(columns, await windowColumns(manager, context, input));
  return columns;
}

/**
 * The budget columns of a write: the amount, and the volume entry that produced it.
 *
 * @param manager - The transaction
 * @param context - The node being written
 * @param input - What the caller sent
 * @returns The columns
 * @throws Error with status 400 when both forms are sent, when a volume has no CPM, or when the
 *   amount overflows the parent
 */
async function budgetColumns(
  manager: EntityManager,
  context: NodeWriteContext,
  input: NodeWriteInput
): Promise<ObjectLiteral> {
  if (input.budgetCents != null && input.budgetVolume != null) {
    throw httpError(400, 'A budget is entered either as an amount or as a volume, not both', {
      code: 'budget_entered_twice',
      params: { unit: input.budgetVolume.unit },
    });
  }

  const columns: ObjectLiteral = {};
  if (input.budgetVolume != null) {
    for (const lever of context.levers) assertVolumeUnitPermitted(lever, input.budgetVolume.unit);
    columns.budgetCents = volumeToCents(
      input.budgetVolume.amount,
      input.budgetVolume.unit,
      context.bidAmountCents ?? null
    );
    columns.budgetVolume = input.budgetVolume.amount;
    columns.budgetVolumeUnit = input.budgetVolume.unit;
  } else if (input.budgetCents !== undefined) {
    // An amount entered by hand drops the volume that used to explain the old one.
    columns.budgetCents = input.budgetCents;
    columns.budgetVolume = null;
    columns.budgetVolumeUnit = null;
  }

  const wanted: number | null | undefined = columns.budgetCents as number | null | undefined;
  const carries: boolean = context.levers.every((lever: Lever): boolean => carriesBudget(lever, context.level));
  if (wanted != null && context.parentId !== null && carries) {
    await assertExplicitBudgetFits(manager, context.level, context.parentId, context.nodeId, wanted);
  }
  return columns;
}

/**
 * The window columns of a write, checked against the parent's own window.
 *
 * @param manager - The transaction
 * @param context - The node being written
 * @param input - What the caller sent
 * @returns The columns
 * @throws Error with status 400 when the window is reversed or outside its parent's
 */
async function windowColumns(
  manager: EntityManager,
  context: NodeWriteContext,
  input: NodeWriteInput
): Promise<ObjectLiteral> {
  const columns: ObjectLiteral = {};
  if (input.startsOn !== undefined) columns.startsOn = input.startsOn;
  if (input.endsOn !== undefined) columns.endsOn = input.endsOn;

  const startsOn: string | null =
    (columns.startsOn as string | null | undefined) ?? (context.current?.startsOn as string | null) ?? null;
  const endsOn: string | null =
    (columns.endsOn as string | null | undefined) ?? (context.current?.endsOn as string | null) ?? null;
  if (startsOn === null || endsOn === null) return columns;

  assertWindowOrdered({ startsOn, endsOn });
  if (context.parentId !== null) {
    const parentLevel: TreeLevel = descriptorOf(context.level).parentLevel as TreeLevel;
    assertWindowWithinParent({ startsOn, endsOn }, await effectiveWindowOf(manager, parentLevel, context.parentId));
  }
  return columns;
}

/**
 * Soft-delete a node and its subtree (D19).
 *
 * @param manager - The transaction
 * @param level - The level of the node
 * @param organizationId - The Organization it belongs to
 * @param id - The node
 * @returns Its id and when it was deleted
 * @throws Error with status 404 when it is absent or of another Organization
 *
 * @example
 * ```typescript
 * await deleteNode(manager, 'ad_group', organizationId, id); // { id, deletedAt: '2026-10-25T…' }
 * ```
 */
export async function deleteNode(
  manager: EntityManager,
  level: TreeLevel,
  organizationId: string,
  id: string
): Promise<DeletionResult> {
  const node: TreeNodeRow = await findNodeOrFail(manager, level, organizationId, id);
  const deletedAt = new Date();
  await manager.update(descriptorOf(level).entity, { id: node.id }, { deletedAt });
  await cascadeDelete(manager, level, node.id, deletedAt);
  return { id: node.id, deletedAt: deletedAt.toISOString() };
}

/**
 * Restore a node and the subtree its deletion took with it.
 *
 * @param manager - The transaction
 * @param level - The level of the node
 * @param organizationId - The Organization it belongs to
 * @param id - The node
 * @returns Its id, with `deletedAt` back to `null`
 * @throws Error with status 404 when it is absent, 409 coded `<level>_not_deleted` when it lives
 *
 * @example
 * ```typescript
 * await restoreNode(manager, 'ad_group', organizationId, id); // { id, deletedAt: null }
 * ```
 */
export async function restoreNode(
  manager: EntityManager,
  level: TreeLevel,
  organizationId: string,
  id: string
): Promise<DeletionResult> {
  const node: TreeNodeRow = await findNodeOrFail(manager, level, organizationId, id, { deleted: true });
  if (!node.deletedAt) {
    throw httpError(409, `This ${level.replace('_', ' ')} is not deleted`, {
      code: descriptorOf(level).notDeletedCode,
    });
  }
  // The instant is read before the row is cleared: it is what tells the subtree of this deletion
  // apart from what had been deleted earlier.
  const deletedAt: Date = node.deletedAt;
  await manager.update(descriptorOf(level).entity, { id: node.id }, { deletedAt: null });
  await cascadeRestore(manager, level, node.id, deletedAt);
  return { id: node.id, deletedAt: null };
}
