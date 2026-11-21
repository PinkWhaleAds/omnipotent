import { geoLocationIdsQuerySchema, geoLocationListSchema, geoLocationSearchQuerySchema } from '@src/types';

/** Input of `search-geo-locations`: the querystring of `GET /geo/locations`. */
export const searchGeoLocationsInputSchema = geoLocationSearchQuerySchema;

/** Input of `get-geo-locations`: the querystring of `GET /geo/locations/by-ids`. */
export const getGeoLocationsInputSchema = geoLocationIdsQuerySchema;

/** MCP tool schema for `search-geo-locations`. */
export const searchGeoLocationsSchema = {
  title: 'Search places',
  description:
    'Search the places a TargetingGroup can target, finer than a country: regions, departments, cities and ' +
    "postal codes of Google's catalog, the referential of every platform, by name (q, 2 to 100 characters; " +
    'case, accents and punctuation ignored). countries (ISO 3166-1 alpha-2) and levels (region, department, ' +
    'city, postal_code) narrow it; limit 1 to 50 (20). Names are in English as Google writes them (Brittany, ' +
    'Lower Normandy); the French names of the French regions match too. A postal code is found here too, ' +
    'with the level postal_code. Put the ids found in the location dimension of set-targeting-dimension, ' +
    '{ include: [{ id }] }: each place must be in one of the countries the TargetingGroup includes, which it ' +
    'replaces at the platforms. Best matches first',
  inputSchema: searchGeoLocationsInputSchema,
  outputSchema: geoLocationListSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `get-geo-locations`. */
export const getGeoLocationsSchema = {
  title: 'Read places by id',
  description:
    'Read places of the referential by id (200 at most), in the order asked, whatever their status: active ' +
    'is false once Google plans to remove a place, which then blocks any new write of the location dimension ' +
    'holding it until it is taken out. Unknown ids, countries and places of a level not offered are absent',
  inputSchema: getGeoLocationsInputSchema,
  outputSchema: geoLocationListSchema,
  annotations: { readOnlyHint: true },
};
