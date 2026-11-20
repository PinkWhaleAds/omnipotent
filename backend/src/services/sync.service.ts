import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource, EntityManager, In, IsNull, LessThanOrEqual, QueryRunner } from 'typeorm';

import { syncConfig, SyncConfig } from '@configs';
import {
  AdAccountEntity,
  AdGroupEntity,
  AdvertiserAdAccountEntity,
  CampaignEntity,
  CreativeEntity,
  CreativeVersionEntity,
  ExternalIdHistoryEntity,
  KeywordEntity,
  LeverEntity,
  LineEntity,
  PlatformUnitEntity,
  TargetingGroupEntity,
} from '@src/database/entities';
import {
  adapterOf,
  ApplyResult,
  hasAdapterFor,
  PlatformAdapter,
  PlatformContext,
  PlatformError,
} from '@src/platforms/platform-adapter';
import { DesiredCreative, DesiredKeyword, DesiredNode, desiredUnit, DesiredUnit } from '@src/platforms/desired-state';
import { hasAdapter, PlatformProjection, projectionOf, rulesOf } from '@src/platforms/platform-rules';
import { ProjectedObject, projectObjects } from '@src/platforms/projection';
import {
  AuthContext,
  BidStrategy,
  CampaignPlatformStatus,
  MessageParams,
  Platform,
  PlatformObjectRef,
  PlatformShare,
  PlatformUnitView,
  SyncRequested,
  TreeLevel,
} from '@src/types';
import { errorCodeOf, httpError, Logger, LoggerBuilder } from '@utils';
import { AccessService } from './access.service';
import { BudgetCurveService } from './budget-curve.service';
import {
  adGroupsOf,
  branchStructure,
  CampaignTree,
  linesOf,
  readCampaignTree,
  targetingGroupsOf,
} from './campaign-tree.helpers';
import { dayAt, nextLocalMidnight, resolveCampaignTimezone } from './pacing.helpers';
import { SecretStore } from './secret-store.service';
import { markCampaignDirty } from './sync.helpers';
import { resolvePlatformShares } from './tree.helpers';

/** One minute, in milliseconds. */
const MINUTE_IN_MS = 60_000;

/**
 * What an account buys in, once known.
 *
 * @property currency - ISO 4217; every amount sent is expressed in it
 * @property timezone - IANA; the platform counts its days in it
 */
type AccountMoney = { currency: string; timezone: string };

/** The statuses of a campaign whose units are kept in step with the platforms. */
const LIVE_STATUSES: readonly CampaignEntity['status'][] = ['active', 'paused'];

/** Asks for a campaign to be synchronized, without waiting for it to happen. */
export interface SyncScheduler {
  /**
   * Queue a synchronization of one campaign.
   *
   * @param campaignId - The campaign
   * @returns A promise that resolves once the job is queued
   */
  request(campaignId: string): Promise<void>;
}

/**
 * Makes the platforms match what the tree says, and does nothing at all when they already do.
 *
 * The rule the whole phase hangs from (`../../CADRAGE.md` § 14):
 *
 * > La base porte l'intention, la plateforme porte l'état, quelque chose réconcilie périodiquement
 * > les deux.
 *
 * So this service never pushes a modification. It builds the **desired state** — a pure function of
 * the tree —, hashes it, and calls an adapter only when the hash differs from the one it last
 * applied. Nothing is held in memory between two runs: a worker killed in flight costs a recompute,
 * never a lost change, because the dirty bit it was working from is a column
 * (`services/sync.helpers.ts`).
 */
export class SyncService {
  /** @internal Logger scoped to this class. */
  private readonly logger: Logger = LoggerBuilder.getChildLogger('SyncService');

