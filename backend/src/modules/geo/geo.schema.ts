import type { FastifySchema } from 'fastify';
import { z } from 'zod';

import {
  geocodeBodySchema,
  geocodeResultListSchema,
  geoLocationIdsQuerySchema,
  geoLocationListSchema,
  geoLocationSearchQuerySchema,
  geoMapBodySchema,
  geoStatusSchema,
  organizationHeadersSchema,
  reverseGeocodeBodySchema,
  reverseGeocodeResultListSchema,
} from '@src/types';
import { errorResponses, toJsonSchema } from '@utils';

/** Tag grouping the geo routes in Swagger. */
const TAGS: string[] = ['Geo'];

/** Headers of the routes that count against an Organization's hourly limit: the geocoding and the maps. */
const headers: object = toJsonSchema(organizationHeadersSchema, 'input');

/** Fastify schema for `GET /geo/status`. */
export const getGeoStatusSchema: FastifySchema = {
  tags: TAGS,
  description:
    'What the geo services can do in this environment: geocoding is true when addresses and positions are ' +
    'geocoded and maps drawn (Amazon Location Service). Without it, POST /geo/geocode, /geo/reverse-geocode ' +
    'and /geo/map answer 503 geo_service_unavailable, and a circle is placed by its coordinates',
  response: { 200: toJsonSchema(geoStatusSchema), ...errorResponses(401) },
};

/** Fastify schema for `GET /geo/locations`. */
export const searchGeoLocationsSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Search the places a TargetingGroup can target in its location dimension, by name: regions, ' +
    "departments, cities and postal codes of Google's catalog, the referential of every platform, active " +
    'ones only. q takes 2 to 100 characters, case, accents and punctuation ignored; countries (ISO 3166-1 ' +
    'alpha-2) and levels (region, department, city, postal_code) are repeated parameters ' +
    '(?countries=FR&countries=BE); limit 1 to 50, 20 by default. Names are English, as Google writes them ' +
    '(the French names of the French regions match too). Best first: names equal to q, then starting with ' +
    'it, then a word starting with it, then the closest; at equal match, regions, then departments, cities ' +
    'and postal codes. Needs no Organization: the referential is the same for everyone',
  querystring: toJsonSchema(geoLocationSearchQuerySchema, 'input'),
  response: { 200: toJsonSchema(geoLocationListSchema), ...errorResponses(400, 401) },
};

/** Fastify schema for `GET /geo/locations/by-ids`. */
export const getGeoLocationsByIdsSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Read places of the referential by id (?ids=1006094&ids=9040871, 200 at most), in the order asked, ' +
    'whatever their status: active is false once Google plans to remove a place, which then blocks any new ' +
    'write of the location dimension holding it until it is taken out. Unknown ids, countries and places of ' +
    'a level not offered are absent from the answer',
  querystring: toJsonSchema(geoLocationIdsQuerySchema, 'input'),
  response: { 200: toJsonSchema(geoLocationListSchema), ...errorResponses(400, 401) },
};

/** Fastify schema for `POST /geo/geocode`. */
export const geocodeSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Geocode addresses with Amazon Location Service (1 to 100, each 1 to 200 characters), to place the ' +
    'centre of a circle of the proximity dimension: for each, in order, the latitude, longitude, address ' +
    'found (label) and ISO country (the countryCode of the circle) of the best match within countries (if ' +
    'given), or errorCode: geo_address_not_found, geo_lookup_failed. Any member of the Organization. Each ' +
    'address counts against the hourly limit of the Organization (429 geo_hourly_limit_reached); 503 ' +
    'geo_service_unavailable when geocoding is not available (enter the coordinates by hand)',
  headers,
  body: toJsonSchema(geocodeBodySchema, 'input'),
  response: { 200: toJsonSchema(geocodeResultListSchema), ...errorResponses(400, 401, 403, 404, 429, 503) },
};

/** Fastify schema for `POST /geo/reverse-geocode`. */
export const reverseGeocodeSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Find the address and the ISO country of positions (1 to 100) with Amazon Location Service, for a ' +
    'circle whose coordinates were typed or drawn: for each, in order, label and countryCode, or errorCode: ' +
    'geo_position_not_found, geo_lookup_failed. Any member of the Organization. Each position counts against ' +
    'the hourly limit of the Organization (429 geo_hourly_limit_reached); 503 geo_service_unavailable when ' +
    'geocoding is not available',
  headers,
  body: toJsonSchema(reverseGeocodeBodySchema, 'input'),
  response: { 200: toJsonSchema(reverseGeocodeResultListSchema), ...errorResponses(400, 401, 403, 404, 429, 503) },
};

/** Fastify schema for `POST /geo/map`. */
export const getGeoMapSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Draw circles (1 to 50: latitude, longitude, radiusKm) on a static map framed on them, by Amazon ' +
    'Location Service: the image (JPEG), width and height 64 to 1400 pixels (640 × 400 by default). Small ' +
    'circles are drawn as dots. Any member of the Organization; each map counts against the hourly limit of ' +
    'the Organization (429 geo_hourly_limit_reached); 503 geo_service_unavailable when maps are not ' +
    'available, 502 geo_map_failed when Amazon fails to draw it',
  headers,
  body: toJsonSchema(geoMapBodySchema, 'input'),
  response: {
    200: {
      description: 'The map (`image/jpeg`)',
      content: { 'image/jpeg': { schema: toJsonSchema(z.string()) } },
    },
    ...errorResponses(400, 401, 403, 404, 429, 502, 503),
  },
};
