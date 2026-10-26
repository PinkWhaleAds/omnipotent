import { z } from 'zod';

import { paginatedSchema, paginationQuerySchema } from './api.types';
import { bulkBodySchema, bulkResultSchema, listQuerySchema } from './crud.types';
import { labelSummarySchema } from './label.types';

/** Fields a creative library may be sorted on; the first is the default. */
export const CREATIVE_SORTABLE_FIELDS = ['name', 'createdAt', 'updatedAt'] as const;

/**
 * The inventory a creative aims at (`../../CADRAGE.md` § 9).
 *
 * The **format** is what it is bought on; the **subtype** is how it reaches the platform. The two
 * together are the key of the registry, and of what each platform accepts (D37, G6).
 */
export const creativeFormatSchema = z.enum(['search_text', 'display', 'video', 'audio', 'native']);

/** TypeScript type inferred from {@link creativeFormatSchema}. */
export type CreativeFormat = z.infer<typeof creativeFormatSchema>;

/**
 * How a creative reaches the platform.
 *
 * `html5` and `script_tag` are **out of the v1 scope** (L20): no platform of our references accepts
 * them, and a couple nobody takes would fail every preview without serving anyone.
 */
export const creativeSubtypeSchema = z.enum(['rsa', 'image', 'mraid', 'file', 'vast_url', 'youtube_id', 'assets']);

/** TypeScript type inferred from {@link creativeSubtypeSchema}. */
export type CreativeSubtype = z.infer<typeof creativeSubtypeSchema>;

/**
 * What an asset does inside a version.
 *
 * The role is what the registry asks for, so requiring the poster of a redirected VAST (G5) costs no
 * `if` on a platform name.
 */
export const assetRoleSchema = z.enum(['image', 'video', 'audio', 'bundle', 'thumbnail', 'logo', 'icon']);

/** TypeScript type inferred from {@link assetRoleSchema}. */
export type AssetRole = z.infer<typeof assetRoleSchema>;

/** How many third-party trackers one version carries. */
export const MAX_TRACKERS = 20;

/**
 * Zod schema of a third-party tracker carried by a version (L18).
 *
 * The event is the canonical name; each adapter puts the URL where its platform expects it, and a
 * `Line` may override the whole set.
 *
 * @property event - What it measures
 * @property url - Where the platform calls, an absolute https URL
 */
export const trackerSchema = z.strictObject({
  event: z.enum(['impression', 'click', 'start', 'first_quartile', 'midpoint', 'third_quartile', 'complete']),
  url: z.url({ protocol: /^https$/ }).max(2048),
});

/** TypeScript type inferred from {@link trackerSchema}. */
export type Tracker = z.infer<typeof trackerSchema>;

/**
 * Zod schema of an asset a version uses, by role.
 *
 * @property role - What the asset does in that version
 * @property assetId - The asset, of the same Advertiser
 */
export const versionAssetSchema = z.strictObject({
  role: assetRoleSchema,
  assetId: z.uuid(),
});

/** TypeScript type inferred from {@link versionAssetSchema}. */
export type VersionAsset = z.infer<typeof versionAssetSchema>;

/**
 * Zod schema of a version of a creative, as returned by the API.
 *
 * A version is **immutable**: it is never updated and never deleted, a change being a new version
 * (`docs/phase-6.md` § 4).
 *
 * @property id - Version id
 * @property creativeId - The creative it belongs to
 * @property version - Its number inside that creative, from 1
 * @property payload - What its couple carries, in the shape the registry declares
 * @property assets - The assets it uses, by role
 * @property trackers - Its third-party trackers
 * @property active - Whether it is the one that delivers
 * @property createdAt - Creation date (ISO 8601)
 */
export const creativeVersionSchema = z.object({
  id: z.uuid(),
  creativeId: z.uuid(),
  version: z.number().int().min(1),
  payload: z.record(z.string(), z.unknown()),
  assets: z.array(versionAssetSchema),
  trackers: z.array(trackerSchema),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
});

/** TypeScript type inferred from {@link creativeVersionSchema}. */
export type CreativeVersion = z.infer<typeof creativeVersionSchema>;

