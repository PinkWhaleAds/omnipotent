import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource, EntityManager } from 'typeorm';

import { BudgetDayEntity } from '@src/database/entities';
import { AuthContext } from '@src/types/auth.types';
import {
  ApplyBudgetPresetBody,
  BudgetCurve,
  Pacing,
  SnapshotOrganization,
  TreeLevel,
  UpdateBudgetDaysBody,
} from '@src/types';
import { httpError } from '@utils';
import { AccessService } from './access.service';
import {
  applyEdits,
  assertCurvePeriod,
  CurveDay,
  followShape,
  presetCurve,
  completeCurve,
  toBudgetDays,
} from './budget-curve.helpers';
import { dayAt, paceDay, PlannedDay } from './pacing.helpers';
import {
  DeliveryWindow,
  descriptorOf,
  effectiveBudgetOf,
  effectiveWindowOf,
  findNodeOrFail,
  NodeDescriptor,
  TreeNodeRow,
} from './tree.helpers';

/** The timezone a campaign falls back on when neither it nor its Organization names one. */
const DEFAULT_TIMEZONE = 'UTC';

/**
 * Manages the daily curve of any node of the campaign tree, and its pacing (phase 4,
 * `docs/phase-4.md`).
 *
 * One service for the five levels, as there is one table: a curve is a budget spread over days, and
 * that is the same thing whatever carries it. The level travels as an argument, taken from the URL.
 *
 * Two things it does not do, deliberately. It never **stores** what it can compute: a node whose
 * days nobody shaped answers a flat curve, and a node with no explicit budget answers the shape of
 * its parent pro rata. And it never **pushes** a budget anywhere: the pacing is a pure function the
 * synchronization reads (`../../CADRAGE.md` § 4).
 */
