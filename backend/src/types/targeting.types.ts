import { z } from 'zod';

import { Lever } from './lever.types';

/**
 * The shape a dimension's criteria take (`docs/phase-5.md` § 2).
 *
 * Carried in the discovery answer so a front — or a model — knows what to expect before reading the
 * schema itself: an include/exclude pair, the same over opaque platform ids, a reference to lists of
 * the Organization, a numeric range, a set of serving windows, or a form of its own.
 */
export const targetingFamilySchema = z.enum([
  'include_exclude',
  'opaque_ids',
  'list_reference',
  'range',
  'windows',
  'shape',
]);

/** TypeScript type inferred from {@link targetingFamilySchema}. */
export type TargetingFamily = z.infer<typeof targetingFamilySchema>;

/**
 * What a reusable list of the Organization holds (`../../CADRAGE.md` § 8).
 *
 * An **application-level** enumeration, like the labels' one: the kind is stored as text, so a phase
 * adding a kind costs no migration. A list's kind decides which dimensions it plugs into — a list of
 * POIs does not plug into a dimension of sites.
 */
export const listKindSchema = z.enum([
  'app_site',
  'bundle',
  'device',
  'grid',
  'zip_code',
  'publisher',
  'placement',
  'supply',
  'audience',
  'retargeting',
  'poi',
  'screen',
  'negative_keyword',
]);

/** TypeScript type inferred from {@link listKindSchema}. */
export type ListKind = z.infer<typeof listKindSchema>;

/**
 * Every dimension a TargetingGroup can be targeted on.
 *
 * The dimensions of MBP, read to understand and never copied (D36), in **our** vocabulary: the ids
 * are snake_case like every other enumeration of the model, and they are what a request sends, what
 * the stored object keys on, and what a URL names.
 *
 * What each one accepts is its schema in the registry (`src/targeting/dimensions`); which ones make
 * sense on a lever is the lever profile; which ones a platform accepts is the platform registry
 * (L2, `docs/phase-5.md` § 5).
 *
 * Keywords are **not** here: they have their table, because an AdGroup carries thousands of them
 * (`docs/phase-5.md` § 4). Shared lists of negative keywords are, as a reference to a list.
 */
export const targetingDimensionSchema = z.enum([
  // Where
  'country',
  'zip_code',
  'metro_code',
  'location',
  'proximity',
  'gps',
  'poi',
  // On what, and through what
  'device',
  'device_make',
  'device_model',
  'device_make_model',
  'os',
  'browser',
  'carrier',
  'connection',
  'ip',
  'language',
  'environment',
  // To whom
  'demographics',
  'audience',
  'segment',
  'interest',
  // Which inventory
  'exchange',
  'supply_source',
  'inventory_source',
  'publisher',
  'domain',
  'app',
  'app_site_name',
  'placement',
  'screen',
  'multiplier',
  // Around which content, in which format
  'category',
  'content_genre',
  'content_rating',
  'content_duration',
  'video_ad_format',
  'video_player_size',
  'playback_method',
  'skippable_video',
  'position',
  'social_placement',
  'interstitial_parallax',
  'youtube_channel',
  'youtube_video',
  // At which quality
  'viewability',
  'brand_safety',
  'brand_suitability',
  'verifier',
  'ifa_sampling',
  // When
  'schedule',
  // Search, and the Products mode
  'context_hints',
  'product',
  'product_category',
  // Whatever the platform lets us pass through
  'key_value',
  // Reusable lists of the Organization
  'app_site_lists',
  'bundle_lists',
  'device_lists',
  'grid_lists',
  'zip_code_lists',
  'publisher_lists',
  'placement_lists',
  'supply_lists',
  'audience_lists',
  'retargeting_lists',
  'poi_lists',
  'screen_lists',
  'negative_keyword_lists',
]);

/** TypeScript type inferred from {@link targetingDimensionSchema}. */
export type TargetingDimension = z.infer<typeof targetingDimensionSchema>;

/**
 * Zod schema of what the discovery route says about one dimension.
 *
 * @property dimension - Its id, which a request sends and the stored object keys on
 * @property label - Its name, which a front shows without translating it
 * @property family - The shape of its criteria
 * @property listKind - For a `list_reference`, the kind of list it expects; `null` otherwise
 * @property criteriaSchema - The JSON Schema of its criteria, so nothing is hardcoded anywhere else
 */
export const targetingDimensionDescriptorSchema = z.object({
  dimension: targetingDimensionSchema,
  label: z.string(),
  family: targetingFamilySchema,
  listKind: listKindSchema.nullable(),
  criteriaSchema: z.record(z.string(), z.unknown()),
});

/** TypeScript type inferred from {@link targetingDimensionDescriptorSchema}. */
export type TargetingDimensionDescriptor = z.infer<typeof targetingDimensionDescriptorSchema>;

/** Zod schema of the answer of the discovery route: the registry, in the order of the enumeration. */
export const targetingCatalogSchema = z.object({
  dimensions: z.array(targetingDimensionDescriptorSchema),
});

/** TypeScript type inferred from {@link targetingCatalogSchema}. */
export type TargetingCatalog = z.infer<typeof targetingCatalogSchema>;

/**
 * The targeting of a TargetingGroup, as it is stored and answered: a dimension, its criteria.
 *
 * The criteria are typed by their dimension's own schema in the registry, which is the only thing
 * that judges them — so this type says « some criteria », and the registry says which
 * (`docs/phase-5.md` § 2).
 */
export type Targeting = Partial<Record<TargetingDimension, object>>;

/**
 * What a read of a targeting answers.
 *
 * It carries the lever and **what that lever permits**, so an interface knows which dimensions it may
 * add without holding a copy of the profiles: the permitted set is the model's answer, and the
 * platform's own is the preview's (L2, `docs/phase-5.md` § 5).
 *
 * @property targetingGroupId - The node it belongs to
 * @property lever - Its lever, which decides what may be expressed
 * @property permittedDimensions - The dimensions that lever gives a meaning to, sorted
 * @property targeting - What it targets today
 */
export type TargetingResponse = {
  targetingGroupId: string;
  lever: Lever;
  permittedDimensions: TargetingDimension[];
  targeting: Targeting;
};

/**
 * Zod schema of the body posting the criteria of **one** dimension.
 *
 * The shape of `criteria` depends on the dimension the URL names, so it is the registry that
 * validates it, not this schema: a key the dimension does not declare is refused there, with
 * `targeting_criteria_invalid`. `GET /targeting-dimensions` gives the shape to send.
 *
 * @property criteria - The criteria of the dimension the URL names
 */
export const setTargetingDimensionBodySchema = z.strictObject({
  criteria: z.record(z.string(), z.unknown()),
});

/** TypeScript type inferred from {@link setTargetingDimensionBodySchema}. */
export type SetTargetingDimensionBody = z.infer<typeof setTargetingDimensionBodySchema>;

/**
 * Zod schema of the param naming one dimension in a URL.
 *
 * @property dimension - The dimension the route acts on
 */
export const dimensionParamSchema = z.strictObject({
  dimension: targetingDimensionSchema,
});

/** TypeScript type inferred from {@link dimensionParamSchema}. */
export type DimensionParam = z.infer<typeof dimensionParamSchema>;