  /**
   * Create the engine.
   *
   * @param dataSource - Application database
   * @param access - Permission checks, for the routes only: a job has no caller
   * @param curves - Where the paced budget of a day comes from
   * @param secrets - Where the credentials of an account are read, at the last moment
   * @param scheduler - How a synchronization is asked for
   * @param config - Backoff, batch size and pacing jitter
   * @param now - Current time in epoch milliseconds, injectable so a test owns the clock
   * @param random - Source of the pacing jitter, injectable for the same reason
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: AccessService,
    private readonly curves: BudgetCurveService,
    private readonly secrets: SecretStore,
    private readonly scheduler: SyncScheduler,
    private readonly config: SyncConfig = syncConfig,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random
  ) {}

  /**
   * Create the units a campaign needs, and nothing else.
   *
   * One unit per couple **(AdGroup, platform)**, for each AdGroup **activated** once, among the
   * platforms **that AdGroup** buys on — its own
   * distribution key when it carries one, its lever's otherwise —, where the brand has an account in
   * the campaign's currency and the couple has rules. Idempotent, and called inside the transaction
   * that launches a campaign so a launch cannot half-happen.
   *
   * The frozen rate is 1 because the account is looked up **by the campaign's currency** (phase 7):
   * the two currencies are equal by construction, so no conversion is pending an exchange service.
   *
   * @param manager - The transaction
   * @param tree - The campaign's tree
   * @returns Every unit of the campaign, the ones that already existed included
   *
   * @example
   * ```typescript
   * await this.ensureUnits(manager, await readCampaignTree(manager, campaign));
   * ```
   */
  public async ensureUnits(manager: EntityManager, tree: CampaignTree): Promise<PlatformUnitEntity[]> {
    const campaign: CampaignEntity = tree.campaign;
    const existing: PlatformUnitEntity[] = await manager.find(PlatformUnitEntity, {
      where: { campaignId: campaign.id },
    });
    const known = new Set<string>(
      existing.map((unit: PlatformUnitEntity): string => `${unit.adGroupId}:${unit.platform}`)
    );
    const wanted: Partial<PlatformUnitEntity>[] = [];

    for (const lever of tree.levers) {
      for (const group of adGroupsOf(tree, lever.id)) {
        // An AdGroup never activated reaches no platform (`../../CADRAGE.md` § 13): born paused in a
        // live campaign, or left paused at the launch, it gets its units when it is activated.
        if (group.activatedAt === null) continue;
        // Resolved on the **AdGroup**, not on the lever: an AdGroup may carry its own distribution
        // key, and it is the one that decides which platforms this AdGroup buys on (§ 4 of
        // `../../CADRAGE.md`).
        const shares: PlatformShare[] = await resolvePlatformShares(manager, 'ad_group', group);
        for (const { platform } of shares) {
          const link: AdvertiserAdAccountEntity | undefined = tree.linksByPlatform.get(platform);
          if (!link || !hasAdapter(platform, lever.lever) || known.has(`${group.id}:${platform}`)) continue;
          wanted.push({
            organizationId: campaign.organizationId,
            campaignId: campaign.id,
            leverId: lever.id,
            adGroupId: group.id,
            lever: lever.lever,
            platform: platform as Platform,
            adAccountId: link.adAccountId,
            fxRate: 1,
            refs: {},
            syncState: 'pending',
          });
        }
      }
    }

    if (wanted.length > 0) await manager.insert(PlatformUnitEntity, wanted);
    return manager.find(PlatformUnitEntity, { where: { campaignId: campaign.id } });
  }

  /**
   * Apply the desired state of every unit of one campaign.
   *
   * Runs under the campaign's lock (D46): a worker that does not get it **does nothing**, because
   * another one is already doing the work and the sweep will catch anything left. That is also what
   * makes the lazy creation of a shared parent object safe — two workers cannot both create the
   * mediaplan of the same campaign.
   *
   * @param campaignId - The campaign
   * @returns A promise that resolves once every unit was tried, or the lock was declined
   *
   * @example
   * ```typescript
   * await fastify.syncService.syncCampaign(campaignId); // the `sync.campaign` job
   * ```
   */
  public async syncCampaign(campaignId: string): Promise<void> {
    await this.withLock(`sync:${campaignId}`, async (): Promise<void> => {
      const campaign: CampaignEntity | null = await this.dataSource.manager.findOne(CampaignEntity, {
        where: { id: campaignId },
        withDeleted: true,
      });
      // A draft has nothing over there, and never had: there is nothing to reconcile.
      if (!campaign || campaign.status === 'draft') return;

      const tree: CampaignTree = await readCampaignTree(this.dataSource.manager, campaign);
      const units: PlatformUnitEntity[] = LIVE_STATUSES.includes(campaign.status)
        ? await this.dataSource.transaction((manager: EntityManager) => this.ensureUnits(manager, tree))
        : await this.dataSource.manager.find(PlatformUnitEntity, { where: { campaignId } });

      for (const unit of units) await this.syncUnit(tree, unit);
    });
  }

  /**
   * The periodic catch-up: queue a sync for every campaign that has a unit waiting.
   *
   * This is D34 in one query. It reads **only** the units marked `pending`, and the ones whose
   * temporary failure is due again, through the partial index on `next_attempt_at` — so one indexed
   * read a minute in a steady state, whatever the size of the database. A campaign where nothing
   * happened is never loaded, because nothing marked it.
   *
   * @returns A promise that resolves once the syncs are queued
   */
  public async sweep(): Promise<void> {
    const due: PlatformUnitEntity[] = await this.dataSource.manager.find(PlatformUnitEntity, {
      where: [{ syncState: 'pending' }, { syncState: 'error', nextAttemptAt: LessThanOrEqual(new Date(this.now())) }],
      select: { campaignId: true },
      take: this.config.sweepBatchSize,
    });
    for (const campaignId of new Set(due.map((unit: PlatformUnitEntity): string => unit.campaignId))) {
      await this.scheduler.request(campaignId);
    }
  }