/** Zod schema of a page of versions. */
export const creativeVersionPageSchema = paginatedSchema(creativeVersionSchema);

/** Zod schema of the querystring listing the versions of a creative. */
export const listCreativeVersionsQuerySchema = paginationQuerySchema;

/** TypeScript type inferred from {@link listCreativeVersionsQuerySchema}, after defaults apply. */
export type ListCreativeVersionsQuery = z.infer<typeof listCreativeVersionsQuerySchema>;

/** How many IAB categories one creative declares. */
export const MAX_IAB_CATEGORIES = 20;

/**
 * Zod schema of a creative as returned by the API.
 *
 * @property id - Creative id
 * @property organizationId - Organization owning it, an opaque uuid from omnipass
 * @property advertiserId - Advertiser whose library it belongs to
 * @property name - Its name
 * @property format - The inventory it aims at; it never changes
 * @property subtype - How it reaches the platform; it never changes
 * @property iabCategories - Content taxonomy ids (L19); required by some platforms, not by the model
 * @property iabTaxonomyVersion - Which taxonomy those ids come from
 * @property clickThroughUrl - Where a click goes; required by some platforms, not by the model
 * @property activeVersion - The version that delivers, `null` until one is activated
 * @property versionCount - How many versions it holds
 * @property labels - The Labels posted on it
 * @property createdAt - Creation date (ISO 8601)
 * @property updatedAt - Last update date (ISO 8601)
 * @property deletedAt - Deletion date (ISO 8601), `null` while it lives
 */
export const creativeSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  advertiserId: z.uuid(),
  name: z.string(),
  format: creativeFormatSchema,
  subtype: creativeSubtypeSchema,
  iabCategories: z.array(z.string()),
  iabTaxonomyVersion: z.string().nullable(),
  clickThroughUrl: z.string().nullable(),
  activeVersion: creativeVersionSchema.nullable(),
  versionCount: z.number().int().min(0),
  labels: z.array(labelSummarySchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});

/** TypeScript type inferred from {@link creativeSchema}. */
export type Creative = z.infer<typeof creativeSchema>;

/** Zod schema of a page of creatives. */
export const creativePageSchema = paginatedSchema(creativeSchema);

/**
 * Zod schema of the querystring listing the creatives of an Advertiser.
 *
 * @property format - Only the creatives of that format
 * @property subtype - Only the creatives of that subtype
 */
export const listCreativesQuerySchema = listQuerySchema(CREATIVE_SORTABLE_FIELDS).extend({
  format: creativeFormatSchema.optional(),
  subtype: creativeSubtypeSchema.optional(),
});

/** TypeScript type inferred from {@link listCreativesQuerySchema}, after defaults apply. */
export type ListCreativesQuery = z.infer<typeof listCreativesQuerySchema>;

/**
 * Zod schema of the body creating a version.
 *
 * The shape of `payload` is the one its couple declares, which `GET /creative-formats` gives: a key
 * the couple does not declare is refused rather than dropped, and a role it does not expect too.
 *
 * @property payload - What the couple carries
 * @property assets - The assets it uses, by role
 * @property trackers - Its third-party trackers
 */
export const createCreativeVersionBodySchema = z.strictObject({
  payload: z.record(z.string(), z.unknown()).default({}),
  assets: z.array(versionAssetSchema).max(16).default([]),
  trackers: z.array(trackerSchema).max(MAX_TRACKERS).default([]),
});

/** TypeScript type inferred from {@link createCreativeVersionBodySchema}, after defaults apply. */
export type CreateCreativeVersionBody = z.infer<typeof createCreativeVersionBodySchema>;

/**
 * Zod schema of the body creating a creative **and its first version**.
 *
 * A creative without a version would carry nothing, so the two are born together — and the version
 * is active at once, there being nothing it could interrupt.
 *
 * @property name - Its name
 * @property format - The inventory it aims at
 * @property subtype - How it reaches the platform
 * @property iabCategories - Content taxonomy ids
 * @property iabTaxonomyVersion - Which taxonomy they come from
 * @property clickThroughUrl - Where a click goes
 * @property labelIds - Labels to post on it right away
 * @property version - Its first version
 */
