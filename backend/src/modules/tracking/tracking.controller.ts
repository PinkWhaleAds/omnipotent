import type { FastifyInstance } from 'fastify';

import { getTracking, getTrackingScript } from './tracking.handler';
import { getTrackingScriptSchema, getTrackingSchema } from './tracking.schema';

/**
 * Tracking controller: the one code an Advertiser's site installs, and the public script it loads
 * (D58, `docs/phase-10.md` § 8.10).
 *
 * Wires URL → schema → handler. The script needs no authentication: a site's visitors load it, and it
 * holds nothing but public identifiers.
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 */
export default async function TrackingController(fastify: FastifyInstance): Promise<void> {
  fastify.route({ method: 'GET', url: '/advertisers/:id/tracking', schema: getTrackingSchema, handler: getTracking });
  fastify.route({
    method: 'GET',
    url: '/t/:key.js',
    schema: getTrackingScriptSchema,
    config: { auth: 'none' },
    handler: getTrackingScript,
  });
}
