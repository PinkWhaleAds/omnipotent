import { z } from 'zod';

/**
 * @module types/geo
 *
 * The places a TargetingGroup targets finer than its countries, and the referential they come from:
 * Google's public catalog of places, the pivot of every platform (D57, `docs/phase-10.md` § 8.9).
 */

/**
 * The levels a place is offered at. Google gives every place a target type whose meaning varies by
 * country; the referential groups them into these four (`src/geo/google-geo-targets.ts`).
 */
export const geoLevelSchema = z.enum(['region', 'department', 'city', 'postal_code']);

/** TypeScript type inferred from {@link geoLevelSchema}. */
export type GeoLevel = z.infer<typeof geoLevelSchema>;

/** Shortest text the search of places takes, once case, accents and punctuation are dropped. */
export const GEO_SEARCH_MIN_LENGTH = 2;

/** Places a search answers by default. */
export const GEO_SEARCH_DEFAULT_LIMIT = 20;

/** Most places a search answers. */
export const GEO_SEARCH_MAX_LIMIT = 50;

/** Most places read by id at once. */
export const GEO_MAX_IDS = 200;

/** ISO 3166-1 alpha-2 country code. */
export const geoCountryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'A country is an ISO 3166-1 alpha-2 code, e.g. FR');

/** Id of a place in Google's catalog, the one the referential keys on. */
export const geoLocationIdSchema = z.string().regex(/^\d{1,12}$/, 'A place is the id of the referential, e.g. 1006094');

/**
 * Zod schema of the querystring of the search of places. Lists are repeated parameters
 * (`?countries=FR&countries=BE&levels=city`).
 *
 * @property q - Text of the name, 2 to 100 characters; case, accents and punctuation are ignored
 * @property countries - Only places of these countries; every country when absent
 * @property levels - Only places of these levels; the four when absent
 * @property limit - Most places answered (1 to 50, 20 by default)
 */
export const geoLocationSearchQuerySchema = z.strictObject({
  q: z.string().trim().min(GEO_SEARCH_MIN_LENGTH).max(100),
  countries: z.array(geoCountryCodeSchema).min(1).max(250).optional(),
  levels: z.array(geoLevelSchema).min(1).max(geoLevelSchema.options.length).optional(),
  limit: z.number().int().min(1).max(GEO_SEARCH_MAX_LIMIT).default(GEO_SEARCH_DEFAULT_LIMIT),
});

/** TypeScript type inferred from {@link geoLocationSearchQuerySchema}, after defaults apply. */
export type GeoLocationSearchQuery = z.infer<typeof geoLocationSearchQuerySchema>;

/**
 * Zod schema of the querystring reading places by id (`?ids=1006094&ids=9040871`).
 *
 * @property ids - Ids of the referential, 1 to 200
 */
export const geoLocationIdsQuerySchema = z.strictObject({
  ids: z.array(geoLocationIdSchema).min(1).max(GEO_MAX_IDS),
});

/** TypeScript type inferred from {@link geoLocationIdsQuerySchema}. */
export type GeoLocationIdsQuery = z.infer<typeof geoLocationIdsQuerySchema>;

/**
 * Zod schema of a place of the referential a TargetingGroup can target.
 *
 * @property id - Id of the referential, the one `location` takes
 * @property level - Region, department, city or postal code
 * @property name - Its name, in English as Google writes it (« Brittany », « Paris », « 75001 »)
 * @property canonicalName - Its full name (« Paris,Paris,Ile-de-France,France »)
 * @property countryCode - ISO 3166-1 alpha-2 country it belongs to
 * @property targetType - Google's own type (`City`, `District`, `Postal Code`…)
 * @property parentName - Name of the place Google puts it in, `null` without one
 * @property active - `false` once Google plans to remove it: it can no longer be targeted
 */
export const geoLocationSchema = z.object({
  id: geoLocationIdSchema,
  level: geoLevelSchema,
  name: z.string(),
  canonicalName: z.string(),
  countryCode: z.string(),
  targetType: z.string(),
  parentName: z.string().nullable(),
  active: z.boolean(),
});

/** TypeScript type inferred from {@link geoLocationSchema}. */
export type GeoLocation = z.infer<typeof geoLocationSchema>;

