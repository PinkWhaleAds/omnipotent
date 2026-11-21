import { randomBytes } from 'node:crypto';

import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';

import { trackingConfig } from '@configs';
import {
  AdAccountEntity,
  AdvertiserAdAccountEntity,
  AdvertiserEntity,
  AdvertiserTrackingEntity,
  ConversionGoalEntity,
  ConversionGoalRefEntity,
} from '@src/database/entities';
import { fingerprint } from '@src/platforms/desired-state';
import {
  AccountContext,
  adapterOf,
  GoalSpec,
  hasAdapterFor,
  PlatformAdapter,
  PlatformError,
  setupMessage,
  TrackingRefs,
  TrackingSetup,
} from '@src/platforms/platform-adapter';
import type { LoaderConfig, LoaderGoal } from '@src/tracking/loader-config';
import { TRACKING_PLATFORMS } from '@src/tracking/tracking-platforms';
import {
  AdvertiserTracking,
  AuthContext,
  Platform,
  platformSchema,
  TRACKING_KEY_PATTERN,
  TrackingRefStatus,
} from '@src/types';
import { httpError, Logger, LoggerBuilder } from '@utils';
import { AccessService } from './access.service';
import type { TrackingScheduler } from './conversion-goal.service';
import { withTryLock } from './lock.helpers';
import { SecretStore } from './secret-store.service';
import { markGoalDirty } from './sync.helpers';

/** Name of the job that sets the tracking of one Advertiser up on its accounts. */
export const CONVERSION_SETUP_JOB_NAME = 'conversion.setup';

/** Statuses after which a goal whose fingerprint did not change is left alone. */
const SETTLED_STATUSES: readonly TrackingRefStatus[] = ['ready', 'paused'];

/** Statuses of an object that waits for a setup: the sweep queues its Advertiser again. */
const WAITING_STATUSES: readonly TrackingRefStatus[] = ['pending', 'failed', 'manual_required'];

/** How often the last load of a script is recorded at most, in seconds (an hour). */
const SCRIPT_SEEN_INTERVAL_SECONDS = 3_600;

/** Micros in one cent. */
const MICROS_PER_CENT = 10_000;

/**
 * Record that a site loaded its script, unless it was recorded less than an hour ago: one conditional
 * UPDATE, so that replicas serving the script at once write it once. `updated_at` is left alone: the
 * Advertiser itself did not change.
 */
const MARK_SCRIPT_SEEN_SQL =
  'UPDATE advertisers SET script_seen_at = now() ' +
  "WHERE id = $1 AND (script_seen_at IS NULL OR script_seen_at < now() - $2 * interval '1 second')";

/**
 * The Advertisers whose tracking waits for a setup, among those with a goal: a tracking code or a goal
 * not settled on an account, a goal changed since its setup on an account, a goal never set up on an
 * account whose tracking is ready, or an active account of theirs with no tracking code yet. What the
 * sweep queues: the work waiting, never the fleet (`src/jobs/index.ts`). An account whose platform
 * cannot set tracking up waits for no setup: `$2` is its code.
 */
const WAITING_ADVERTISERS_SQL = `SELECT DISTINCT g."advertiser_id" AS "advertiserId"
FROM "conversion_goals" g
JOIN "advertisers" a ON a."id" = g."advertiser_id" AND a."deleted_at" IS NULL
WHERE EXISTS (SELECT 1 FROM "advertiser_trackings" t
    WHERE t."advertiser_id" = g."advertiser_id" AND t."status" = ANY($1::varchar[])
      AND t."message_code" IS DISTINCT FROM $2)
  OR EXISTS (SELECT 1 FROM "conversion_goal_refs" r
    WHERE r."goal_id" = g."id" AND (r."status" = ANY($1::varchar[]) OR r."updated_at" < g."updated_at"))
  OR EXISTS (SELECT 1 FROM "advertiser_trackings" t
    WHERE t."advertiser_id" = g."advertiser_id" AND t."status" = 'ready'
      AND NOT EXISTS (SELECT 1 FROM "conversion_goal_refs" r
        WHERE r."goal_id" = g."id" AND r."ad_account_id" = t."ad_account_id"))
  OR EXISTS (SELECT 1 FROM "advertiser_ad_accounts" l
    JOIN "ad_accounts" acc ON acc."id" = l."ad_account_id" AND acc."deleted_at" IS NULL AND acc."status" = 'active'
    WHERE l."advertiser_id" = g."advertiser_id" AND l."deleted_at" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "advertiser_trackings" t
        WHERE t."advertiser_id" = l."advertiser_id" AND t."ad_account_id" = acc."id"))`;

