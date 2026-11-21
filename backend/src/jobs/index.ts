/**
 * @module jobs
 *
 * Every job type of the application. Each process creates the queues listed
 * here; `worker` processes also run their handlers.
 *
 * The socle carries no job: each phase declares its own as a {@link JobDefinition} and adds it to
 * {@link JOB_DEFINITIONS}. A handler reaches the services through the Fastify instance given to
 * `createHandler`, so it enforces the same rules as an HTTP route or an MCP tool.
 *
 * The four jobs of the synchronization are the four rules of D34, one each
 * (`../../CADRAGE.md` § 14, `docs/phase-9.md` § 4). What they have in common is that **none of them
 * walks the fleet**: the sweep reads the units that have something to apply, the pacing reads the
 * campaigns whose own midnight has passed, and the end of a campaign is a single statement. The cost
 * of a minute therefore follows the work waiting, not the size of the database. The job that follows
 * the links of the accounts keeps to the same rule (`docs/phase-10.md` § 4.6).
 */
import type { FastifyInstance } from 'fastify';

import { GEO_IMPORT_JOB_NAME } from '@src/services/geo-import.service';
import type { JobDefinition, JobHandler } from '@src/types/job.types';

/**
 * Apply the desired state of one campaign at its platforms.
 *
 * Queued by every modification of a launched campaign, by the sweep, by the pacing and by the explicit
 * route. Several sends for the same campaign are harmless: the second one finds the fingerprints equal
 * and makes no call, and the campaign's lock stops two workers from working on it at once (D46).
 */
export const SYNC_CAMPAIGN_JOB: JobDefinition<{ campaignId: string }> = {
  name: 'sync.campaign',
  policy: { retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 900 },
  createHandler:
    (fastify: FastifyInstance): ((data: { campaignId: string }) => Promise<void>) =>
    (data: { campaignId: string }): Promise<void> =>
      fastify.syncService.syncCampaign(data.campaignId),
};

/**
 * The catch-up, every minute: queue a sync for every campaign that has a unit waiting.
 *
 * It is what makes the dirty bit sufficient — a modification that marks its units is applied within
 * the minute even if nothing else ever queues a job, and a worker killed in flight loses nothing.
 */
export const SYNC_SWEEP_JOB: JobDefinition = {
  name: 'sync.sweep',
  policy: { policy: 'exclusive', retryLimit: 0, expireInSeconds: 120 },
  cron: '* * * * *',
  createHandler:
    (fastify: FastifyInstance): (() => Promise<void>) =>
    (): Promise<void> =>
      fastify.syncService.sweep(),
};

/**
 * The daily budget, at each campaign's own local midnight (D34 rule 2, D47).
 *
 * It looks every minute at the campaigns whose appointment has passed, so a campaign in Auckland and
 * one in Los Angeles each recompute when **their** day turns over, spread by a jitter.
 */
export const PACING_REFRESH_JOB: JobDefinition = {
  name: 'pacing.refresh',
  policy: { policy: 'exclusive', retryLimit: 0, expireInSeconds: 300 },
  cron: '* * * * *',
  createHandler:
    (fastify: FastifyInstance): (() => Promise<void>) =>
    (): Promise<void> =>
      fastify.syncService.refreshPacing(),
};

/**
 * End the campaigns past their last day, in one statement with the timezone resolved in SQL
 * (D34 rule 3).
 */
export const CAMPAIGN_END_JOB: JobDefinition = {
  name: 'campaign.end',
  policy: { policy: 'exclusive', retryLimit: 0, expireInSeconds: 300 },
  cron: '*/5 * * * *',
  createHandler:
    (fastify: FastifyInstance): (() => Promise<void>) =>
    (): Promise<void> =>
      fastify.syncService.endCampaigns(),
};

/**
 * Follow the links of the accounts invited to, or managed by, our manager accounts, every fifteen
 * minutes (`docs/phase-7.md` § 3, `docs/phase-10.md` § 4.6).
 *
 * It does not walk the fleet either: one read of the links per platform, whatever the number of
 * accounts, and none for a platform with no account to follow.
 */
export const ACCOUNT_LINKS_JOB: JobDefinition = {
  name: 'account.links',
  policy: { policy: 'exclusive', retryLimit: 0, expireInSeconds: 600 },
  cron: '*/15 * * * *',
  createHandler:
    (fastify: FastifyInstance): (() => Promise<void>) =>
    (): Promise<void> =>
      fastify.adAccountService.checkLinks(),
};

/**
 * Read what the platforms made of our ads, every ten minutes (`docs/phase-10.md` § 8.8).
 *
 * It does not walk the fleet either: it reads the units whose verdict is awaited, or was given more
 * than a day ago, in one call per account.
 */
export const REVIEW_POLL_JOB: JobDefinition = {
  name: 'review.poll',
  policy: { policy: 'exclusive', retryLimit: 0, expireInSeconds: 540 },
  cron: '*/10 * * * *',
  createHandler:
    (fastify: FastifyInstance): (() => Promise<void>) =>
    (): Promise<void> =>
      fastify.reviewService.poll(),
};

/**
 * Payload of an import of Google's catalog of places: empty for the monthly one — pg-boss gives `null`
 * to a scheduled job.
 *
 * @property whenEmpty - Import only if the referential is empty (the job queued at a worker's start)
 */
export type GeoImportJob = { whenEmpty?: boolean } | null;

/**
 * Import Google's catalog of places, the 1st of every month at 03:00 UTC (`docs/phase-10.md` § 8.9).
 *
 * Each worker also queues one at its start, run only if the referential is empty — a new database. One
 * import queued or running at most; retried twice, 15 minutes apart then 30. It walks no fleet: the
 * referential is one file, whatever the number of campaigns.
 */
export const GEO_IMPORT_JOB: JobDefinition<GeoImportJob> = {
  name: GEO_IMPORT_JOB_NAME,
  policy: { policy: 'exclusive', retryLimit: 2, retryDelay: 900, retryBackoff: true, expireInSeconds: 3600 },
  cron: '0 3 1 * *',
  createHandler:
    (fastify: FastifyInstance): JobHandler<GeoImportJob> =>
    async (data: GeoImportJob): Promise<void> => {
      await fastify.geoImportService.importGoogle({ whenEmpty: data?.whenEmpty === true });
    },
  onWorkerStart: async (fastify: FastifyInstance): Promise<void> => {
    await fastify.geoImportService.queueWhenEmpty();
  },
};

/** Job definitions, see {@link JobDefinition}. */
export const JOB_DEFINITIONS: JobDefinition[] = [
  SYNC_CAMPAIGN_JOB as JobDefinition,
  SYNC_SWEEP_JOB,
  PACING_REFRESH_JOB,
  CAMPAIGN_END_JOB,
  ACCOUNT_LINKS_JOB,
  REVIEW_POLL_JOB,
  GEO_IMPORT_JOB as JobDefinition,
];