  /**
   * Recompute the day's budget of the campaigns whose local midnight has passed.
   *
   * One appointment per campaign rather than a sweep of the fleet (D34 rule 2): `nextPacingAt` holds
   * it, and it is pushed to the **next local midnight plus a jitter** (D47) so the campaigns of one
   * timezone do not all recompute in the same second.
   *
   * Nothing is computed here: marking the units is enough, since the day's budget is part of the
   * desired state and the sync recomputes it. A job that pushed budgets itself would be a second
   * source of truth beside the engine.
   *
   * @returns A promise that resolves once every due campaign was marked and queued
   */
  public async refreshPacing(): Promise<void> {
    const due: CampaignEntity[] = await this.dataSource.manager.find(CampaignEntity, {
      where: { status: In(LIVE_STATUSES), nextPacingAt: LessThanOrEqual(new Date(this.now())), deletedAt: IsNull() },
      take: this.config.sweepBatchSize,
    });
    for (const campaign of due) {
      await this.dataSource.transaction(async (manager: EntityManager): Promise<void> => {
        await manager.update(
          CampaignEntity,
          { id: campaign.id },
          { nextPacingAt: this.nextPacingAt(campaign.timezone) }
        );
        await markCampaignDirty(manager, campaign.id);
      });
      await this.scheduler.request(campaign.id);
    }
  }

  /**
   * End the campaigns whose last day is past, in one statement.
   *
   * D34 rule 3: the timezone is resolved **in SQL**, so this is one indexed `UPDATE` and never a loop
   * over the fleet. The campaigns it ends are then marked and queued, because ending a campaign is a
   * change the platforms must hear about — everything over there goes to pause.
   *
   * @returns A promise that resolves once the campaigns are ended and queued
   */
  public async endCampaigns(): Promise<void> {
    const ended: { id: string }[] = await this.dataSource.transaction(
      async (manager: EntityManager): Promise<{ id: string }[]> => {
        // An `UPDATE … RETURNING` answers `[rows, count]`, where a `SELECT` answers the rows: taking
        // the first element is not a nicety, it is the shape of the driver's reply.
        const [rows]: [{ id: string }[], number] = (await manager.query(
          `UPDATE campaigns SET status = 'ended', updated_at = now()
             WHERE status IN ('active', 'paused')
               AND deleted_at IS NULL
               AND ends_on < (now() AT TIME ZONE COALESCE(timezone, 'UTC'))::date
           RETURNING id`
        )) as [{ id: string }[], number];
        for (const row of rows) await markCampaignDirty(manager, row.id);
        return rows;
      }
    );
    for (const row of ended) await this.scheduler.request(row.id);
  }

  /**
   * Where a campaign stands on each of its platforms.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param campaignId - The campaign
   * @returns One entry per unit, with what exists over there and what is still to be created
   * @throws Error with status 404 when the caller cannot see the campaign
   */
  public async platformStatus(
    actor: AuthContext,
    organizationId: string,
    campaignId: string
  ): Promise<CampaignPlatformStatus> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    const campaign: CampaignEntity = await this.campaignOrFail(organizationId, campaignId);
    const tree: CampaignTree = await readCampaignTree(this.dataSource.manager, campaign);
    const units: PlatformUnitEntity[] = await this.dataSource.manager.find(PlatformUnitEntity, {
      where: { organizationId, campaignId },
      order: { platform: 'ASC', adGroupId: 'ASC' },
    });