/** Where the tracking of an account stands when its platform cannot set it up yet. */
const NOT_SUPPORTED: Omit<TrackingSetup, 'messageParams'> = {
  status: 'manual_required',
  refs: {},
  message: 'Conversion tracking is not supported yet on this platform',
  messageCode: 'tracking_not_supported',
  biddable: false,
};

/** Where the tracking of an account stands before its first setup reached the platform. */
const NOT_SET_UP: TrackingSetup = { status: 'pending', refs: {}, message: null, biddable: false };

/**
 * Whether two sets of ids at a platform are the same, whatever the order of their keys (the database
 * keeps its own order).
 *
 * @param left - One set
 * @param right - The other
 * @returns `true` when every key holds the same id in both
 */
function sameRefs(left: TrackingRefs, right: TrackingRefs): boolean {
  const keys = new Set<string>([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key: string): boolean => (left[key] ?? null) === (right[key] ?? null));
}

/**
 * Whether a platform refused a tracking object for a reason that trying again will not fix soon: the
 * object is then `failed` with the platform's message. A rate limit, an outage, a refused key or our
 * own credentials failing are not: the object is left as it was, and the sweep tries again.
 *
 * @param error - What the adapter threw
 * @returns `true` for such a refusal
 */
function isRefusal(error: unknown): error is PlatformError {
  return (
    error instanceof PlatformError &&
    !error.options.retryable &&
    !error.options.invalidCredentials &&
    !error.options.ownCredentials
  );
}

/**
 * Where a tracking code or a goal stands once its platform refused it: `failed`, with the refusal's
 * message, and its code and values where we worded it.
 *
 * @param error - The refusal
 * @param refs - Its ids at the platform, kept
 * @returns The setup, `failed`
 */
function refusedSetup(error: PlatformError, refs: TrackingRefs): TrackingSetup {
  return {
    status: 'failed',
    refs,
    message: error.message,
    messageCode: error.options.messageCode ?? null,
    messageParams: error.options.messageParams ?? null,
    biddable: false,
  };
}

/**
 * The goals of an Advertiser as a platform sets them up: its name and the goal's, the value in micros.
 *
 * @param advertiserName - Name of the Advertiser
 * @param goals - Its goals, oldest first
 * @returns One spec per goal, in the same order
 */
export function goalSpecs(advertiserName: string, goals: readonly ConversionGoalEntity[]): GoalSpec[] {
  return goals.map((goal: ConversionGoalEntity): GoalSpec => ({
    id: goal.id,
    key: goal.key,
    name: `${advertiserName} — ${goal.name}`,
    category: goal.category,
    valueMode: goal.valueMode,
    defaultValueMicros: goal.defaultValueCents === null ? null : goal.defaultValueCents * MICROS_PER_CENT,
    currency: goal.currency,
    counting: goal.counting,
    status: goal.status,
  }));
}

/**
 * The code a client pastes in the `<head>` of every page: a queue collecting the `msq(…)` calls made
 * before the script loads, the script itself, and the consent call to make once the visitor accepts
 * (nothing is loaded nor sent before).
 *
 * @param scriptUrl - The Advertiser's script
 * @returns The HTML snippet
 */
export function trackingSnippet(scriptUrl: string): string {
  return [
    '<script>',
    '  (function (w, d, s, u) {',
    '    w.msq = w.msq || function () { (w.msq.q = w.msq.q || []).push(arguments); };',
    '    var j = d.createElement(s);',
    '    j.async = 1;',
    '    j.src = u;',
    '    d.head.appendChild(j);',
    `  })(window, document, 'script', '${scriptUrl}');`,
    "  // Once the visitor accepts advertising cookies (from your consent banner): msq('consent', { ads: 'granted' });",
    '</script>',
  ].join('\n');
}