/** Zod schema of a list of places. */
export const geoLocationListSchema = z.object({
  items: z.array(geoLocationSchema),
});

/** TypeScript type inferred from {@link geoLocationListSchema}. */
export type GeoLocationList = z.infer<typeof geoLocationListSchema>;

/** Most places a TargetingGroup includes, or excludes (multi-search's `MAX_GEO_AREAS`). */
export const MAX_GEO_PLACES = 1000;

/**
 * Zod schema of a place of the referential, as the `location` dimension holds it.
 *
 * A caller sends its `id`; the API fills the rest from the referential, and answers it filled. Sending
 * back what a read answered is not an error: those fields are written again from the referential
 * (`docs/phase-10.md` § 8.9).
 *
 * @property id - Id of the referential (`GET /geo/locations`)
 * @property level - Region, department, city or postal code
 * @property name - Its name, as Google writes it (« Paris », « 75001 »)
 * @property canonicalName - Its full name (« Paris,Paris,Ile-de-France,France »)
 * @property countryCode - ISO 3166-1 alpha-2 country it belongs to, the one it replaces at the platforms
 */
export const geoPlaceSchema = z.strictObject({
  id: geoLocationIdSchema,
  level: geoLevelSchema.optional(),
  name: z.string().max(255).optional(),
  canonicalName: z.string().max(500).optional(),
  countryCode: geoCountryCodeSchema.optional(),
});

/** TypeScript type inferred from {@link geoPlaceSchema}. */
export type GeoPlace = z.infer<typeof geoPlaceSchema>;

/** Most addresses geocoded, or positions reverse geocoded, in one call. */
export const GEOCODE_MAX_ITEMS = 100;

/** Most circles drawn on one static map. */
export const GEO_MAP_MAX_CIRCLES = 50;

/** Languages the labels of the geocoding and the maps are written in: those of the interface. */
export const geoLanguageSchema = z.enum(['en', 'fr']);

/** A latitude, WGS 84 degrees. */
const latitudeSchema = z.number().min(-90).max(90);

/** A longitude, WGS 84 degrees. */
const longitudeSchema = z.number().min(-180).max(180);

/**
 * Why one address or position found nothing:
 * - `geo_address_not_found`: no place matches the address (in the countries asked);
 * - `geo_position_not_found`: no address near the position;
 * - `geo_lookup_failed`: Amazon Location failed on this item (try it again later).
 */
export const geoLookupErrorCodeSchema = z.enum([
  'geo_address_not_found',
  'geo_position_not_found',
  'geo_lookup_failed',
]);

/** TypeScript type inferred from {@link geoLookupErrorCodeSchema}. */
export type GeoLookupErrorCode = z.infer<typeof geoLookupErrorCodeSchema>;

/**
 * Zod schema of the body geocoding addresses.
 *
 * @property addresses - Free-text addresses, 1 to 100, each 1 to 200 characters
 * @property countries - Only results in these countries (100 at most); anywhere when absent
 * @property language - Language of the labels found (`fr` by default)
 */
export const geocodeBodySchema = z.strictObject({
  addresses: z.array(z.string().trim().min(1).max(200)).min(1).max(GEOCODE_MAX_ITEMS),
  countries: z.array(geoCountryCodeSchema).min(1).max(100).optional(),
  language: geoLanguageSchema.default('fr'),
});

/** TypeScript type inferred from {@link geocodeBodySchema}, after defaults apply. */
export type GeocodeBody = z.infer<typeof geocodeBodySchema>;

/**
 * Zod schema of the result of one address, in the order of the request: either the place found and
 * `errorCode` null, or every field null but `address` and `errorCode`.
 *
 * @property address - The address, as sent (trimmed)
 * @property latitude - WGS 84 degrees
 * @property longitude - WGS 84 degrees
 * @property label - The address found, written in full (« 10 Rue de Rivoli, 75004 Paris, France »)
 * @property countryCode - ISO 3166-1 alpha-2 country of the place found: the `countryCode` of its circle
 * @property errorCode - Why nothing was found, see {@link geoLookupErrorCodeSchema}
 */
export const geocodeResultSchema = z.object({
  address: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  label: z.string().nullable(),
  countryCode: z.string().nullable(),
  errorCode: geoLookupErrorCodeSchema.nullable(),
});

