import { z } from 'zod';

import {
  geocodeBodySchema,
  geocodeResultListSchema,
  geoLocationIdsQuerySchema,
  geoLocationListSchema,
  geoLocationSearchQuerySchema,
  geoStatusSchema,
  organizationArgSchema,
  reverseGeocodeBodySchema,
  reverseGeocodeResultListSchema,
} from '@src/types';

/** Input of `search-geo-locations`: the querystring of `GET /geo/locations`. */
export const searchGeoLocationsInputSchema = geoLocationSearchQuerySchema;

/** Input of `get-geo-locations`: the querystring of `GET /geo/locations/by-ids`. */
export const getGeoLocationsInputSchema = geoLocationIdsQuerySchema;

/** Input of `get-geo-status`: the status is the same for everyone. */
export const getGeoStatusInputSchema = z.strictObject({});

/** Input of `geocode-addresses`: the body of `POST /geo/geocode`, and the Organization it counts against. */
export const geocodeAddressesInputSchema = geocodeBodySchema.extend({ organizationId: organizationArgSchema });

/** TypeScript type inferred from {@link geocodeAddressesInputSchema}, after defaults apply. */
export type GeocodeAddressesInput = z.infer<typeof geocodeAddressesInputSchema>;

/** Input of `reverse-geocode-positions`: the body of `POST /geo/reverse-geocode`, and the Organization. */
export const reverseGeocodePositionsInputSchema = reverseGeocodeBodySchema.extend({
  organizationId: organizationArgSchema,
});

/** TypeScript type inferred from {@link reverseGeocodePositionsInputSchema}, after defaults apply. */
export type ReverseGeocodePositionsInput = z.infer<typeof reverseGeocodePositionsInputSchema>;

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

/** MCP tool schema for `get-geo-status`. */
export const getGeoStatusSchema = {
  title: 'Can addresses be geocoded here',
  description:
    'Whether geocode-addresses and reverse-geocode-positions work in this environment (Amazon Location ' +
    'Service). When they do not, ask the user for the coordinates of a circle and its country.',
  inputSchema: getGeoStatusInputSchema,
  outputSchema: geoStatusSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `geocode-addresses`. */
export const geocodeAddressesSchema = {
  title: 'Geocode addresses',
  description:
    'Find the coordinates of addresses (1 to 100, free text such as a shop address), to target a circle ' +
    'around them: put latitude, longitude, countryCode, the radiusKm and the address in the proximity ' +
    'dimension of set-targeting-dimension; the TargetingGroup must include that country. countries (ISO ' +
    '3166-1 alpha-2) keeps results in those countries; language (fr or en) is the language of the address ' +
    'found. For each address, in order: latitude, longitude, label (the address found, check it matches) and ' +
    'countryCode, or errorCode geo_address_not_found or geo_lookup_failed. Each address counts against an ' +
    'hourly limit of the Organization. When geocoding is not available, ask the user for the coordinates',
  inputSchema: geocodeAddressesInputSchema,
  outputSchema: geocodeResultListSchema,
  annotations: { readOnlyHint: true, openWorldHint: true },
};

/** MCP tool schema for `reverse-geocode-positions`. */
export const reverseGeocodePositionsSchema = {
  title: 'Reverse geocode positions',
  description:
    'Find the nearest address and the country (ISO 3166-1 alpha-2) of positions (1 to 100: latitude, ' +
    'longitude), for a circle whose coordinates the user gave: that country is the countryCode of the ' +
    'circle, and must be one the TargetingGroup includes. For each position, in order: label and ' +
    'countryCode, or errorCode geo_position_not_found or geo_lookup_failed. Each position counts against an ' +
    'hourly limit of the Organization',
  inputSchema: reverseGeocodePositionsInputSchema,
  outputSchema: reverseGeocodeResultListSchema,
  annotations: { readOnlyHint: true, openWorldHint: true },
};