/**
 * Gives an Advertiser its tracking script and sets its conversion goals up on its ad accounts (D58,
 * `docs/phase-10.md` § 8.10). Transcribed from multi-search.
 *
 * Viewers read the code to install and where each goal stands. The `conversion.setup` job — asked on
 * every goal change, every account linked to the Advertiser or activated, and by the sweep — finds or
 * creates, at each platform, the tracking code of the Advertiser and each goal; the public script
 * `/t/<key>.js` is built from what is ready.
 */
export class TrackingService {
  /** @internal Logger scoped to this class. */
  private readonly logger: Logger = LoggerBuilder.getChildLogger('TrackingService');

  /**
   * Create the service.
   *
   * @param dataSource - Application database
   * @param access - Permission checks
   * @param secrets - Where the credentials of an account bringing its own are read
   * @param scheduler - Queues setups
   * @param scriptBaseUrl - Where the tracking scripts are served, without trailing slash
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: AccessService,
    private readonly secrets: SecretStore,
    private readonly scheduler: TrackingScheduler,
    private readonly scriptBaseUrl: string = trackingConfig.scriptBaseUrl
  ) {}

  /**
   * The tracking of an Advertiser: the code to install, the domains its site must allow, when its site
   * last loaded the script, and, per account it uses, where its tracking code and each goal stand. The
   * first call gives the Advertiser its public key.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param advertiserId - The Advertiser
   * @returns Its tracking
   * @throws Error with status 404 coded `advertiser_not_found`
   */
  public async get(actor: AuthContext, organizationId: string, advertiserId: string): Promise<AdvertiserTracking> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    const advertiser: AdvertiserEntity | null = await this.dataSource
      .getRepository(AdvertiserEntity)
      .findOneBy({ id: advertiserId, organizationId });
    if (!advertiser) throw httpError(404, 'Advertiser not found', { code: 'advertiser_not_found' });
    const scriptUrl = `${this.scriptBaseUrl}/t/${await this.trackingKeyOf(advertiser)}.js`;

    const accounts: AdAccountEntity[] = await this.accountsOf(advertiserId);
    const goals: ConversionGoalEntity[] = await this.goalsOf(advertiserId);
    const trackings: AdvertiserTrackingEntity[] = await this.dataSource
      .getRepository(AdvertiserTrackingEntity)
      .findBy({ advertiserId });
    const refs: Map<string, ConversionGoalRefEntity> = await this.refsOf(goals);

