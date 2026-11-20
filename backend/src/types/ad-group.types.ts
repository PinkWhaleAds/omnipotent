import { z } from 'zod';

import { paginatedSchema } from './api.types';
import { bulkBodySchema, bulkResultSchema, listQuerySchema } from './crud.types';
import { locationIntentSchema } from './extension.types';
import { labelSummarySchema } from './label.types';
import { bidStrategySchema, cappingSchema, leverSchema, objectiveSchema } from './lever.types';
import { platformShareSchema } from './platform.types';
import { budgetBlockSchema, nodeStatusSchema, nodeWriteFields } from './tree.types';

/** Fields an AdGroup list may be sorted on; the first is the default. */
export const AD_GROUP_SORTABLE_FIELDS = ['name', 'createdAt', 'updatedAt'] as const;

/** Name of an AdGroup. */
const adGroupNameSchema = z.string().trim().min(1).max(255);

/**
 * Zod schema of an AdGroup as returned by the API.
 *
 * @property id - AdGroup id
 * @property organizationId - Organization owning it, an opaque uuid from omnipass
 * @property campaignId - Campaign it belongs to
 * @property leverId - Lever it belongs to
 * @property lever - The channel of that lever
 * @property name - Its name
 * @property status - Whether it delivers
 * @property objective - What it runs for, immutable once launched (L4)
 * @property bidStrategy - How it bids (L3)
 * @property bidAmountCents - Its bid amount, `null` when the strategy names none
 * @property platformShares - Its own distribution key, `null` to keep its lever's
 * @property locationIntent - Who its places reach, on a lever that says it; `null` is the people in
 *   them
 * @property budget - What it carries and what it may spend, computed at read time
 * @property startsOn - First day of delivery, `null` to follow its parent's
 * @property endsOn - Last day of delivery, `null` to follow its parent's
 * @property capping - The stack of frequency caps, `null` to inherit its parent's
 * @property labels - The Labels posted on it
 * @property createdAt - Creation date (ISO 8601)
 * @property updatedAt - Last update date (ISO 8601)
 * @property deletedAt - Deletion date (ISO 8601), `null` while it lives
 */
export const adGroupSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  campaignId: z.uuid(),
  leverId: z.uuid(),
  lever: leverSchema,
  name: z.string(),
  status: nodeStatusSchema,
  objective: objectiveSchema,
  bidStrategy: bidStrategySchema,
  bidAmountCents: z.number().int().nullable(),
  platformShares: z.array(platformShareSchema).nullable(),
  locationIntent: locationIntentSchema.nullable(),
  budget: budgetBlockSchema,
  startsOn: z.iso.date().nullable(),
  endsOn: z.iso.date().nullable(),
  capping: cappingSchema.nullable(),
  labels: z.array(labelSummarySchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});

/** TypeScript type inferred from {@link adGroupSchema}. */
export type AdGroup = z.infer<typeof adGroupSchema>;

/** Zod schema of a page of AdGroups. */
export const adGroupPageSchema = paginatedSchema(adGroupSchema);

/** Zod schema of the querystring listing the AdGroups of a Lever. */
export const listAdGroupsQuerySchema = listQuerySchema(AD_GROUP_SORTABLE_FIELDS);

/** TypeScript type inferred from {@link listAdGroupsQuerySchema}, after defaults apply. */
export type ListAdGroupsQuery = z.infer<typeof listAdGroupsQuerySchema>;

/**
 * Zod schema of the body creating an AdGroup.
 *
 * The objective and the bidding strategy are optional: the profile of the lever gives a default for
 * each, so a node being written needs neither (`../../CADRAGE.md` § 13).
 *
 * @property name - Its name
 * @property objective - What it runs for, among those its lever permits
 * @property bidStrategy - How it bids, among those its lever permits
 * @property bidAmountCents - Its bid amount, which a volume entry converts through
 * @property platformShares - Its own distribution key, left out to keep its lever's
 * @property locationIntent - Who its places reach: the people in them (`presence`, the default) or
 *   also those interested in them; only the Search says it
 * @property labelIds - Labels to post on it right away
 */
export const createAdGroupBodySchema = z.strictObject({
  name: adGroupNameSchema,
  objective: objectiveSchema.optional(),
  bidStrategy: bidStrategySchema.optional(),
  bidAmountCents: z.number().int().min(0).nullable().optional(),
  platformShares: z.array(platformShareSchema).min(1).optional(),
  locationIntent: locationIntentSchema.nullable().optional(),
  labelIds: z.array(z.uuid()).optional(),
  ...nodeWriteFields,
});

/** TypeScript type inferred from {@link createAdGroupBodySchema}. */
export type CreateAdGroupBody = z.infer<typeof createAdGroupBodySchema>;

/** Zod schema of the body changing an AdGroup. A field left out is left alone. */
export const updateAdGroupBodySchema = z.strictObject({
  name: adGroupNameSchema.optional(),
  objective: objectiveSchema.optional(),
  bidStrategy: bidStrategySchema.optional(),
  bidAmountCents: z.number().int().min(0).nullable().optional(),
  platformShares: z.array(platformShareSchema).min(1).nullable().optional(),
  locationIntent: locationIntentSchema.nullable().optional(),
  ...nodeWriteFields,
});

/** TypeScript type inferred from {@link updateAdGroupBodySchema}. */
export type UpdateAdGroupBody = z.infer<typeof updateAdGroupBodySchema>;

/** Zod schema of the body creating several AdGroups under one Lever. */
export const bulkCreateAdGroupsBodySchema = bulkBodySchema(createAdGroupBodySchema);

/** TypeScript type inferred from {@link bulkCreateAdGroupsBodySchema}, after defaults apply. */
export type BulkCreateAdGroupsBody = z.infer<typeof bulkCreateAdGroupsBodySchema>;

/** Zod schema of the body updating several AdGroups: each item names the one it changes. */
export const bulkUpdateAdGroupsBodySchema = bulkBodySchema(updateAdGroupBodySchema.extend({ id: z.uuid() }));

/** TypeScript type inferred from {@link bulkUpdateAdGroupsBodySchema}, after defaults apply. */
export type BulkUpdateAdGroupsBody = z.infer<typeof bulkUpdateAdGroupsBodySchema>;

/** Zod schema of what a bulk of AdGroups answers. */
export const bulkAdGroupResultSchema = bulkResultSchema(adGroupSchema);
