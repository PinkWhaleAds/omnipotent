import type { FastifyInstance } from 'fastify';

import { getGeoLocationsByIds, searchGeoLocations } from './geo.handler';
import { getGeoLocationsByIdsSchema, searchGeoLocationsSchema } from './geo.schema';

/**
 * Geo controller: the referential of places a TargetingGroup targets, Google's catalog, the same for
 * every Organization (`docs/phase-10.md` § 8.9).
 *
 * Wires URL → schema → handler.
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 */
export default async function GeoController(fastify: FastifyInstance): Promise<void> {
  fastify.route({
    method: 'GET',
    url: '/geo/locations',
    schema: searchGeoLocationsSchema,
    handler: searchGeoLocations,
  });
  fastify.route({
    method: 'GET',
    url: '/geo/locations/by-ids',
    schema: getGeoLocationsByIdsSchema,
    handler: getGeoLocationsByIds,
  });
}
