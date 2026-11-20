import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource, EntityManager, In } from 'typeorm';

import { AdAccountEntity, CampaignEntity, PlatformUnitEntity } from '@src/database/entities';
import {
  AccountContext,
  ADAPTERS,
  adapterOf,
  ApplyResult,
  PlatformAdapter,
  PlatformError,
} from '@src/platforms/platform-adapter';
import { AdReview, CampaignStatus, Platform } from '@src/types';
import { Logger, LoggerBuilder } from '@utils';
import { SecretStore } from './secret-store.service';

/** How long a verdict already given stands before it is read again: a day (`docs/phase-10.md` § 8.8). */
const REREAD_AFTER_MS = 24 * 60 * 60_000;

/** The campaigns whose ads are followed: those that deliver, or may deliver again. */
const FOLLOWED_STATUSES: readonly CampaignStatus[] = ['active', 'paused'];

/** The verdict of an ad sent again, until its platform has looked at it. */
const PENDING: AdReview = { status: 'pending', reasons: [] };

/**
 * Whether a key of `refs` names an ad: the object a Line becomes.
 *
 * @param key - The key, `line:<id>` for a Line
 * @returns `true` for an ad
 */
export function isAdKey(key: string): boolean {
  return key.startsWith('line:');
}

/**
 * The verdicts of a unit once an apply succeeded: an ad sent again — created or rewritten — goes back to
 * `pending`, and an ad its platform no longer holds for us loses its verdict.
 *
 * @param reviews - The verdicts before
 * @param result - What the apply achieved
 * @returns The verdicts after
 */
export function reviewsAfterApply(reviews: Record<string, AdReview>, result: ApplyResult): Record<string, AdReview> {
  const kept: Record<string, AdReview> = {};
  for (const [key, review] of Object.entries(reviews)) {
    if (Object.hasOwn(result.refs, key)) kept[key] = review;
  }
  for (const key of result.submitted ?? []) kept[key] = PENDING;
  return kept;
}

/**
 * The verdicts of a unit once its platform answered.
 *
 * Computed on the unit **as it stands when written**, not as it was read: a sync that sent an ad again
 * while its verdict was being read has the last word, the platform having answered for the content
 * before — so an ad whose verdict moved in between keeps the one it has now.
 *
 * @param current - The unit as it stands now
 * @param read - The unit as it was when its ads were read
 * @param verdicts - What the platform answered, by the id of each ad
 * @returns The verdicts to keep
 */
export function reviewsAfterRead(
  current: PlatformUnitEntity,
  read: PlatformUnitEntity,
  verdicts: ReadonlyMap<string, AdReview>
): Record<string, AdReview> {
  const reviews: Record<string, AdReview> = { ...current.reviews };
  for (const [key, id] of Object.entries(current.refs)) {
    const verdict: AdReview | undefined = verdicts.get(id);
    if (!isAdKey(key) || verdict === undefined) continue;
    if (JSON.stringify(current.reviews[key]) !== JSON.stringify(read.reviews[key])) continue;
    reviews[key] = verdict;
  }
  return reviews;
}

/**
 * Follows what the platforms make of our ads: the job `review.poll`, every ten minutes
 * (`docs/phase-10.md` § 8.8, `../../CADRAGE.md` § 9).
 *
 * Transcribed from multi-search, which reads the verdicts still awaited, account by account, in as few
 * calls as the platform allows. One thing more: a verdict already given is read again once a day, so an
 * ad rejected afterwards, or an appeal won in the platform's own interface, is seen.
 *
 * It reads, and never pushes: nothing here changes a platform.
 */
export class ReviewService {
  /** @internal Logger scoped to this class. */
  private readonly logger: Logger = LoggerBuilder.getChildLogger('ReviewService');

  /**
   * Create the service.
   *
   * @param dataSource - Application database
   * @param secrets - Where the credentials of an account bringing its own are read
   * @param now - Current time in epoch milliseconds, injectable so a test owns the clock
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly secrets: SecretStore,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Read the verdicts that may have moved, account by account.
   *
   * Only the units that need it are read — a verdict still awaited, a unit never read, or one read more
   * than a day ago —, on the platforms that can say, of the campaigns that deliver or may again. An
   * account that fails is tried again at the next poll, and does not stop the others.
   *
   * @returns A promise that resolves once every account due was read, or failed
   *
   * @example
   * ```typescript
   * await fastify.reviewService.poll(); // the `review.poll` job
   * ```
   */
  public async poll(): Promise<void> {
    const platforms: Platform[] = (Object.keys(ADAPTERS) as Platform[]).filter(
      (platform: Platform): boolean => adapterOf(platform).readReviews !== undefined
    );
    if (platforms.length === 0) return;

    const byAccount = new Map<string, PlatformUnitEntity[]>();
    for (const unit of await this.dueUnits(platforms)) {
      byAccount.set(unit.adAccountId, [...(byAccount.get(unit.adAccountId) ?? []), unit]);
    }
    if (byAccount.size === 0) return;
    const accounts: AdAccountEntity[] = await this.dataSource.manager.find(AdAccountEntity, {
      where: { id: In([...byAccount.keys()]) },
    });
    for (const account of accounts) {
      await this.readAccount(account, byAccount.get(account.id) as PlatformUnitEntity[]);
    }
  }