export class BudgetCurveService {
  /**
   * Create the service.
   *
   * @param dataSource - Application database
   * @param access - Permission checks
   * @param now - Clock, in milliseconds since the epoch; injected so a spec can fix today
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: AccessService,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * The curve of a node: its own, or the shape of its parent pro rata.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param level - The level of the node
   * @param nodeId - The node
   * @returns Its curve, and whether it is its own
   * @throws Error with status 404 when the caller cannot see the node, 400 when its window is
   *   impossible or its past days hold more than its budget
   */
  public async get(actor: AuthContext, organizationId: string, level: TreeLevel, nodeId: string): Promise<BudgetCurve> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    const node: TreeNodeRow = await findNodeOrFail(this.dataSource.manager, level, organizationId, nodeId);
    return this.curveOf(this.dataSource.manager, actor, organizationId, level, node);
  }

  /**
   * Edit days of a curve, the free days absorbing the difference.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param level - The level of the node
   * @param nodeId - The node
   * @param body - The days to change
   * @returns The curve as it now stands
   * @throws Error with status 403 without the manager role, 404 when the node is absent, 400 when the
   *   node has no curve of its own or the edits cannot hold
   */
  public async update(
    actor: AuthContext,
    organizationId: string,
    level: TreeLevel,
    nodeId: string,
    body: UpdateBudgetDaysBody
  ): Promise<BudgetCurve> {
    return this.write(actor, organizationId, level, nodeId, (current: CurveDay[], budgetCents: number, today) =>
      applyEdits(current, body, budgetCents, today)
    );
  }

  /**
   * Give a curve a shape: flat, boosted at the weekend, ramping up, or only on the weekdays named —
   * and, with any of them, with named days taken out (`docs/phase-4.md` § 3.3).
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param level - The level of the node
   * @param nodeId - The node
   * @param body - The shape, and what it needs
   * @returns The curve as it now stands
   * @throws Error with status 403 without the manager role, 404 when the node is absent, 400 when the
   *   node has no curve of its own or the shape leaves no day able to deliver
   */
  public async applyPreset(
    actor: AuthContext,
    organizationId: string,
    level: TreeLevel,
    nodeId: string,
    body: ApplyBudgetPresetBody
  ): Promise<BudgetCurve> {
    return this.write(
      actor,
      organizationId,
      level,
      nodeId,
      (current: CurveDay[], budgetCents: number, today, days: string[]) =>
        presetCurve(current, days, budgetCents, body, today)
    );
  }

  /**
   * Forget the shape of a curve: the node goes back to spreading its budget evenly.
   *
   * The rows are deleted rather than rewritten flat — a flat curve is what a node with no row
   * answers, so storing it would be storing a default.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param level - The level of the node
   * @param nodeId - The node
   * @returns The flat curve it now answers
   * @throws Error with status 403 without the manager role, 404 when the node is absent
   */
  public async reset(
    actor: AuthContext,
    organizationId: string,
    level: TreeLevel,
    nodeId: string
  ): Promise<BudgetCurve> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<BudgetCurve> => {
      const node: TreeNodeRow = await findNodeOrFail(manager, level, organizationId, nodeId);
      await dropCurve(manager, level, nodeId);
      return this.curveOf(manager, actor, organizationId, level, node);
    });
  }

  /**
   * What to spend today on a node, and where its spend stands against its plan.
   *
   * The spend is **0** until the reporting phase feeds it: the answer is therefore a plan rather than
   * a diagnosis, which is honest — nothing has delivered yet (`docs/phase-4.md` § 4).
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param level - The level of the node
   * @param nodeId - The node
   * @returns Its pacing for the current day, in the timezone of its campaign
   * @throws Error with status 404 when the caller cannot see the node
   */
  public async pacing(actor: AuthContext, organizationId: string, level: TreeLevel, nodeId: string): Promise<Pacing> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    const node: TreeNodeRow = await findNodeOrFail(this.dataSource.manager, level, organizationId, nodeId);
    const curve: BudgetCurve = await this.curveOf(this.dataSource.manager, actor, organizationId, level, node);
    const timezone: string = await this.timezoneOf(this.dataSource.manager, actor, organizationId, level, node);
    const plan: PlannedDay[] = curve.days.map((day): PlannedDay => ({ day: day.day, cents: day.cents }));
    return paceDay(plan, 0, dayAt(this.now(), timezone));
  }

  /**
   * Shape a curve and store it: the body of `update` and of `applyPreset`, which differ only by the
   * function they apply.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param level - The level of the node
   * @param nodeId - The node
   * @param shape - What to do to the current curve
   * @returns The curve as it now stands
   * @throws Error with status 403 without the manager role, 404 when absent, 400 coded
   *   `budget_curve_not_allowed` when the node has no budget of its own
   */
  private async write(
    actor: AuthContext,
    organizationId: string,
    level: TreeLevel,
    nodeId: string,
    shape: (current: CurveDay[], budgetCents: number, today: string | null, days: string[]) => CurveDay[]
  ): Promise<BudgetCurve> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<BudgetCurve> => {
      const node: TreeNodeRow = await findNodeOrFail(manager, level, organizationId, nodeId);
      if (node.budgetCents === null) {
        throw httpError(400, `This ${level.replace('_', ' ')} has no budget of its own, so no curve of its own`, {
          code: 'budget_curve_not_allowed',
          params: { level },
        });
      }

      const days: string[] = await this.daysOf(manager, level, nodeId);
      const budgetCents: number = node.budgetCents;
      const today: string | null = await this.todayOf(manager, actor, organizationId, level, node);
      const current: CurveDay[] = await this.storedCurve(manager, level, nodeId, days, budgetCents, today);

      const shaped: CurveDay[] = shape(current, budgetCents, today, days);
      await dropCurve(manager, level, nodeId);
      await manager.insert(
        BudgetDayEntity,
        shaped.map((day: CurveDay) => ({ level, nodeId, day: day.day, cents: day.cents, locked: day.locked }))
      );
      return { level, nodeId, source: 'own', totalCents: budgetCents, days: toBudgetDays(shaped) };
    });
  }

  /**
   * The curve a node answers: its own when it carries a budget, else the shape of its parent pro rata.
   *
   * @param manager - Where to read
   * @param actor - The caller, whose snapshot carries the Organization's timezone
   * @param organizationId - The Organization
   * @param level - The level of the node
   * @param node - The row
   * @returns Its curve
   * @throws Error with status 400 when its window is impossible, or its days cannot hold its budget
   */
  private async curveOf(
    manager: EntityManager,
    actor: AuthContext,
    organizationId: string,
    level: TreeLevel,
    node: TreeNodeRow
  ): Promise<BudgetCurve> {
    const days: string[] = await this.daysOf(manager, level, node.id);
    const totalCents: number = await effectiveBudgetOf(manager, level, node.id);
    const today: string | null = await this.todayOf(manager, actor, organizationId, level, node);

    if (node.budgetCents !== null) {
      const own: CurveDay[] = await this.storedCurve(manager, level, node.id, days, totalCents, today);
      return { level, nodeId: node.id, source: 'own', totalCents, days: toBudgetDays(own) };
    }

    const descriptor: NodeDescriptor = descriptorOf(level);
    const parentLevel: TreeLevel = descriptor.parentLevel as TreeLevel;
    const parentId: string = node[descriptor.parentIdColumn as string] as string;
    const parent: TreeNodeRow = await findNodeOrFail(manager, parentLevel, organizationId, parentId);
    const above: BudgetCurve = await this.curveOf(manager, actor, organizationId, parentLevel, parent);
    const shape: CurveDay[] = followShape(
      above.days.map((day): CurveDay => ({ day: day.day, cents: day.cents, locked: false })),
      days,
      totalCents
    );
    return { level, nodeId: node.id, source: 'inherited', totalCents, days: toBudgetDays(shape) };
  }

  /**
   * The curve stored for a node, completed over its window.
   *
   * A node nobody shaped has no row: its budget is then spread evenly, which is what
   * {@link completeCurve} does with days it has never seen. A node whose window moved keeps the days
   * still inside it, and the days that appeared take a fair share.
   *
   * @param manager - Where to read
   * @param level - The level of the node
   * @param nodeId - The node
   * @param days - The days of its window
   * @param totalCents - The budget the days must add up to
   * @param today - Today in the campaign's timezone, `null` for a draft
   * @returns Its curve, adding up to `totalCents`
   */
  private async storedCurve(
    manager: EntityManager,
    level: TreeLevel,
    nodeId: string,
    days: string[],
    totalCents: number,
    today: string | null
  ): Promise<CurveDay[]> {
    const rows: BudgetDayEntity[] = await manager.find(BudgetDayEntity, {
      where: { level, nodeId },
      order: { day: 'ASC' },
    });
    const stored: CurveDay[] = rows.map((row: BudgetDayEntity): CurveDay => ({
      day: row.day,
      cents: row.cents,
      locked: row.locked,
    }));
    return completeCurve(stored, days, totalCents, today);
  }

  /**
   * The days of the window a node delivers on.
   *
   * @param manager - Where to read
   * @param level - The level of the node
   * @param nodeId - The node
   * @returns Its days
   * @throws Error with status 400 when the window is reversed or longer than two years
   */
  private async daysOf(manager: EntityManager, level: TreeLevel, nodeId: string): Promise<string[]> {
    const window: DeliveryWindow = await effectiveWindowOf(manager, level, nodeId);
    return assertCurvePeriod(window.startsOn, window.endsOn);
  }

  /**
   * Today, in the timezone of the campaign the node belongs to — or `null` while the campaign is a
   * draft, which has no day already past.
   *
   * @param manager - Where to read
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param level - The level of the node
   * @param node - The row
   * @returns Today, or `null`
   */
  private async todayOf(
    manager: EntityManager,
    actor: AuthContext,
    organizationId: string,
    level: TreeLevel,
    node: TreeNodeRow
  ): Promise<string | null> {
    const campaign: TreeNodeRow = await this.campaignOf(manager, organizationId, level, node);
    if (campaign.status === 'draft') return null;
    return dayAt(this.now(), this.resolveTimezone(actor, organizationId, campaign));
  }

  /**
   * The timezone the days of a node are counted in.
   *
   * @param manager - Where to read
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param level - The level of the node
   * @param node - The row
   * @returns An IANA timezone
   */
  private async timezoneOf(
    manager: EntityManager,
    actor: AuthContext,
    organizationId: string,
    level: TreeLevel,
    node: TreeNodeRow
  ): Promise<string> {
    return this.resolveTimezone(actor, organizationId, await this.campaignOf(manager, organizationId, level, node));
  }

  /**
   * The campaign a node belongs to — itself, at the root.
   *
   * @param manager - Where to read
   * @param organizationId - The Organization
   * @param level - The level of the node
   * @param node - The row
   * @returns The campaign row
   * @throws Error with status 404 when the campaign is gone
   */
  private async campaignOf(
    manager: EntityManager,
    organizationId: string,
    level: TreeLevel,
    node: TreeNodeRow
  ): Promise<TreeNodeRow> {
    if (level === 'campaign') return node;
    return findNodeOrFail(manager, 'campaign', organizationId, node.campaignId as string, { deleted: true });
  }

  /**
   * The timezone of a campaign: its own, else its Organization's, else UTC.
   *
   * The Organization's comes from the snapshot omnipass resolved for this request — nothing here
   * reads a tenancy table, which omnipass alone owns (T5).
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param campaign - The campaign row
   * @returns An IANA timezone
   */
  private resolveTimezone(actor: AuthContext, organizationId: string, campaign: TreeNodeRow): string {
    const own: string | null = (campaign.timezone as string | null) ?? null;
    if (own !== null) return own;
    const organization: SnapshotOrganization | undefined = actor.tenancy.organizations.find(
      (candidate: SnapshotOrganization): boolean => candidate.id === organizationId
    );
    return organization?.timezone ?? DEFAULT_TIMEZONE;
  }
}

/**
 * Forget the curve of a node.
 *
 * Exported because the tree calls it too: a node that gives its budget back has nothing left to
 * spread, so its days go with it (`docs/phase-4.md` § 8, point 1).
 *
 * @param manager - The transaction
 * @param level - The level of the node
 * @param nodeId - The node
 * @returns Nothing
 *
 * @example
 * ```typescript
 * await dropCurve(manager, 'ad_group', adGroupId);
 * ```
 */
export async function dropCurve(manager: EntityManager, level: TreeLevel, nodeId: string): Promise<void> {
  await manager.delete(BudgetDayEntity, { level, nodeId });
}

/**
 * Fastify plugin that decorates the instance with a {@link BudgetCurveService}.
 *
 * Depends on `DatabasePlugin` and `AccessServicePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function budgetCurveServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('budgetCurveService', new BudgetCurveService(fastify.db, fastify.accessService));
}

export default fastifyPlugin(budgetCurveServicePlugin, {
  name: 'BudgetCurveServicePlugin',
  dependencies: ['DatabasePlugin', 'AccessServicePlugin'],
});
