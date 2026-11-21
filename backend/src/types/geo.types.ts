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
