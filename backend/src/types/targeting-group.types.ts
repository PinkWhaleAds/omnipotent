import { z } from 'zod';

import { paginatedSchema } from './api.types';
import { bulkBodySchema, bulkResultSchema, listQuerySchema } from './crud.types';
import { labelSummarySchema } from './label.types';
import { cappingSchema, leverSchema } from './lever.types';
import { budgetBlockSchema, nodeStatusSchema, nodeWriteFieldsWithoutWindow } from './tree.types';

/** Fields a TargetingGroup list may be sorted on; the first is the default. */
export const TARGETING_GROUP_SORTABLE_FIELDS = ['name', 'createdAt', 'updatedAt'] as const;

/** Name of a TargetingGroup. */
const targetingGroupNameSchema = z.string().trim().min(1).max(255);

/**
 * Zod schema of a TargetingGroup as returned by the API.
 *
 * It has **no window**: a TargetingGroup is a targeting applied, not a period of delivery
 * (`../../CADRAGE.md` § 3). The targeting dimensions themselves arrive with their own phase.
 *
 * @property id - TargetingGroup id
 * @property organizationId - Organization owning it, an opaque uuid from omnipass
 * @property campaignId - Campaign it belongs to
 * @property adGroupId - AdGroup it belongs to
 * @property lever - The channel of its lever
 * @property name - Its name
 * @property status - Whether it delivers
 * @property bidAmountCents - Its own bid amount, `null` to keep its AdGroup's (L3)
 * @property budget - What it carries and what it may spend, computed at read time
 * @property capping - The stack of frequency caps, `null` to inherit its parent's
 * @property labels - The Labels posted on it
 * @property createdAt - Creation date (ISO 8601)
 * @property updatedAt - Last update date (ISO 8601)
 * @property deletedAt - Deletion date (ISO 8601), `null` while it lives
 */
export const targetingGroupSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  campaignId: z.uuid(),
  adGroupId: z.uuid(),
  lever: leverSchema,
  name: z.string(),
  status: nodeStatusSchema,
  bidAmountCents: z.number().int().nullable(),
  budget: budgetBlockSchema,
  capping: cappingSchema.nullable(),
  labels: z.array(labelSummarySchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});

/** TypeScript type inferred from {@link targetingGroupSchema}. */
export type TargetingGroup = z.infer<typeof targetingGroupSchema>;

/** Zod schema of a page of TargetingGroups. */
export const targetingGroupPageSchema = paginatedSchema(targetingGroupSchema);

/** Zod schema of the querystring listing the TargetingGroups of an AdGroup. */
export const listTargetingGroupsQuerySchema = listQuerySchema(TARGETING_GROUP_SORTABLE_FIELDS);

/** TypeScript type inferred from {@link listTargetingGroupsQuerySchema}, after defaults apply. */
export type ListTargetingGroupsQuery = z.infer<typeof listTargetingGroupsQuerySchema>;

/**
 * Zod schema of the body creating a TargetingGroup.
 *
 * @property name - Its name
 * @property bidAmountCents - Its own bid amount, overriding its AdGroup's
 * @property labelIds - Labels to post on it right away
 */
export const createTargetingGroupBodySchema = z.strictObject({
  name: targetingGroupNameSchema,
  bidAmountCents: z.number().int().min(0).nullable().optional(),
  labelIds: z.array(z.uuid()).optional(),
  ...nodeWriteFieldsWithoutWindow,
});

/** TypeScript type inferred from {@link createTargetingGroupBodySchema}. */
export type CreateTargetingGroupBody = z.infer<typeof createTargetingGroupBodySchema>;

/** Zod schema of the body changing a TargetingGroup. A field left out is left alone. */
export const updateTargetingGroupBodySchema = z.strictObject({
  name: targetingGroupNameSchema.optional(),
  bidAmountCents: z.number().int().min(0).nullable().optional(),
  ...nodeWriteFieldsWithoutWindow,
});

/** TypeScript type inferred from {@link updateTargetingGroupBodySchema}. */
export type UpdateTargetingGroupBody = z.infer<typeof updateTargetingGroupBodySchema>;

/** Zod schema of the body creating several TargetingGroups under one AdGroup. */
export const bulkCreateTargetingGroupsBodySchema = bulkBodySchema(createTargetingGroupBodySchema);

/** TypeScript type inferred from {@link bulkCreateTargetingGroupsBodySchema}, after defaults apply. */
export type BulkCreateTargetingGroupsBody = z.infer<typeof bulkCreateTargetingGroupsBodySchema>;

/** Zod schema of the body updating several TargetingGroups: each item names the one it changes. */
export const bulkUpdateTargetingGroupsBodySchema = bulkBodySchema(
  updateTargetingGroupBodySchema.extend({ id: z.uuid() })
);

/** TypeScript type inferred from {@link bulkUpdateTargetingGroupsBodySchema}, after defaults apply. */
export type BulkUpdateTargetingGroupsBody = z.infer<typeof bulkUpdateTargetingGroupsBodySchema>;

/** Zod schema of what a bulk of TargetingGroups answers. */
export const bulkTargetingGroupResultSchema = bulkResultSchema(targetingGroupSchema);