    return {
      campaignId,
      units: units.map((unit: PlatformUnitEntity): PlatformUnitView => this.toView(tree, unit)),
      pending: units.filter((unit: PlatformUnitEntity): boolean => unit.syncState !== 'synced').length,
    };
  }

  /**
   * Ask for a campaign to be synchronized now.
   *
   * It marks the units and queues the job; it does not wait for the platforms. What it actually
   * changes is nothing, when nothing changed: the fingerprints still match and the sync makes no
   * call. The route exists for the case where something **over there** was touched by hand.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param campaignId - The campaign
   * @returns The campaign and how many units were marked
   * @throws Error with status 403 without the manager role, 404 when absent, 400 coded
   *   `sync_campaign_not_launched` for a draft
   */
  public async requestSync(actor: AuthContext, organizationId: string, campaignId: string): Promise<SyncRequested> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    const campaign: CampaignEntity = await this.campaignOrFail(organizationId, campaignId);
    if (campaign.status === 'draft') {
      throw httpError(400, 'This campaign has not been launched, so there is nothing to synchronize', {
        code: 'sync_campaign_not_launched',
      });
    }
    const units: number = await this.dataSource.transaction((manager: EntityManager) =>
      markCampaignDirty(manager, campaignId)
    );
    await this.scheduler.request(campaignId);
    return { campaignId, units };
  }

  /**
   * Try one unit again, without waiting for its backoff.
   *
   * The way back for a **definitive** failure, which is never rescheduled on its own: once what
   * caused it is fixed, this says so (`docs/phase-9.md` § 5).
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param campaignId - The campaign
   * @param unitId - The unit
   * @returns The unit, now waiting to be applied
   * @throws Error with status 403 without the manager role, 404 coded `platform_unit_not_found`
   */
  public async retry(
    actor: AuthContext,
    organizationId: string,
    campaignId: string,
    unitId: string
  ): Promise<PlatformUnitView> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    const campaign: CampaignEntity = await this.campaignOrFail(organizationId, campaignId);
    const unit: PlatformUnitEntity | null = await this.dataSource.manager.findOne(PlatformUnitEntity, {
      where: { id: unitId, organizationId, campaignId },
    });
    if (!unit) {
      throw httpError(404, 'Platform unit not found', { code: 'platform_unit_not_found' });
    }
    await this.dataSource.manager.update(
      PlatformUnitEntity,
      { id: unit.id },
      { syncState: 'pending', attempts: 0, nextAttemptAt: null }
    );
    await this.scheduler.request(campaignId);

    const tree: CampaignTree = await readCampaignTree(this.dataSource.manager, campaign);
    return this.toView(tree, { ...unit, syncState: 'pending', attempts: 0, nextAttemptAt: null });
  }

  /**
   * Apply one unit, unless there is nothing to apply or nothing to apply it with.
   *
   * The order of the guards is the economy of the engine: everything that can be decided without
   * calling anybody is decided first, and the fingerprint is compared **before** the credentials are
   * read — so a campaign nobody touched costs no call to the secret store either.
   *
   * @param tree - The campaign's tree
   * @param unit - The unit
   * @returns A promise that resolves once applied, skipped, or the failure recorded
   */
  private async syncUnit(tree: CampaignTree, unit: PlatformUnitEntity): Promise<void> {
    if (unit.syncState === 'error' && (unit.nextAttemptAt === null || unit.nextAttemptAt.getTime() > this.now()))
      return;

    const account: AdAccountEntity | undefined = tree.accountsById.get(unit.adAccountId);
    const link: AdvertiserAdAccountEntity | undefined = tree.linksByPlatform.get(unit.platform);
    const group: AdGroupEntity | undefined = tree.adGroups.find(
      (node: AdGroupEntity): boolean => node.id === unit.adGroupId
    );
    // An AdGroup that is gone, a brand no longer buying there, or an access that is broken: the
    // preview says so, and the sweep comes back once it is mended — the account's own write marks
    // these units again.
    if (!group || !account || !link || account.deletedAt !== null || account.status !== 'active') return;
    // A linked account is read at its client's acceptance: until then there is no currency to express
    // a budget in, nor a timezone to count its days in (`docs/phase-10.md` § 4.4).
    if (account.currency === null || account.timezone === null) return;
    const bought: AccountMoney = { currency: account.currency, timezone: account.timezone };

    try {
      if (!hasAdapterFor(unit.platform)) {
        throw httpError(500, `No adapter implements ${unit.platform}`, {
          code: 'sync_adapter_missing',
          params: { platform: unit.platform },
        });
      }
      const adapter: PlatformAdapter = adapterOf(unit.platform);
      // Only an account that brings its own key needs one; on a `manager_link` platform the key is
      // ours, and its adapter reads it (`docs/phase-10.md` § 4.1). Without it, there is nothing to
      // apply with yet: posting it marks the units again.
      const secretName: string | null = adapter.connection === 'account_secret' ? account.secretName : null;
      if (adapter.connection === 'account_secret' && secretName === null) return;
      // Our credentials reach every account linked to our manager account, so one that never went
      // through the link — declared by hand before the platform had its adapter — was never granted
      // by its client through us: nothing is pushed to it (`docs/phase-10.md` § 4.5).
      if (adapter.connection === 'manager_link' && account.linkRef === null) {
        throw httpError(409, `This ${unit.platform} account was declared, never linked to our manager account`, {
          code: 'sync_account_not_linked',
          params: { platform: unit.platform },
        });
      }

      const { desired, hash }: { desired: DesiredUnit; hash: string } = await this.buildDesired(
        tree,
        unit,
        group,
        bought
      );
      // Nothing changed: no call at all, which is the whole point of the fingerprint.
      if (unit.syncState === 'synced' && unit.syncedHash === hash) return;

      const context: PlatformContext = {
        platform: unit.platform,
        adAccountId: account.id,
        externalId: account.externalId,
        externalAdvertiserId: link.externalAdvertiserId,
        currency: bought.currency,
        timezone: bought.timezone,
        scope: account.scope,
        credentials: secretName === null ? null : await this.secrets.get(secretName),
      };
      const result: ApplyResult = await adapter.apply(context, desired, unit.refs);
      await this.recordSuccess(unit, desired, hash, result);
    } catch (error: unknown) {
      await this.recordFailure(unit, account, error);
    }
  }

  /**
   * What one unit must be at its platform.
   *
   * @param tree - The campaign's tree
   * @param unit - The unit
   * @param group - Its AdGroup
   * @param bought - The currency of the account it buys on, which every amount here is expressed in,
   *   and the timezone its platform counts days in
   * @returns The desired state and its fingerprint
   */
  private async buildDesired(
    tree: CampaignTree,
    unit: PlatformUnitEntity,
    group: AdGroupEntity,
    bought: AccountMoney
  ): Promise<{ desired: DesiredUnit; hash: string }> {
    const campaign: CampaignEntity = tree.campaign;
    const timezone: string = resolveCampaignTimezone(campaign.timezone, null, campaign.organizationId);
    const lever: LeverEntity = tree.levers.find(
      (node: LeverEntity): boolean => node.id === unit.leverId
    ) as LeverEntity;
    const projection: PlatformProjection = projectionOf(unit.platform, unit.lever);

    const campaignNode: Omit<DesiredNode, 'children'> = await this.nodeOf(
      tree,
      'campaign',
      campaign,
      null,
      timezone,
      projection
    );
    const leverNode: Omit<DesiredNode, 'children'> = await this.nodeOf(
      tree,
      'lever',
      lever,
      campaignNode,
      timezone,
      projection
    );
    const groupNode: Omit<DesiredNode, 'children'> = await this.nodeOf(
      tree,
      'ad_group',
      group,
      leverNode,
      timezone,
      projection
    );
    const nodes: DesiredNode[] = [];
    for (const node of targetingGroupsOf(tree, group.id)) {
      const own: Omit<DesiredNode, 'children'> = await this.nodeOf(
        tree,
        'targeting_group',
        node,
        groupNode,
        timezone,
        projection
      );
      const lines: DesiredNode[] = [];
      for (const line of linesOf(tree, node.id)) {
        lines.push({ ...(await this.nodeOf(tree, 'line', line, own, timezone, projection)), children: [] });
      }
      nodes.push({ ...own, keywords: this.keywordsOf(tree, node.id), children: lines });
    }
    const branch: DesiredNode = {
      ...campaignNode,
      children: [{ ...leverNode, children: [{ ...groupNode, children: nodes }] }],
    };

    return desiredUnit({
      unitId: unit.id,
      platform: unit.platform,
      lever: unit.lever,
      adGroupId: group.id,
      projection,
      campaign: branch,
      insertionOrderNumber: campaign.insertionOrderNumber,
      containsPoliticalAdvertising: campaign.containsPoliticalAdvertising,
      currency: bought.currency,
      timezone: bought.timezone,
      fxRate: unit.fxRate,
      live: campaign.status === 'active',
      today: dayAt(this.now(), timezone),
      minDailyBudgetCents: rulesOf(unit.platform, unit.lever).minDailyBudgetCents,
    });
  }

  /**
   * One node of the tree, with everything a platform needs from it.
   *
   * The window is **inherited in memory** from the node above rather than resolved by a query: the
   * tree is already read, and asking the database for each node's window would cost one query per node
   * of the branch — hundreds on a large AdGroup, every single sync.
   *
   * @param tree - The campaign's tree
   * @param level - Its level
   * @param node - The row
   * @param parent - The node above, already built; `null` at the campaign, which carries its own window
   * @param timezone - The timezone the campaign counts its days in
   * @param projection - What the platform makes of our levels
   * @returns The node, without its children
   */
  private async nodeOf(
    tree: CampaignTree,
    level: TreeLevel,
    node: CampaignEntity | LeverEntity | AdGroupEntity | TargetingGroupEntity | LineEntity,
    parent: Omit<DesiredNode, 'children'> | null,
    timezone: string,
    projection: PlatformProjection
  ): Promise<Omit<DesiredNode, 'children'>> {
    const row = node as unknown as {
      id: string;
      name: string;
      status: string;
      budgetCents: number | null;
      bidAmountCents?: number | null;
      bidStrategy?: BidStrategy;
      capping?: unknown;
      targeting?: unknown;
      creativeId?: string | null;
      landingPageUrl?: string | null;
      trackers?: unknown;
      startsOn: string | null;
      endsOn: string | null;
    };
    const window: { startsOn: string; endsOn: string } = {
      startsOn: row.startsOn ?? (parent?.startsOn as string),
      endsOn: row.endsOn ?? (parent?.endsOn as string),
    };
    // Only the level that holds a budget over there is asked for one: resolving a curve costs reads,
    // and a level whose object cannot carry a budget would throw the answer away.
    const creative: DesiredCreative | null = this.creativeOf(tree, row.creativeId ?? null);
    const paced: { todayCents: number; averageCents: number } | null =
      level === projection.budgetLevel
        ? await this.curves.pacedDay(this.dataSource.manager, tree.campaign.organizationId, level, row.id, timezone)
        : null;

    return {
      level,
      id: row.id,
      name: row.name,
      status: row.status === 'paused' ? 'paused' : 'active',
      startsOn: window.startsOn,
      endsOn: window.endsOn,
      budgetCents: row.budgetCents,
      dailyBudgetCents: paced?.todayCents ?? null,
      averageDailyCents: paced?.averageCents ?? null,
      bidAmountCents: row.bidAmountCents ?? null,
      bidStrategy: row.bidStrategy ?? null,
      capping: (row.capping ?? null) as DesiredNode['capping'],
      targeting: (row.targeting ?? null) as DesiredNode['targeting'],
      creative,
      // A Line's own page overrides its creative's (L18): a platform receives the one that applies.
      landingPageUrl: row.landingPageUrl ?? this.clickThroughUrlOf(tree, row.creativeId ?? null),
      trackers: (row.trackers ?? null) as DesiredNode['trackers'],
      keywords: [],
    };
  }

  /**
   * The creative a Line delivers, reduced to what a platform needs.
   *
   * It names the **version**, which is immutable (phase 6): a new version is a new fingerprint, so
   * exactly one call. A creative with no delivering version answers `null` — the preview refuses the
   * launch over it, and a campaign already live simply keeps what it had.
   *
   * @param tree - The campaign's tree
   * @param creativeId - The creative, `null` above the Line
   * @returns The creative, or `null`
   */
  private creativeOf(tree: CampaignTree, creativeId: string | null): DesiredCreative | null {
    if (creativeId === null) return null;
    const creative: CreativeEntity | undefined = tree.creatives.get(creativeId);
    const version: CreativeVersionEntity | undefined = tree.versions.get(creativeId);
    if (!creative || !version) return null;
    return {
      versionId: version.id,
      format: creative.format,
      subtype: creative.subtype,
      payload: version.payload as Readonly<Record<string, unknown>>,
      // Filled by the platform phases, which upload an asset once and keep its reference there.
      assets: {},
    };
  }

  /**
   * Where a click on a creative goes, as the creative says it.
   *
   * @param tree - The campaign's tree
   * @param creativeId - The creative, `null` above the Line
   * @returns Its click-through URL, `null` when it has none or there is no creative
   */
  private clickThroughUrlOf(tree: CampaignTree, creativeId: string | null): string | null {
    return creativeId === null ? null : (tree.creatives.get(creativeId)?.clickThroughUrl ?? null);
  }

  /**
   * The keywords of a TargetingGroup, in a stable order.
   *
   * Sorted, because the fingerprint is taken of the whole state: two reads that returned the same
   * keywords in another order would otherwise look like a change and cost a call.
   *
   * @param tree - The campaign's tree
   * @param targetingGroupId - The node
   * @returns Its keywords, positive and negative
   */
  private keywordsOf(tree: CampaignTree, targetingGroupId: string): DesiredKeyword[] {
    return [...(tree.keywords.get(targetingGroupId) ?? []), ...(tree.negativeKeywords.get(targetingGroupId) ?? [])]
      .map((keyword: KeywordEntity): DesiredKeyword => ({
        id: keyword.id,
        text: keyword.text,
        matchType: keyword.matchType,
        negative: keyword.negative,
      }))
      .sort((left: DesiredKeyword, right: DesiredKeyword): number => left.id.localeCompare(right.id));
  }

  /**
   * Record a unit the platform now matches.
   *
   * The state stays `pending` when the platform did not take the status asked for: a platform that
   * reviews before activating leaves the unit waiting, and the next sweep asks again. The
   * fingerprint is written all the same, so that wait costs no further call until something changes.
   *
   * @param unit - The unit
   * @param desired - What it had to be
   * @param hash - The fingerprint of that state
   * @param result - What the adapter says exists now
   * @returns A promise that resolves once recorded
   */
  private async recordSuccess(
    unit: PlatformUnitEntity,
    desired: DesiredUnit,
    hash: string,
    result: ApplyResult
  ): Promise<void> {
    const applied: boolean = result.appliedStatus === desired.status;
    const now: Date = new Date(this.now());
    await this.dataSource.transaction(async (manager: EntityManager): Promise<void> => {
      await this.recordIdChanges(manager, unit, desired, result.refs);
      await manager.update(
        PlatformUnitEntity,
        { id: unit.id },
        {
          refs: result.refs,
          appliedStatus: result.appliedStatus,
          syncedHash: hash,
          syncState: applied ? 'synced' : 'pending',
          lastError: null,
          lastErrorCode: null,
          lastErrorParams: null,
          attempts: 0,
          nextAttemptAt: null,
          lastAttemptAt: now,
          lastSyncedAt: now,
        }
      );
    });
  }

  /**
   * Keep the trail of every platform id that **changed**.
   *
   * A first materialisation — no id, then an id — is not a change and writes nothing (R5,
   * `../../CADRAGE.md` § 7). What writes rows is an object being recreated, which is what the
   * restructuring of phase 14 does: the reports of the days before still carry the old id, and this
   * is how they find our node again.
   *
   * @param manager - The transaction
   * @param unit - The unit
   * @param desired - What it had to be, which names each object's level and node
   * @param refs - The ids as they now stand
   * @returns A promise that resolves once the rows are written
   */
  private async recordIdChanges(
    manager: EntityManager,
    unit: PlatformUnitEntity,
    desired: DesiredUnit,
    refs: Record<string, string>
  ): Promise<void> {
    const rows: Partial<ExternalIdHistoryEntity>[] = [];
    for (const object of desired.objects) {
      const before: string | undefined = unit.refs[object.key];
      const after: string | undefined = refs[object.key];
      if (before === undefined || after === undefined || before === after) continue;
      rows.push({
        organizationId: unit.organizationId,
        platformUnitId: unit.id,
        platform: unit.platform,
        level: object.level,
        nodeId: object.keywordId === null ? object.nodeId : null,
        refKey: object.key,
        previousExternalId: before,
        externalId: after,
      });
    }
    if (rows.length > 0) await manager.insert(ExternalIdHistoryEntity, rows);
  }

  /**
   * Record a failed attempt, and decide whether anything will try again on its own.
   *
   * - **temporary** — a rate limit, a 5xx, no response: the delay doubles with each failure up to the
   *   configured ceiling, and the sweep comes back;
   * - **definitive** — anything else, and **every error of ours** (a missing secret, a platform with
   *   no adapter): no next attempt is scheduled at all. Retrying cannot help, so the unit waits for a
   *   modification, which clears the backoff, or for an explicit retry;
   * - **a refused key** invalidates the account, which stops every unit of that account rather than
   *   this one — the preview names it, and an admin has to act;
   * - **our own credentials failing** (`ownCredentials`) is none of the client's doing: the account is
   *   left alone, the unit keeps trying with the same backoff — so everything resumes on its own once
   *   an operator mends them — and the log says so at `error` (`docs/phase-10.md` § 4.2).
   *
   * @param unit - The unit
   * @param account - Its account
   * @param error - What was thrown
   * @returns A promise that resolves once recorded
   */
  private async recordFailure(unit: PlatformUnitEntity, account: AdAccountEntity, error: unknown): Promise<void> {
    const platformError: PlatformError | null = error instanceof PlatformError ? error : null;
    const ours: boolean = platformError?.options.ownCredentials === true;
    const retryable: boolean = ours || (platformError?.options.retryable ?? false);
    const coded: { code: string; params: MessageParams } | undefined = ours
      ? { code: 'sync_platform_credentials_failed', params: { platform: unit.platform } }
      : platformError
        ? platformError.options.messageCode
          ? { code: platformError.options.messageCode, params: platformError.options.messageParams ?? {} }
          : undefined
        : errorCodeOf(error);
    const attempts: number = unit.attempts + 1;
    const now: Date = new Date(this.now());
    const delayMinutes: number = Math.min(this.config.maxBackoffMinutes, 2 ** (attempts - 1));
    if (ours) {
      this.logger.error('Our own credentials failed on a platform: an operator must mend them', {
        unitId: unit.id,
        platform: unit.platform,
        error,
      });
    } else {
      this.logger.warn('A platform sync failed', { unitId: unit.id, platform: unit.platform, retryable, error });
    }

    await this.dataSource.transaction(async (manager: EntityManager): Promise<void> => {
      if (platformError?.options.invalidCredentials && !ours) {
        await manager.update(
          AdAccountEntity,
          { id: account.id },
          { status: 'invalid', statusReason: 'credentials_rejected' }
        );
      }
      await manager.update(
        PlatformUnitEntity,
        { id: unit.id },
        {
          syncState: 'error',
          lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
          lastErrorCode: coded?.code ?? null,
          lastErrorParams: coded?.params ?? null,
          attempts,
          nextAttemptAt: retryable ? new Date(now.getTime() + delayMinutes * MINUTE_IN_MS) : null,
          lastAttemptAt: now,
        }
      );
    });
  }

  /**
   * When a campaign's day must be recomputed next: its **next local midnight**, plus a jitter (D47).
   *
   * The jitter is what stops every campaign of one timezone from recomputing in the same second — the
   * thundering herd a single UTC schedule would create, moved to each zone.
   *
   * @param timezone - The campaign's own timezone, stamped at the launch
   * @returns The instant of that appointment
   */
  private nextPacingAt(timezone: string | null): Date {
    const zone: string = resolveCampaignTimezone(timezone, null, '');
    const midnight: Date = nextLocalMidnight(this.now(), zone);
    return new Date(midnight.getTime() + Math.floor(this.random() * this.config.pacingJitterMinutes) * MINUTE_IN_MS);
  }

  /**
   * One unit, as the API returns it.
   *
   * The objects are **projected**, not read from the map: what the campaign is now says what must
   * exist over there, and the recorded ids say what already does. An object with no id yet is
   * therefore visible as something still to create, which is exactly the question the route answers.
   *
   * The whole branch is projected, campaign included, because a platform that makes something of our
   * campaign — a mediaplan — holds it as this unit's ancestor over there, and hiding it would hide an
   * object whose id the unit carries.
   *
   * @param tree - The campaign's tree
   * @param unit - The unit
   * @returns Its API shape
   */
  private toView(tree: CampaignTree, unit: PlatformUnitEntity): PlatformUnitView {
    const group: AdGroupEntity | undefined = tree.adGroups.find(
      (node: AdGroupEntity): boolean => node.id === unit.adGroupId
    );
    const lever: LeverEntity | undefined = tree.levers.find((node: LeverEntity): boolean => node.id === unit.leverId);
    const projected: ProjectedObject[] =
      group && lever && hasAdapter(unit.platform, unit.lever)
        ? projectObjects(projectionOf(unit.platform, unit.lever), branchStructure(tree, lever, group))
        : [];

    return {
      id: unit.id,
      platform: unit.platform,
      lever: unit.lever,
      adGroupId: unit.adGroupId,
      adAccountId: unit.adAccountId,
      currency: tree.accountsById.get(unit.adAccountId)?.currency ?? tree.campaign.currency,
      fxRate: unit.fxRate,
      state: unit.syncState,
      objects: projected.map((object: ProjectedObject): PlatformObjectRef => ({
        key: object.key,
        level: object.level,
        nodeId: object.nodeId,
        keywordId: object.keywordId,
        object: object.object,
        externalId: unit.refs[object.key] ?? null,
      })),
      attempts: unit.attempts,
      nextAttemptAt: unit.nextAttemptAt?.toISOString() ?? null,
      lastAttemptAt: unit.lastAttemptAt?.toISOString() ?? null,
      lastSyncedAt: unit.lastSyncedAt?.toISOString() ?? null,
      errorCode: unit.lastErrorCode,
      errorParams: unit.lastErrorParams,
      errorMessage: unit.lastError,
    };
  }

  /**
   * The campaign, or a 404 the caller cannot tell from « it does not exist ».
   *
   * @param organizationId - The Organization
   * @param id - The campaign
   * @returns The row
   * @throws Error with status 404 coded `campaign_not_found`
   */
  private async campaignOrFail(organizationId: string, id: string): Promise<CampaignEntity> {
    const campaign: CampaignEntity | null = await this.dataSource.manager.findOne(CampaignEntity, {
      where: { id, organizationId, deletedAt: IsNull() },
    });
    if (!campaign) throw httpError(404, 'Campaign not found', { code: 'campaign_not_found' });
    return campaign;
  }

  /**
   * Run a task under a PostgreSQL advisory lock, or skip it when another process holds it (D46).
   *
   * Skipping rather than waiting is deliberate: the other worker is doing the same work from the same
   * database, and anything it leaves behind is still marked for the sweep. Waiting would only tie up
   * a worker to do nothing twice.
   *
   * @param key - Name of the lock
   * @param task - What to run while holding it
   * @returns A promise that resolves once the task ran, or was skipped
   */
  private async withLock(key: string, task: () => Promise<void>): Promise<void> {
    const runner: QueryRunner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const [{ locked }]: { locked: boolean }[] = await runner.query(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
        [key]
      );
      if (!locked) return;
      try {
        await task();
      } finally {
        await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
      }
    } finally {
      await runner.release();
    }
  }
}

