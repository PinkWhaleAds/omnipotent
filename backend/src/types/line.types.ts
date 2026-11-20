import { z } from 'zod';

import { paginatedSchema } from './api.types';
import { bulkBodySchema, bulkResultSchema, listQuerySchema } from './crud.types';
import { labelSummarySchema } from './label.types';
import { cappingSchema, leverSchema } from './lever.types';
import { budgetBlockSchema, nodeStatusSchema, nodeWriteFieldsWithoutVolume } from './tree.types';

/** Fields a Line list may be sorted on; the first is the default. */
export const LINE_SORTABLE_FIELDS = ['name', 'createdAt', 'updatedAt'] as const;

/** Name of a Line. */
const lineNameSchema = z.string().trim().min(1).max(255);

/** Landing page of a Line: an absolute http(s) URL. */
const landingPageUrlSchema = z.url({ protocol: /^https?$/ }).max(2048);

/**
 * Zod schema of a Line as returned by the API.
 *
 * The Line is the leaf: it will link its TargetingGroup to a **Creative**, which the phase of the
 * creatives adds. Its budget is forbidden on the `search` lever (D12).
 *
 * @property id - Line id
 * @property organizationId - Organization owning it, an opaque uuid from omnipass
 * @property campaignId - Campaign it belongs to
 * @property targetingGroupId - TargetingGroup it belongs to
 * @property lever - The channel of its lever
 * @property name - Its name
 * @property status - Whether it delivers
 * @property creativeId - The creative it delivers, `null` while none is chosen
 * @property landingPageUrl - Landing page of this Line, overriding the creative's (L18)
 * @property budget - What it carries and what it may spend, computed at read time
 * @property startsOn - First day of delivery, `null` to follow its parent's
 * @property endsOn - Last day of delivery, `null` to follow its parent's
 * @property capping - The stack of frequency caps, `null` to inherit its parent's
 * @property labels - The Labels posted on it
 * @property createdAt - Creation date (ISO 8601)
 * @property updatedAt - Last update date (ISO 8601)
 * @property deletedAt - Deletion date (ISO 8601), `null` while it lives
 */
export const lineSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  campaignId: z.uuid(),
  targetingGroupId: z.uuid(),
  lever: leverSchema,
  name: z.string(),
  status: nodeStatusSchema,
  creativeId: z.uuid().nullable(),
  landingPageUrl: z.string().nullable(),
  budget: budgetBlockSchema,
  startsOn: z.iso.date().nullable(),
  endsOn: z.iso.date().nullable(),
  capping: cappingSchema.nullable(),
  labels: z.array(labelSummarySchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});

/** TypeScript type inferred from {@link lineSchema}. */
export type Line = z.infer<typeof lineSchema>;

/** Zod schema of a page of Lines. */
export const linePageSchema = paginatedSchema(lineSchema);

/** Zod schema of the querystring listing the Lines of a TargetingGroup. */
export const listLinesQuerySchema = listQuerySchema(LINE_SORTABLE_FIELDS);

/** TypeScript type inferred from {@link listLinesQuerySchema}, after defaults apply. */
export type ListLinesQuery = z.infer<typeof listLinesQuerySchema>;

/**
 * Zod schema of the body creating a Line.
 *
 * A budget is entered here as an **amount** only: a volume converts through a bid CPM, and a Line
 * has none of its own (L25).
 *
 * @property name - Its name
 * @property creativeId - The creative it delivers, of the campaign's brand; one creative delivers once
 *   per TargetingGroup (`docs/phase-6.md` § 6)
 * @property landingPageUrl - Landing page of this Line, overriding the creative's
 * @property labelIds - Labels to post on it right away
 */
export const createLineBodySchema = z.strictObject({
  name: lineNameSchema,
  creativeId: z.uuid().nullable().optional(),
  landingPageUrl: landingPageUrlSchema.nullable().optional(),
  labelIds: z.array(z.uuid()).optional(),
  ...nodeWriteFieldsWithoutVolume,
});

/** TypeScript type inferred from {@link createLineBodySchema}. */
export type CreateLineBody = z.infer<typeof createLineBodySchema>;

/** Zod schema of the body changing a Line. A field left out is left alone. */
export const updateLineBodySchema = z.strictObject({
  name: lineNameSchema.optional(),
  creativeId: z.uuid().nullable().optional(),
  landingPageUrl: landingPageUrlSchema.nullable().optional(),
  ...nodeWriteFieldsWithoutVolume,
});

/** TypeScript type inferred from {@link updateLineBodySchema}. */
export type UpdateLineBody = z.infer<typeof updateLineBodySchema>;

/** Zod schema of the body creating several Lines under one TargetingGroup. */
export const bulkCreateLinesBodySchema = bulkBodySchema(createLineBodySchema);

/** TypeScript type inferred from {@link bulkCreateLinesBodySchema}, after defaults apply. */
export type BulkCreateLinesBody = z.infer<typeof bulkCreateLinesBodySchema>;

/** Zod schema of the body updating several Lines: each item names the one it changes. */
export const bulkUpdateLinesBodySchema = bulkBodySchema(updateLineBodySchema.extend({ id: z.uuid() }));

/** TypeScript type inferred from {@link bulkUpdateLinesBodySchema}, after defaults apply. */
export type BulkUpdateLinesBody = z.infer<typeof bulkUpdateLinesBodySchema>;

/** Zod schema of what a bulk of Lines answers. */
export const bulkLineResultSchema = bulkResultSchema(lineSchema);
