import { z } from 'zod';

import { GeoPlace, geoPlaceSchema, MAX_GEO_PLACES, TargetingDimension } from '@src/types';
import { includeExclude, opaqueIds } from '../families';
import { dimension, DimensionDescriptor, listsOf } from './descriptor';

/** How many shapes or points one geographic dimension accepts in a single criterion. */
const MAX_SHAPES = 500;

/** ISO 3166-1 alpha-2 country code. Only the shape is checked, as everywhere else in the model. */
const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'A country is an ISO 3166-1 alpha-2 code, e.g. FR');

/**
 * The places of the referential a TargetingGroup includes and excludes (D57).
 *
 * The include/exclude pair of the family, over places rather than codes: at least one side, and no
 * place on both — told apart by their id, since a place sent and the same place read back differ in
 * the fields the API fills.
 */
const placesSchema = z
  .strictObject({
    include: z.array(geoPlaceSchema).max(MAX_GEO_PLACES).default([]),
    exclude: z.array(geoPlaceSchema).max(MAX_GEO_PLACES).default([]),
  })
  .refine(
    (criteria): boolean => criteria.include.length > 0 || criteria.exclude.length > 0,
    'a criterion must include or exclude something: drop the dimension to restrict nothing'
  )
  .refine((criteria): boolean => {
    const included = new Set<string>(criteria.include.map((place: GeoPlace): string => place.id));
    return !criteria.exclude.some((place: GeoPlace): boolean => included.has(place.id));
  }, 'a place cannot be included and excluded at once');

/** A postal code, whose format belongs to its country: the platform refuses what it does not know. */
const zipCodeSchema = z.string().trim().min(1).max(16);

/** A latitude, in degrees. */
const latitudeSchema = z.number().min(-90).max(90);

/** A longitude, in degrees. */
const longitudeSchema = z.number().min(-180).max(180);

/** A radius around a point, in kilometres. */
const radiusKmSchema = z.number().positive().max(1_000);

/**
 * A circle or a polygon, named.
 *
 * The name travels with the shape because it is what an interface shows back, and because a shape
 * drawn on a map has no other identity — the same denormalization as the places of the geo dimension
 * (`docs/phase-5.md` § 6).
 */
const gpsShapeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('circle'),
    label: z.string().trim().min(1).max(300),
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    radiusKm: radiusKmSchema,
  }),
  z.strictObject({
    kind: z.literal('polygon'),
    label: z.string().trim().min(1).max(300),
    path: z
      .array(z.strictObject({ latitude: latitudeSchema, longitude: longitudeSchema }))
      .min(3)
      .max(MAX_SHAPES),
  }),
]);

/** Where delivery happens: the dimensions that answer « où ». */
export const GEO_DIMENSIONS = {
  country: dimension('Pays', 'include_exclude', includeExclude(countryCodeSchema)),
  zip_code: dimension('Codes postaux', 'include_exclude', includeExclude(zipCodeSchema)),
  metro_code: dimension('Zones de diffusion TV', 'opaque_ids', opaqueIds()),
  // Regions, departments, cities and postal codes of the referential, Google's catalog (D57): each
  // replaces its country at the platforms, and must be in one the TargetingGroup includes.
  location: dimension('Lieux', 'include_exclude', placesSchema),
  proximity: dimension(
    'Proximité autour de points',
    'shape',
    z.strictObject({
      points: z
        .array(
          z.strictObject({
            latitude: latitudeSchema,
            longitude: longitudeSchema,
            radiusKm: radiusKmSchema,
            label: z.string().trim().min(1).max(300).optional(),
            // Required on every write: the country the circle replaces (D57). Optional here only so a
            // circle written before it reads back; the targeting service refuses one without it.
            countryCode: countryCodeSchema
              .optional()
              .describe('ISO 3166-1 alpha-2 country of the centre, required: the country the circle replaces'),
            address: z.string().trim().min(1).max(300).optional().describe('The address it was geocoded from'),
          })
        )
        .min(1)
        .max(MAX_SHAPES),
    })
  ),
  gps: dimension(
    'Zones dessinées',
    'shape',
    z.strictObject({ shapes: z.array(gpsShapeSchema).min(1).max(MAX_SHAPES) })
  ),
  poi: dimension(
    'Points d’intérêt',
    'shape',
    z.strictObject({
      categories: z.array(z.string().trim().min(1).max(256)).min(1).max(MAX_SHAPES),
      radiusKm: radiusKmSchema,
    })
  ),
  zip_code_lists: listsOf('Listes de codes postaux', 'zip_code'),
  grid_lists: listsOf('Listes de mailles géographiques', 'grid'),
  poi_lists: listsOf('Listes de points d’intérêt', 'poi'),
} satisfies Partial<Record<TargetingDimension, DimensionDescriptor>>;