/** TypeScript type inferred from {@link geocodeResultSchema}. */
export type GeocodeResult = z.infer<typeof geocodeResultSchema>;

/** Zod schema of the answer of a geocoding: one result per address, in order. */
export const geocodeResultListSchema = z.object({
  items: z.array(geocodeResultSchema),
});

/** TypeScript type inferred from {@link geocodeResultListSchema}. */
export type GeocodeResultList = z.infer<typeof geocodeResultListSchema>;

/** Zod schema of a position (WGS 84 degrees). */
export const geoPositionSchema = z.strictObject({ latitude: latitudeSchema, longitude: longitudeSchema });

/** TypeScript type inferred from {@link geoPositionSchema}. */
export type GeoPosition = z.infer<typeof geoPositionSchema>;

/**
 * Zod schema of the body reverse geocoding positions.
 *
 * @property points - Positions, 1 to 100
 * @property language - Language of the labels found (`fr` by default)
 */
export const reverseGeocodeBodySchema = z.strictObject({
  points: z.array(geoPositionSchema).min(1).max(GEOCODE_MAX_ITEMS),
  language: geoLanguageSchema.default('fr'),
});

/** TypeScript type inferred from {@link reverseGeocodeBodySchema}, after defaults apply. */
export type ReverseGeocodeBody = z.infer<typeof reverseGeocodeBodySchema>;

/**
 * Zod schema of the result of one position, in the order of the request.
 *
 * @property latitude - The position, as sent
 * @property longitude - The position, as sent
 * @property label - The nearest address, written in full; `null` when nothing was found
 * @property countryCode - ISO 3166-1 alpha-2 country of that address; `null` when nothing was found
 * @property errorCode - Why nothing was found, see {@link geoLookupErrorCodeSchema}
 */
export const reverseGeocodeResultSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  label: z.string().nullable(),
  countryCode: z.string().nullable(),
  errorCode: geoLookupErrorCodeSchema.nullable(),
});

/** TypeScript type inferred from {@link reverseGeocodeResultSchema}. */
export type ReverseGeocodeResult = z.infer<typeof reverseGeocodeResultSchema>;

/** Zod schema of the answer of a reverse geocoding: one result per position, in order. */
export const reverseGeocodeResultListSchema = z.object({
  items: z.array(reverseGeocodeResultSchema),
});

/** TypeScript type inferred from {@link reverseGeocodeResultListSchema}. */
export type ReverseGeocodeResultList = z.infer<typeof reverseGeocodeResultListSchema>;

/** Zod schema of a circle drawn on a map: the centre and the radius of a circle of `proximity`. */
export const geoMapCircleSchema = z.strictObject({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  radiusKm: z.number().positive().max(1_000),
});

/** TypeScript type inferred from {@link geoMapCircleSchema}. */
export type GeoMapCircle = z.infer<typeof geoMapCircleSchema>;

/**
 * Zod schema of the body drawing circles on a static map, framed on them.
 *
 * @property circles - The circles, 1 to 50
 * @property width - Width of the image in pixels (64 to 1400, 640 by default)
 * @property height - Height of the image in pixels (64 to 1400, 400 by default)
 * @property language - Language of the map labels (`fr` by default)
 */
export const geoMapBodySchema = z.strictObject({
  circles: z.array(geoMapCircleSchema).min(1).max(GEO_MAP_MAX_CIRCLES),
  width: z.number().int().min(64).max(1400).default(640),
  height: z.number().int().min(64).max(1400).default(400),
  language: geoLanguageSchema.default('fr'),
});

/** TypeScript type inferred from {@link geoMapBodySchema}, after defaults apply. */
export type GeoMapBody = z.infer<typeof geoMapBodySchema>;

/**
 * Zod schema of what the geo services can do in this environment.
 *
 * @property geocoding - Whether addresses and positions are geocoded and maps drawn (Amazon Location
 *   Service); without it, those routes answer 503 `geo_service_unavailable`, and a circle is placed by
 *   its coordinates
 */
export const geoStatusSchema = z.object({
  geocoding: z.boolean(),
});

/** TypeScript type inferred from {@link geoStatusSchema}. */
export type GeoStatus = z.infer<typeof geoStatusSchema>;
