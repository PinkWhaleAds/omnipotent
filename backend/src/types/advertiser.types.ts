import { z } from 'zod';

import { paginatedSchema } from './api.types';
import { bulkBodySchema, bulkResultSchema, listQuerySchema } from './crud.types';
import { labelSummarySchema } from './label.types';

/** Fields an Advertiser list may be sorted on; the first is the default. */
export const ADVERTISER_SORTABLE_FIELDS = ['name', 'createdAt', 'updatedAt'] as const;

/** Website of a brand: an absolute http(s) URL. */
const websiteUrlSchema = z.url({ protocol: /^https?$/ }).max(2048);

/** Name of a brand, unique among the live Advertisers of its Organization. */
const advertiserNameSchema = z.string().trim().min(1).max(255);

/**
 * Zod schema of an Advertiser as returned by the API.
 *
 * @property id - Advertiser id
 * @property organizationId - Organization owning it, an opaque uuid from omnipass
 * @property name - Brand name
 * @property websiteUrl - Website of the brand, if known
 * @property labels - The Labels posted on it, by name
 * @property createdAt - Creation date (ISO 8601)
 * @property updatedAt - Last update date (ISO 8601)
 * @property deletedAt - Deletion date (ISO 8601), `null` while it lives
 */
export const advertiserSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  name: z.string(),
  websiteUrl: z.string().nullable(),
  labels: z.array(labelSummarySchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});

/** TypeScript type inferred from {@link advertiserSchema}. */
export type Advertiser = z.infer<typeof advertiserSchema>;

/** Zod schema of a page of Advertisers. */
export const advertiserPageSchema = paginatedSchema(advertiserSchema);

/** Zod schema of the querystring listing Advertisers. */
export const listAdvertisersQuerySchema = listQuerySchema(ADVERTISER_SORTABLE_FIELDS);

/** TypeScript type inferred from {@link listAdvertisersQuerySchema}, after defaults apply. */
export type ListAdvertisersQuery = z.infer<typeof listAdvertisersQuerySchema>;

/**
 * Zod schema of the body creating an Advertiser.
 *
 * @property name - Brand name
 * @property websiteUrl - Website of the brand
 * @property labelIds - Labels to post on it right away
 */
export const createAdvertiserBodySchema = z.strictObject({
  name: advertiserNameSchema,
  websiteUrl: websiteUrlSchema.nullable().optional(),
  labelIds: z.array(z.uuid()).optional(),
});

/** TypeScript type inferred from {@link createAdvertiserBodySchema}. */
export type CreateAdvertiserBody = z.infer<typeof createAdvertiserBodySchema>;

/**
 * Zod schema of the body updating an Advertiser. `websiteUrl: null` clears the website; a field left
 * out is left alone.
 *
 * @property name - New brand name
 * @property websiteUrl - New website, or `null` to clear it
 */
export const updateAdvertiserBodySchema = z.strictObject({
  name: advertiserNameSchema.optional(),
  websiteUrl: websiteUrlSchema.nullable().optional(),
});

/** TypeScript type inferred from {@link updateAdvertiserBodySchema}. */
export type UpdateAdvertiserBody = z.infer<typeof updateAdvertiserBodySchema>;

/** Zod schema of the body creating several Advertisers. */
export const bulkCreateAdvertisersBodySchema = bulkBodySchema(createAdvertiserBodySchema);

/** TypeScript type inferred from {@link bulkCreateAdvertisersBodySchema}, after defaults apply. */
export type BulkCreateAdvertisersBody = z.infer<typeof bulkCreateAdvertisersBodySchema>;

/** Zod schema of the body updating several Advertisers: each item names the one it changes. */
export const bulkUpdateAdvertisersBodySchema = bulkBodySchema(updateAdvertiserBodySchema.extend({ id: z.uuid() }));

/** TypeScript type inferred from {@link bulkUpdateAdvertisersBodySchema}, after defaults apply. */
export type BulkUpdateAdvertisersBody = z.infer<typeof bulkUpdateAdvertisersBodySchema>;

/** Zod schema of what a bulk of Advertisers answers. */
export const bulkAdvertiserResultSchema = bulkResultSchema(advertiserSchema);
