/**
 * @module jobs
 *
 * Every job type of the application. Each process creates the queues listed
 * here; `worker` processes also run their handlers.
 *
 * The socle carries no job: each phase declares its own as a {@link JobDefinition} and adds it to
 * {@link JOB_DEFINITIONS}. A handler reaches the services through the Fastify instance given to
 * `createHandler`, so it enforces the same permissions as an HTTP route or an MCP tool.
 *
 * @example
 * ```typescript
 * export const SYNC_CAMPAIGN_JOB: JobDefinition<{ campaignId: string }> = {
 *   name: 'sync.campaign',
 *   policy: { retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 900 },
 *   createHandler:
 *     (fastify: FastifyInstance): JobHandler<{ campaignId: string }> =>
 *     (data: { campaignId: string }): Promise<void> =>
 *       fastify.syncService.syncCampaign(data.campaignId),
 * };
 * ```
 */
import type { JobDefinition } from '@src/types/job.types';

/** Job definitions, see {@link JobDefinition}. */
export const JOB_DEFINITIONS: JobDefinition[] = [];
