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
import { DataSource, EntityManager, Not, ObjectLiteral, SelectQueryBuilder } from 'typeorm';

import { assertFieldAllowedForLevers, assertVolumeUnitPermitted, carriesBudget } from '@src/levers/lever-profiles';
import {
  BudgetVolume,
  CampaignStatus,
  Capping,
  DeletionResult,
  Lever,
  ListQuery,
  NodeStatus,
  TreeLevel,
} from '@src/types';
import { escapeLike, httpError, toSkipTake, withoutAccents, withoutAccentsSql } from '@utils';
import { CampaignEntity } from '@src/database/entities';
import { applyLabelFilter, toOrder } from './crud.helpers';
import { dropCurve } from './budget-curve.service';
import { assertWithinParent, volumeToCents } from './budget.helpers';
import {
  assertWindowOrdered,
  assertWindowWithinParent,
  cascadeDelete,
  cascadeRestore,
  descriptorOf,
  effectiveBudgetOf,
  effectiveWindowOf,
  findNodeOrFail,
  NodeDescriptor,
  TreeNodeRow,
} from './tree.helpers';

/**
 * Reading a node and resolving its window live with the descriptors, in `tree.helpers.ts`; they are
 * re-exported here because every write starts by reading the node it changes.
 */
export { effectiveWindowOf, findNodeOrFail } from './tree.helpers';

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
  /**
   * The campaign the node belongs to, when one is being **created** below it.
   *
   * A node created inside a campaign that has already launched starts **paused** and reaches no
   * platform until it is activated (`../../CADRAGE.md` § 13). The rule lives here, once, so it holds
   * for the four levels below the campaign.
   */
  campaignId?: string;
};

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

  // A node that gives its budget back has nothing left to spread over days, so its curve goes with
  // it (`docs/phase-4.md` § 8, point 1). Written here, once, for the five levels.
  if (columns.budgetCents === null && context.nodeId !== null) {
    await dropCurve(manager, context.level, context.nodeId);
  }

  if (context.nodeId === null && context.campaignId !== undefined) {
    columns.status = await statusOfNewNode(manager, context.campaignId);
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

/**
 * Read a page of nodes of one level, with everything a list route asks for: the Organization, the
 * parent, the text search, the label filter, the sort and the deleted ones.
 *
 * The four lower levels list the same way; what differs is the shape each service maps the rows to,
 * which stays its own business.
 *
 * @param dataSource - Application database
 * @param level - The level to list
 * @param scope - The Organization, and the parent whose children are listed
 * @param scope.organizationId - The Organization every row must belong to
 * @param scope.parentId - The parent, left out at the root
 * @param query - Page, sort, search, label filter, and whether the deleted ones are listed
 * @param searchColumn - The column a text search applies to, `null` for a level with no name
 * @returns The rows of the page, and how many there are in all
 *
 * @example
 * ```typescript
 * const [rows, total] = await listNodes(this.dataSource, 'ad_group', { organizationId, parentId: leverId }, query, 'name');
 * ```
 */
export async function listNodes(
  dataSource: DataSource,
  level: TreeLevel,
  scope: { organizationId: string; parentId?: string },
  query: ListQuery,
  searchColumn: string | null
): Promise<[TreeNodeRow[], number]> {
  const descriptor: NodeDescriptor = descriptorOf(level);
  const builder: SelectQueryBuilder<ObjectLiteral> = dataSource
    .getRepository(descriptor.entity)
    .createQueryBuilder(level)
    .withDeleted()
    .where(`${level}.organization_id = :organizationId`, { organizationId: scope.organizationId });

  if (scope.parentId !== undefined) {
    builder.andWhere(`${level}.${descriptor.parentColumnSql} = :parentId`, { parentId: scope.parentId });
  }
  if (!query.includeDeleted) builder.andWhere(`${level}.deleted_at IS NULL`);
  if (query.search && searchColumn) {
    builder.andWhere(`${withoutAccentsSql(`${level}.${searchColumn}`)} ILIKE :search`, {
      search: `%${escapeLike(withoutAccents(query.search))}%`,
    });
  }
  applyLabelFilter(builder, level, query.labelIds, query.labelMode);

  const { skip, take } = toSkipTake(query);
  for (const [field, direction] of Object.entries(toOrder(query.sortBy, query.sortOrder))) {
    builder.addOrderBy(`${level}.${field}`, direction);
  }
  const [rows, total]: [ObjectLiteral[], number] = await builder.skip(skip).take(take).getManyAndCount();
  return [rows as TreeNodeRow[], total];
}

/**
 * The status a node takes when it is created.
 *
 * `active` under a campaign still in `draft` — nothing has been sent anywhere, so there is nothing to
 * interrupt — and **`paused`** under a campaign that has launched: a node added to a live campaign
 * reaches no platform until someone activates it (`../../CADRAGE.md` § 13), which is what keeps an
 * unfinished AdGroup from spending money the hour it is written.
 *
 * @param manager - Where to read
 * @param campaignId - The campaign the node belongs to
 * @returns The status to store
 *
 * @example
 * ```typescript
 * await statusOfNewNode(manager, campaignId); // 'paused' once the campaign is active
 * ```
 */
export async function statusOfNewNode(manager: EntityManager, campaignId: string): Promise<NodeStatus> {
  const campaign: { status: CampaignStatus } | null = await manager.findOne(CampaignEntity, {
    where: { id: campaignId },
    select: { status: true },
    withDeleted: true,
  });
  return campaign && campaign.status !== 'draft' ? 'paused' : 'active';
}
