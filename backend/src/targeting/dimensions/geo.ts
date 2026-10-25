import { z } from 'zod';

import { TargetingDimension } from '@src/types';
import { includeExclude, opaqueIds } from '../families';
import { dimension, DimensionDescriptor, listsOf } from './descriptor';

/** How many shapes or points one geographic dimension accepts in a single criterion. */
const MAX_SHAPES = 500;

/** ISO 3166-1 alpha-2 country code. Only the shape is checked, as everywhere else in the model. */
const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'A country is an ISO 3166-1 alpha-2 code, e.g. FR');

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
  location: dimension('Lieux du référentiel de la plateforme', 'opaque_ids', opaqueIds()),
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
