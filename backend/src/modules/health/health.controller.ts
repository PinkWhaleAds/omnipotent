import type { FastifyInstance } from 'fastify';

import { getHealthz, getLivez, getReadyz } from './health.handler';
import { getHealthzSchema, getLivezSchema, getReadyzSchema } from './health.schema';

/**
 * Health controller.
 *
 * Wires the Kubernetes probe URLs → schema → handler. No business logic and no
 * inline schemas: handlers live in `health.handler.ts`, schemas in
 * `health.schema.ts`, and the checks themselves in `@services/health.service`.
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 *
 * @example
 * ```typescript
 * await fastify.register(HealthController);
 * // GET /livez, GET /readyz, GET /healthz -> { status, checks }
 * ```
 */
export default async function HealthController(fastify: FastifyInstance): Promise<void> {
  fastify.route({
    method: 'GET',
    url: '/livez',
    schema: getLivezSchema,
    config: { auth: 'none' },
    handler: getLivez,
  });

  fastify.route({
    method: 'GET',
    url: '/readyz',
    schema: getReadyzSchema,
    config: { auth: 'none' },
    handler: getReadyz,
  });

  fastify.route({
    method: 'GET',
    url: '/healthz',
    schema: getHealthzSchema,
    config: { auth: 'none' },
    handler: getHealthz,
  });
}