  /**
   * The units whose verdicts are due.
   *
   * @param platforms - The platforms whose adapter reads verdicts
   * @returns The units
   */
  private async dueUnits(platforms: readonly Platform[]): Promise<PlatformUnitEntity[]> {
    return (
      this.dataSource.manager
        .createQueryBuilder(PlatformUnitEntity, 'unit')
        .innerJoin(CampaignEntity, 'campaign', 'campaign.id = unit.campaign_id')
        .innerJoin(AdAccountEntity, 'account', 'account.id = unit.ad_account_id')
        .where('unit.platform IN (:...platforms)', { platforms })
        .andWhere('campaign.status IN (:...followed)', { followed: FOLLOWED_STATUSES })
        .andWhere('campaign.deleted_at IS NULL')
        .andWhere("account.status = 'active'")
        .andWhere('account.deleted_at IS NULL')
        // A verdict awaited, a unit never read, or one read more than a day ago.
        .andWhere(
          "(EXISTS (SELECT 1 FROM jsonb_each(unit.reviews) AS review WHERE review.value ->> 'status' = 'pending') " +
            'OR unit.reviews_read_at IS NULL OR unit.reviews_read_at < :stale)',
          { stale: new Date(this.now() - REREAD_AFTER_MS) }
        )
        .getMany()
    );
  }

  /**
   * Read the verdicts of the ads of one account, and keep them.
   *
   * A unit without an ad is marked read all the same: there was nothing to ask, and its next ad, sent
   * as `pending`, brings it back.
   *
   * @param account - The account
   * @param units - Its units due
   * @returns A promise that resolves once kept, or once the failure is logged
   */
  private async readAccount(account: AdAccountEntity, units: PlatformUnitEntity[]): Promise<void> {
    const adapter: PlatformAdapter = adapterOf(account.platform);
    // Only an account that brings its own key needs one; without it, there is nothing to read with yet.
    if (adapter.connection === 'account_secret' && account.secretName === null) return;
    const ads: string[] = units.flatMap((unit: PlatformUnitEntity): string[] =>
      Object.entries(unit.refs)
        .filter(([key]: [string, string]): boolean => isAdKey(key))
        .map(([, id]: [string, string]): string => id)
    );

    try {
      const context: AccountContext = {
        platform: account.platform,
        adAccountId: account.id,
        externalId: account.externalId,
        scope: account.scope,
        credentials:
          adapter.connection === 'account_secret' ? await this.secrets.get(account.secretName as string) : null,
      };
      const verdicts: Map<string, AdReview> =
        ads.length === 0
          ? new Map<string, AdReview>()
          : await (adapter.readReviews as NonNullable<PlatformAdapter['readReviews']>)(context, ads);
      const now = new Date(this.now());
      for (const unit of units) {
        await this.dataSource.transaction(async (manager: EntityManager): Promise<void> => {
          const current: PlatformUnitEntity | null = await manager.findOne(PlatformUnitEntity, {
            where: { id: unit.id },
            lock: { mode: 'pessimistic_write' },
          });
          if (current === null) return;
          await manager.update(
            PlatformUnitEntity,
            { id: unit.id },
            { reviews: reviewsAfterRead(current, unit, verdicts), reviewsReadAt: now }
          );
        });
      }
    } catch (error: unknown) {
      const refused: boolean =
        error instanceof PlatformError && error.options.invalidCredentials && error.options.ownCredentials !== true;
      if (refused) {
        await this.dataSource.manager.update(
          AdAccountEntity,
          { id: account.id },
          { status: 'invalid', statusReason: 'credentials_rejected' }
        );
      }
      this.logger.warn('Reading the verdicts of an account failed: the next poll tries again', {
        adAccountId: account.id,
        platform: account.platform,
        error,
      });
    }
  }
}

/**
 * Fastify plugin that decorates the instance with a {@link ReviewService}.
 *
 * Depends on `DatabasePlugin` and `SecretStorePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 * @returns A promise that resolves once decorated
 */
async function reviewServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('reviewService', new ReviewService(fastify.db, fastify.secretStore));
}

export default fastifyPlugin(reviewServicePlugin, {
  name: 'ReviewServicePlugin',
  dependencies: ['DatabasePlugin', 'SecretStorePlugin'],
});