export const createCreativeBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(255),
  format: creativeFormatSchema,
  subtype: creativeSubtypeSchema,
  iabCategories: z.array(z.string().trim().min(1).max(64)).max(MAX_IAB_CATEGORIES).optional(),
  iabTaxonomyVersion: z.string().trim().min(1).max(16).nullable().optional(),
  clickThroughUrl: z
    .url({ protocol: /^https?$/ })
    .max(2048)
    .nullable()
    .optional(),
  labelIds: z.array(z.uuid()).optional(),
  version: createCreativeVersionBodySchema,
});

/** TypeScript type inferred from {@link createCreativeBodySchema}, after defaults apply. */
export type CreateCreativeBody = z.infer<typeof createCreativeBodySchema>;

/**
 * Zod schema of the body updating a creative.
 *
 * Neither the format nor the subtype is here: they are what the payload of every version was written
 * against, so changing one would invalidate the whole history — that is a new creative.
 *
 * @property name - New name
 * @property iabCategories - New set of taxonomy ids
 * @property iabTaxonomyVersion - New taxonomy version, or `null` to clear it
 * @property clickThroughUrl - New click URL, or `null` to clear it
 */
export const updateCreativeBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(255).optional(),
  iabCategories: z.array(z.string().trim().min(1).max(64)).max(MAX_IAB_CATEGORIES).optional(),
  iabTaxonomyVersion: z.string().trim().min(1).max(16).nullable().optional(),
  clickThroughUrl: z
    .url({ protocol: /^https?$/ })
    .max(2048)
    .nullable()
    .optional(),
});

/** TypeScript type inferred from {@link updateCreativeBodySchema}. */
export type UpdateCreativeBody = z.infer<typeof updateCreativeBodySchema>;

/** Zod schema of the body creating several creatives. */
export const bulkCreateCreativesBodySchema = bulkBodySchema(createCreativeBodySchema);

/** TypeScript type inferred from {@link bulkCreateCreativesBodySchema}, after defaults apply. */
export type BulkCreateCreativesBody = z.infer<typeof bulkCreateCreativesBodySchema>;

/** Zod schema of the body updating several creatives: each item names the one it changes. */
export const bulkUpdateCreativesBodySchema = bulkBodySchema(updateCreativeBodySchema.extend({ id: z.uuid() }));

/** TypeScript type inferred from {@link bulkUpdateCreativesBodySchema}, after defaults apply. */
export type BulkUpdateCreativesBody = z.infer<typeof bulkUpdateCreativesBodySchema>;

/** Zod schema of what a bulk of creatives answers. */
export const bulkCreativeResultSchema = bulkResultSchema(creativeSchema);

/**
 * Zod schema of what the registry of couples answers.
 *
 * @property format - The inventory it aims at
 * @property subtype - How it reaches the platform
 * @property label - Its name, as the French front shows it
 * @property requiredRoles - The asset roles a version must carry
 * @property optionalRoles - Those it may carry
 * @property payloadSchema - The JSON Schema of its payload, so nothing holds a copy of it
 */
export const creativeFormatDescriptorSchema = z.object({
  format: creativeFormatSchema,
  subtype: creativeSubtypeSchema,
  label: z.string(),
  requiredRoles: z.array(assetRoleSchema),
  optionalRoles: z.array(assetRoleSchema),
  payloadSchema: z.record(z.string(), z.unknown()),
});

/** TypeScript type inferred from {@link creativeFormatDescriptorSchema}. */
export type CreativeFormatDescriptor = z.infer<typeof creativeFormatDescriptorSchema>;

/** Zod schema of the answer of the registry route: the couples, in the order of the registry. */
export const creativeCatalogSchema = z.object({
  couples: z.array(creativeFormatDescriptorSchema),
});

/** TypeScript type inferred from {@link creativeCatalogSchema}. */
export type CreativeCatalog = z.infer<typeof creativeCatalogSchema>;