    return {
      advertiserId,
      snippet: trackingSnippet(scriptUrl),
      scriptUrl,
      cspDomains: this.cspDomains(accounts),
      lastSeenAt: advertiser.scriptSeenAt?.toISOString() ?? null,
      platforms: accounts.map((account: AdAccountEntity): AdvertiserTracking['platforms'][number] => {
        const tracking: AdvertiserTrackingEntity | undefined = trackings.find(
          (row: AdvertiserTrackingEntity): boolean => row.adAccountId === account.id
        );
        return {
          platform: account.platform,
          adAccountId: account.id,
          adAccountName: account.name,
          status: tracking?.status ?? 'pending',
          message: tracking?.message ?? null,
          messageCode: tracking?.messageCode ?? null,
          messageParams: tracking?.messageParams ?? null,
          goals: goals.map((goal: ConversionGoalEntity): AdvertiserTracking['platforms'][number]['goals'][number] => {
            const ref: ConversionGoalRefEntity | undefined = refs.get(`${goal.id}|${account.id}`);
            return {
              goalId: goal.id,
              key: goal.key,
              status: ref?.status ?? 'pending',
              message: ref?.message ?? null,
              messageCode: ref?.messageCode ?? null,
              messageParams: ref?.messageParams ?? null,
              biddable: ref?.biddable ?? false,
            };
          }),
        };
      }),
    };
  }

  /**
   * What the tracking script of an Advertiser loads and fires, from its public key: the tags of its
   * ready trackings on the accounts it uses, and, for each active goal, how each platform where it is
   * ready fires it. Records, without waiting, that the site loaded its script.
   *
   * @param trackingKey - The public key, from the script's URL
   * @returns The configuration, `null` for an unknown key
   */
  public async loaderConfig(trackingKey: string): Promise<LoaderConfig | null> {
    if (!TRACKING_KEY_PATTERN.test(trackingKey)) return null;
    const advertiser: AdvertiserEntity | null = await this.dataSource
      .getRepository(AdvertiserEntity)
      .findOneBy({ trackingKey });
    if (!advertiser) return null;
    // Not awaited: recording the visit never delays nor fails the script.
    void this.markScriptSeen(advertiser);

    const linked = new Set<string>(
      (await this.accountsOf(advertiser.id)).map((account: AdAccountEntity): string => account.id)
    );
    const trackings: AdvertiserTrackingEntity[] = (
      await this.dataSource
        .getRepository(AdvertiserTrackingEntity)
        .findBy({ advertiserId: advertiser.id, status: 'ready' })
    ).filter((tracking: AdvertiserTrackingEntity): boolean => linked.has(tracking.adAccountId));
    const goals: ConversionGoalEntity[] = await this.dataSource
      .getRepository(ConversionGoalEntity)
      .find({ where: { advertiserId: advertiser.id, status: 'active' }, order: { createdAt: 'ASC', id: 'ASC' } });
    const refs: ConversionGoalRefEntity[] =
      goals.length === 0
        ? []
        : await this.dataSource.getRepository(ConversionGoalRefEntity).findBy({
            goalId: In(goals.map((goal: ConversionGoalEntity): string => goal.id)),
            status: 'ready',
          });

    const config: LoaderConfig = { googleTagIds: [], goals: {} };
    for (const tracking of trackings) TRACKING_PLATFORMS[tracking.platform]?.addTag(config, tracking.refs);
    for (const goal of goals) {
      const entry: LoaderGoal = {
        category: goal.category,
        valueMode: goal.valueMode,
        defaultValue: goal.defaultValueCents === null ? null : goal.defaultValueCents / 100,
        currency: goal.currency,
        google: [],
      };
      for (const ref of refs) {
        const tracking: AdvertiserTrackingEntity | undefined = trackings.find(
          (row: AdvertiserTrackingEntity): boolean => row.adAccountId === ref.adAccountId
        );
        if (ref.goalId === goal.id && tracking) {
          TRACKING_PLATFORMS[ref.platform]?.addGoal(config, entry, tracking.refs, ref.refs);
        }
      }
      config.goals[goal.key] = entry;
    }
    return config;
  }

  /**
   * Set the tracking code and the goals of an Advertiser up on each active account it uses: the
   * `conversion.setup` job, under a lock per Advertiser — a setup already running skips this one, and
   * the sweep catches up.
   *
   * Per account, the adapter finds or creates the tracking code, then, once it is ready, each goal
   * (archived ones are left, `paused`), skipping a goal unchanged since it was settled. A refusal of the
   * platform makes the object `failed` with its message; a refused key makes the account `invalid`; a
   * transient failure or one of our own credentials leaves everything as it was until the sweep. One
   * account's failure never stops the others. A goal whose state changes on an account marks the units
   * of the AdGroups that optimize it there.
   *
   * @param advertiserId - The Advertiser
   * @returns A promise that resolves once every account is done
   */
  public async setup(advertiserId: string): Promise<void> {
    await withTryLock(this.dataSource, `conversion:${advertiserId}`, async (): Promise<void> => {
      const advertiser: AdvertiserEntity | null = await this.dataSource
        .getRepository(AdvertiserEntity)
        .findOneBy({ id: advertiserId });
      if (!advertiser) return;
      const accounts: AdAccountEntity[] = (await this.accountsOf(advertiserId)).filter(
        (account: AdAccountEntity): boolean => account.status === 'active'
      );
      if (accounts.length === 0) return;
      const goals: ConversionGoalEntity[] = await this.goalsOf(advertiserId);
      const trackings: AdvertiserTrackingEntity[] = await this.dataSource
        .getRepository(AdvertiserTrackingEntity)
        .findBy({ advertiserId });
      const refs: Map<string, ConversionGoalRefEntity> = await this.refsOf(goals);

      for (const account of accounts) {
        const tracking: AdvertiserTrackingEntity | null =
          trackings.find((row: AdvertiserTrackingEntity): boolean => row.adAccountId === account.id) ?? null;
        try {
          await this.setupAccount(advertiser, account, goals, tracking, refs);
        } catch (error: unknown) {
          await this.failAccount(account, error);
        }
      }
    });
  }

  /**
   * Ask for a setup of every Advertiser whose tracking waits for one (see {@link WAITING_ADVERTISERS_SQL}):
   * the `conversion.sweep` job, which tries again what failed, what waits for someone, and what a
   * transient failure left behind.
   *
   * @returns A promise that resolves once every setup is queued
   */
  public async sweep(): Promise<void> {
    const rows: { advertiserId: string }[] = await this.dataSource.query(WAITING_ADVERTISERS_SQL, [
      WAITING_STATUSES,
      NOT_SUPPORTED.messageCode,
    ]);
    for (const row of rows) await this.scheduler.request(row.advertiserId);
  }

  /**
   * Set the tracking code and the goals of an Advertiser up on one account, see {@link setup}.
   *
   * @param advertiser - The Advertiser
   * @param account - The account, active
   * @param goals - The Advertiser's goals, oldest first
   * @param tracking - Its tracking on the account, `null` the first time
   * @param refs - Its goals' refs, by `<goalId>|<adAccountId>`
   * @returns A promise that resolves once the account is done
   * @throws PlatformError when the account must be retried later or its key was refused
   */
  private async setupAccount(
    advertiser: AdvertiserEntity,
    account: AdAccountEntity,
    goals: readonly ConversionGoalEntity[],
    tracking: AdvertiserTrackingEntity | null,
    refs: Map<string, ConversionGoalRefEntity>
  ): Promise<void> {
    const adapter: PlatformAdapter | null = hasAdapterFor(account.platform) ? adapterOf(account.platform) : null;
    const setupTracking = adapter?.setupTracking;
    const setupGoal = adapter?.setupGoal;
    if (!adapter || !setupTracking || !setupGoal) {
      await this.saveTracking(advertiser.id, account, tracking, {
        ...NOT_SUPPORTED,
        messageParams: { platform: account.platform },
      });
      return;
    }
    // Only an account that brings its own key needs one; without it, there is nothing to set up with yet.
    if (adapter.connection === 'account_secret' && account.secretName === null) return;
    // A first setup leaves a row behind even when the platform fails, so that the sweep finds it again.
    const current: AdvertiserTrackingEntity =
      tracking ?? (await this.saveTracking(advertiser.id, account, null, { ...NOT_SET_UP }));
    const context: AccountContext = {
      platform: account.platform,
      adAccountId: account.id,
      externalId: account.externalId,
      scope: account.scope,
      credentials:
        adapter.connection === 'account_secret' ? await this.secrets.get(account.secretName as string) : null,
    };

    const setup: TrackingSetup = await this.attempt(current.refs, () =>
      setupTracking.call(
        adapter,
        context,
        { id: advertiser.id, name: advertiser.name, websiteUrl: advertiser.websiteUrl },
        tracking?.refs ?? null
      )
    );
    const saved: AdvertiserTrackingEntity = await this.saveTracking(advertiser.id, account, current, setup);
    if (saved.status !== 'ready') return;

    for (const spec of goalSpecs(advertiser.name, goals)) {
      const existing: ConversionGoalRefEntity | null = refs.get(`${spec.id}|${account.id}`) ?? null;
      const hash: string = fingerprint({ spec, tracking: saved.refs });
      if (existing && existing.syncedHash === hash && SETTLED_STATUSES.includes(existing.status)) continue;
      const goal: TrackingSetup = await this.attempt(existing?.refs ?? {}, () =>
        setupGoal.call(adapter, context, spec, saved.refs, existing?.refs ?? null)
      );
      await this.saveGoalRef(spec.id, account, existing, goal, hash);
    }
  }

  /**
   * Call an adapter, turning a refusal of the platform into a `failed` object.
   *
   * @param existing - The object's ids recorded at the last setup, kept when it fails
   * @param call - The call
   * @returns What the adapter returned, or the failure
   * @throws PlatformError when the account must be retried later or its key was refused
   */
  private async attempt(existing: TrackingRefs, call: () => Promise<TrackingSetup>): Promise<TrackingSetup> {
    try {
      return await call();
    } catch (error: unknown) {
      if (!isRefusal(error)) throw error;
      return refusedSetup(error, existing);
    }
  }

  /**
   * What a setup that could not go on leaves: a refused key makes the account `invalid`, anything else
   * is logged, and the sweep tries again.
   *
   * @param account - The account
   * @param error - What was thrown
   * @returns A promise that resolves once recorded
   */
  private async failAccount(account: AdAccountEntity, error: unknown): Promise<void> {
    const refused: boolean =
      error instanceof PlatformError && error.options.invalidCredentials && error.options.ownCredentials !== true;
    if (refused) {
      await this.dataSource.manager.update(
        AdAccountEntity,
        { id: account.id },
        { status: 'invalid', statusReason: 'credentials_rejected' }
      );
    }
    this.logger.warn('Setting the conversion tracking up failed: the sweep tries again', {
      adAccountId: account.id,
      platform: account.platform,
      error,
    });
  }

  /**
   * Record the tracking of an Advertiser on an account, its message with its code (cleared with it).
   *
   * @param advertiserId - The Advertiser
   * @param account - The account
   * @param current - The row, `null` the first time
   * @param setup - Where it stands
   * @returns The row saved
   */
  private async saveTracking(
    advertiserId: string,
    account: AdAccountEntity,
    current: AdvertiserTrackingEntity | null,
    setup: TrackingSetup
  ): Promise<AdvertiserTrackingEntity> {
    const repository = this.dataSource.getRepository(AdvertiserTrackingEntity);
    return repository.save(
      Object.assign(
        current ?? repository.create({ advertiserId, adAccountId: account.id, platform: account.platform }),
        { status: setup.status, refs: setup.refs, ...setupMessage(setup) }
      )
    );
  }

  /**
   * Record a goal on an account, its message with its code (cleared with it). A goal whose status or
   * ids change there marks the units of the AdGroups that optimize it, in the same transaction.
   *
   * @param goalId - The goal
   * @param account - The account
   * @param current - The row, `null` the first time
   * @param setup - Where it stands
   * @param hash - Fingerprint of the goal and tracking sent
   * @returns A promise that resolves once saved
   */
  private async saveGoalRef(
    goalId: string,
    account: AdAccountEntity,
    current: ConversionGoalRefEntity | null,
    setup: TrackingSetup,
    hash: string
  ): Promise<void> {
    const changed: boolean = current === null || current.status !== setup.status || !sameRefs(current.refs, setup.refs);
    await this.dataSource.transaction(async (manager: EntityManager): Promise<void> => {
      const repository = manager.getRepository(ConversionGoalRefEntity);
      await repository.save(
        Object.assign(current ?? repository.create({ goalId, adAccountId: account.id, platform: account.platform }), {
          status: setup.status,
          refs: setup.refs,
          ...setupMessage(setup),
          biddable: setup.biddable,
          syncedHash: hash,
        })
      );
      if (changed) await markGoalDirty(manager, goalId, account.id);
    });
  }

  /**
   * Record that the site of an Advertiser loaded its script (`script_seen_at`), at most once an hour.
   * A failure is logged and otherwise ignored.
   *
   * @param advertiser - The Advertiser, as just read
   * @returns A promise that resolves once recorded, skipped or failed; it never rejects
   */
  private async markScriptSeen(advertiser: AdvertiserEntity): Promise<void> {
    const seenAt: number | undefined = advertiser.scriptSeenAt?.getTime();
    if (seenAt !== undefined && Date.now() - seenAt < SCRIPT_SEEN_INTERVAL_SECONDS * 1_000) return;
    try {
      await this.dataSource.query(MARK_SCRIPT_SEEN_SQL, [advertiser.id, SCRIPT_SEEN_INTERVAL_SECONDS]);
    } catch (error: unknown) {
      this.logger.warn('Could not record that the tracking script was loaded', { advertiserId: advertiser.id, error });
    }
  }

  /**
   * The public key of an Advertiser's script, given on first use: 24 random URL-safe characters.
   *
   * @param advertiser - The Advertiser
   * @returns Its key
   */
  private async trackingKeyOf(advertiser: AdvertiserEntity): Promise<string> {
    if (advertiser.trackingKey) return advertiser.trackingKey;
    const repository = this.dataSource.getRepository(AdvertiserEntity);
    const key: string = randomBytes(18).toString('base64url');
    const { affected } = await repository.update({ id: advertiser.id, trackingKey: IsNull() }, { trackingKey: key });
    if (affected) return key;
    // Another request gave it one in the meantime.
    const stored: AdvertiserEntity | null = await repository.findOneBy({ id: advertiser.id });
    return (stored as AdvertiserEntity).trackingKey as string;
  }

  /**
   * The domains the site of an Advertiser must allow: ours, then those of each platform it uses.
   *
   * @param accounts - The accounts it uses
   * @returns The domains, without duplicates
   */
  private cspDomains(accounts: readonly AdAccountEntity[]): string[] {
    const used = new Set<Platform>(accounts.map((account: AdAccountEntity): Platform => account.platform));
    return [
      new URL(this.scriptBaseUrl).host,
      ...platformSchema.options
        .filter((platform: Platform): boolean => used.has(platform))
        .flatMap((platform: Platform): readonly string[] => TRACKING_PLATFORMS[platform]?.cspDomains ?? []),
    ];
  }

  /**
   * The accounts an Advertiser is linked to, live links of live accounts, by platform and currency.
   *
   * @param advertiserId - The Advertiser
   * @returns Its accounts, in the order of their links
   */
  private async accountsOf(advertiserId: string): Promise<AdAccountEntity[]> {
    const links: AdvertiserAdAccountEntity[] = await this.dataSource
      .getRepository(AdvertiserAdAccountEntity)
      .find({ where: { advertiserId }, order: { platform: 'ASC', currency: 'ASC' } });
    if (links.length === 0) return [];
    const accounts: AdAccountEntity[] = await this.dataSource
      .getRepository(AdAccountEntity)
      .findBy({ id: In(links.map((link: AdvertiserAdAccountEntity): string => link.adAccountId)) });
    return links.flatMap((link: AdvertiserAdAccountEntity): AdAccountEntity[] =>
      accounts.filter((account: AdAccountEntity): boolean => account.id === link.adAccountId)
    );
  }

  /**
   * The goals of an Advertiser, oldest first.
   *
   * @param advertiserId - The Advertiser
   * @returns Its goals, active and archived
   */
  private async goalsOf(advertiserId: string): Promise<ConversionGoalEntity[]> {
    return this.dataSource
      .getRepository(ConversionGoalEntity)
      .find({ where: { advertiserId }, order: { createdAt: 'ASC', id: 'ASC' } });
  }

  /**
   * The refs of goals on every account.
   *
   * @param goals - The goals
   * @returns Their refs, by `<goalId>|<adAccountId>`
   */
  private async refsOf(goals: readonly ConversionGoalEntity[]): Promise<Map<string, ConversionGoalRefEntity>> {
    if (goals.length === 0) return new Map();
    const refs: ConversionGoalRefEntity[] = await this.dataSource
      .getRepository(ConversionGoalRefEntity)
      .findBy({ goalId: In(goals.map((goal: ConversionGoalEntity): string => goal.id)) });
    return new Map(
      refs.map((ref: ConversionGoalRefEntity): [string, ConversionGoalRefEntity] => [
        `${ref.goalId}|${ref.adAccountId}`,
        ref,
      ])
    );
  }
}

