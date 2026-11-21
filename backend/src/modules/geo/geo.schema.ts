import type { FastifySchema } from 'fastify';

import { geoLocationIdsQuerySchema, geoLocationListSchema, geoLocationSearchQuerySchema } from '@src/types';
import { errorResponses, toJsonSchema } from '@utils';

/** Tag grouping the geo routes in Swagger. */
const TAGS: string[] = ['Geo'];

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
