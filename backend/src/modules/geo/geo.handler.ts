import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { GeoLocationIdsQuery, GeoLocationSearchQuery } from '@src/types';

/**
 * Handler for `GET /geo/locations`.
 *
 * The referential belongs to no Organization: being authenticated is enough.
 *
 * @param request - The request, with the text, countries, levels and limit
 * @param reply - The reply, sent with the places found
 * @returns A promise that resolves once the response has been sent
 */
export async function searchGeoLocations(
  this: FastifyInstance,
  request: FastifyRequest<{ Querystring: GeoLocationSearchQuery }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.geoService.search(request.query));
}

/**
 * Handler for `GET /geo/locations/by-ids`.
 *
 * @param request - The request, with the ids
 * @param reply - The reply, sent with the places known
 * @returns A promise that resolves once the response has been sent
 */
export async function getGeoLocationsByIds(
  this: FastifyInstance,
  request: FastifyRequest<{ Querystring: GeoLocationIdsQuery }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.geoService.byIds(request.query.ids));
}