/**
 * Queues conversion setups on the job queue.
 */
export class JobQueueTrackingScheduler implements TrackingScheduler {
  /**
   * @param send - Enqueues a job
   */
  constructor(private readonly send: (name: string, data: object) => Promise<unknown>) {}

  /** @inheritdoc */
  public async request(advertiserId: string): Promise<void> {
    await this.send(CONVERSION_SETUP_JOB_NAME, { advertiserId });
  }
}

/**
 * Fastify plugin that decorates the instance with a {@link TrackingService} and its scheduler, which
 * the conversion goals and the ad accounts ask setups of.
 *
 * Depends on `DatabasePlugin`, `AccessServicePlugin`, `SecretStorePlugin` and `JobQueuePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 * @returns A promise that resolves once decorated
 */
async function trackingServicePlugin(fastify: FastifyInstance): Promise<void> {
  const scheduler: TrackingScheduler = new JobQueueTrackingScheduler((name: string, data: object): Promise<unknown> =>
    fastify.jobQueue.send(name, data)
  );
  fastify.decorate('trackingScheduler', scheduler);
  fastify.decorate(
    'trackingService',
    new TrackingService(fastify.db, fastify.accessService, fastify.secretStore, scheduler)
  );
}

export default fastifyPlugin(trackingServicePlugin, {
  name: 'TrackingServicePlugin',
  dependencies: ['DatabasePlugin', 'AccessServicePlugin', 'SecretStorePlugin', 'JobQueuePlugin'],
});
