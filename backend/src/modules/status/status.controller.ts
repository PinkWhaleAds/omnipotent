import type { FastifyInstance } from 'fastify';

import { getStatus } from './status.handler';
import { getStatusSchema } from './status.schema';

/**
 * Status controller.
 *
 * Wires URL → schema → handler for every status route. No business logic
 * and no inline schemas: the handler lives in `status.handler.ts` and the
 * schema in `status.schema.ts`.
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 *
 * @example
 * ```typescript
 * await fastify.register(StatusController);
 * // GET /status -> { app_name, app_version, timestamp }
 * ```
 */
export default async function StatusController(fastify: FastifyInstance): Promise<void> {
  fastify.route({
    method: 'GET',
    url: '/status',
    schema: getStatusSchema,
    config: { auth: 'none' },
    handler: getStatus,
  });
}
