import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { MapImage } from '@src/geo/amazon-location';
import { GeocodeBody, GeoLocationIdsQuery, GeoLocationSearchQuery, GeoMapBody, ReverseGeocodeBody } from '@src/types';
import { actorOf, organizationIdOf } from '@utils';

/**
 * Handler for `GET /geo/status`.
 *
 * @param _request - The request
 * @param reply - The reply, sent with what the geo services can do
 * @returns A promise that resolves once the response has been sent
 */
export async function getGeoStatus(
  this: FastifyInstance,
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  reply.send(this.geocodingService.status());
}

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

/**
 * Handler for `POST /geo/geocode`.
 *
 * @param request - The request, with the addresses
 * @param reply - The reply, sent with one result per address
 * @returns A promise that resolves once the response has been sent
 */
export async function geocode(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: GeocodeBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.geocodingService.geocode(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `POST /geo/reverse-geocode`.
 *
 * @param request - The request, with the positions
 * @param reply - The reply, sent with one result per position
 * @returns A promise that resolves once the response has been sent
 */
export async function reverseGeocode(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: ReverseGeocodeBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.geocodingService.reverseGeocode(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `POST /geo/map`.
 *
 * @param request - The request, with the circles and the size of the image
 * @param reply - The reply, sent with the image
 * @returns A promise that resolves once the response has been sent
 */
export async function getGeoMap(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: GeoMapBody }>,
  reply: FastifyReply
): Promise<void> {
  const map: MapImage = await this.geocodingService.staticMap(
    actorOf(request),
    organizationIdOf(request),
    request.body
  );
  reply.type(map.contentType).send(map.image);
}