/**
 * Queues campaign syncs on the job queue.
 */
export class JobQueueSyncScheduler implements SyncScheduler {
  /**
   * @param send - Enqueues a job
   */
  constructor(private readonly send: (name: string, data: object) => Promise<unknown>) {}

  /** @inheritdoc */
  public async request(campaignId: string): Promise<void> {
    await this.send('sync.campaign', { campaignId });
  }
}

/**
 * Fastify plugin that decorates the instance with a {@link SyncService} and its scheduler.
 *
 * Depends on `DatabasePlugin`, `AccessServicePlugin`, `BudgetCurveServicePlugin`, `SecretStorePlugin`
 * and `JobQueuePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 * @returns A promise that resolves once decorated
 */
async function syncServicePlugin(fastify: FastifyInstance): Promise<void> {
  const scheduler: SyncScheduler = new JobQueueSyncScheduler((name: string, data: object): Promise<unknown> =>
    fastify.jobQueue.send(name, data)
  );
  fastify.decorate('syncScheduler', scheduler);
  fastify.decorate(
    'syncService',
    new SyncService(fastify.db, fastify.accessService, fastify.budgetCurveService, fastify.secretStore, scheduler)
  );
}

export default fastifyPlugin(syncServicePlugin, {
  name: 'SyncServicePlugin',
  dependencies: [
    'DatabasePlugin',
    'AccessServicePlugin',
    'BudgetCurveServicePlugin',
    'SecretStorePlugin',
    'JobQueuePlugin',
  ],
});
