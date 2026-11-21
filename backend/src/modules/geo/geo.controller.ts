import type { FastifyInstance } from 'fastify';

import {
  geocode,
  getGeoLocationsByIds,
  getGeoMap,
  getGeoStatus,
  reverseGeocode,
  searchGeoLocations,
} from './geo.handler';
import {
  geocodeSchema,
  getGeoLocationsByIdsSchema,
  getGeoMapSchema,
  getGeoStatusSchema,
  reverseGeocodeSchema,
  searchGeoLocationsSchema,
} from './geo.schema';

/**
 * Geo controller: the referential of places a TargetingGroup targets, Google's catalog, the same for
 * every Organization; and the geocoding and the maps that place its circles, which count against an
 * Organization's hourly limit (`docs/phase-10.md` § 8.9).
 *
 * Wires URL → schema → handler.
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 */
export default async function GeoController(fastify: FastifyInstance): Promise<void> {
  fastify.route({ method: 'GET', url: '/geo/status', schema: getGeoStatusSchema, handler: getGeoStatus });
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
  fastify.route({ method: 'POST', url: '/geo/geocode', schema: geocodeSchema, handler: geocode });
  fastify.route({ method: 'POST', url: '/geo/reverse-geocode', schema: reverseGeocodeSchema, handler: reverseGeocode });
  fastify.route({ method: 'POST', url: '/geo/map', schema: getGeoMapSchema, handler: getGeoMap });
}
