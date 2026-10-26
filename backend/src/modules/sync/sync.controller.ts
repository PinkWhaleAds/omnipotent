import type { FastifyInstance } from 'fastify';

import { getPlatformStatus, requestSync, retryPlatformUnit } from './sync.handler';
import { getPlatformStatusSchema, requestSyncSchema, retryPlatformUnitSchema } from './sync.schema';

/**
 * Synchronization controller: where a campaign stands on its platforms, and how to push it along.
 *
 * Wires URL → schema → handler. The routes hang from the campaign, because the campaign is what the
 * engine locks and what a sync is asked for (`docs/phase-9.md` § 6).
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 */
export default async function SyncController(fastify: FastifyInstance): Promise<void> {
  fastify.route({
    method: 'GET',
    url: '/campaigns/:id/platform-status',
    schema: getPlatformStatusSchema,
    handler: getPlatformStatus,
  });
  fastify.route({ method: 'POST', url: '/campaigns/:id/sync', schema: requestSyncSchema, handler: requestSync });
  fastify.route({
    method: 'POST',
    url: '/campaigns/:id/platform-units/:unitId/retry',
    schema: retryPlatformUnitSchema,
    handler: retryPlatformUnit,
  });
}
