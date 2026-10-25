import { z } from 'zod';

import { paginatedSchema } from './api.types';
import { bulkBodySchema, bulkResultSchema, listQuerySchema } from './crud.types';

/** Fields a Label list may be sorted on; the first is the default. */
export const LABEL_SORTABLE_FIELDS = ['name', 'createdAt', 'updatedAt'] as const;

/** Name of a Label, unique among the live Labels of its Organization. */
const labelNameSchema = z.string().trim().min(1).max(64);

/** Colour of a Label, `#rrggbb` in lower case. */
const labelColorSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, 'A colour is #rrggbb, e.g. #1f6feb');

/**
 * Kinds of resource a Label can be posted on.
 *
 * An **application-level** enumeration, which grows with each phase: the assignment table stores it
 * as text, so adding a kind costs no migration (D39). A phase making a resource labelable adds its
 * kind here and nowhere else.
 */
export const labelResourceTypeSchema = z.enum(['advertiser']);

/** TypeScript type inferred from {@link labelResourceTypeSchema}. */
export type LabelResourceType = z.infer<typeof labelResourceTypeSchema>;

/**
 * Zod schema of a Label as a labelled resource carries it: enough to show a chip, no more.
 *
 * @property id - Label id
 * @property name - Its name
 * @property color - Its colour, `#rrggbb`
 */
export const labelSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  color: z.string(),
});

/** TypeScript type inferred from {@link labelSummarySchema}. */
export type LabelSummary = z.infer<typeof labelSummarySchema>;

/**
 * Zod schema of a Label as returned by the API.
 *
 * @property id - Label id
 * @property organizationId - Organization owning it, an opaque uuid from omnipass
 * @property name - Its name
 * @property color - Its colour, `#rrggbb`
 * @property createdAt - Creation date (ISO 8601)
 * @property updatedAt - Last update date (ISO 8601)
 * @property deletedAt - Deletion date (ISO 8601), `null` while it lives
 */
export const labelSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  name: z.string(),
  color: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});

/** TypeScript type inferred from {@link labelSchema}. */
export type Label = z.infer<typeof labelSchema>;

/** Zod schema of a page of Labels. */
export const labelPageSchema = paginatedSchema(labelSchema);

/**
 * Zod schema of the querystring listing Labels.
 *
 * A Label is not labelled itself, so the label filter of {@link listQuerySchema} is dropped: it
 * would be a question with no answer.
 */
export const listLabelsQuerySchema = listQuerySchema(LABEL_SORTABLE_FIELDS).omit({
  labelIds: true,
  labelMode: true,
});

/** TypeScript type inferred from {@link listLabelsQuerySchema}, after defaults apply. */
export type ListLabelsQuery = z.infer<typeof listLabelsQuerySchema>;

/**
 * Zod schema of the body creating a Label.
 *
 * @property name - Its name
 * @property color - Its colour, `#rrggbb`
 */
export const createLabelBodySchema = z.strictObject({
  name: labelNameSchema,
  color: labelColorSchema,
});

/** TypeScript type inferred from {@link createLabelBodySchema}. */
export type CreateLabelBody = z.infer<typeof createLabelBodySchema>;

/**
 * Zod schema of the body updating a Label. A field left out is left alone.
 *
 * @property name - New name
 * @property color - New colour
 */
export const updateLabelBodySchema = z.strictObject({
  name: labelNameSchema.optional(),
  color: labelColorSchema.optional(),
});

/** TypeScript type inferred from {@link updateLabelBodySchema}. */
export type UpdateLabelBody = z.infer<typeof updateLabelBodySchema>;

/** Zod schema of the body creating several Labels. */
export const bulkCreateLabelsBodySchema = bulkBodySchema(createLabelBodySchema);

/** TypeScript type inferred from {@link bulkCreateLabelsBodySchema}, after defaults apply. */
export type BulkCreateLabelsBody = z.infer<typeof bulkCreateLabelsBodySchema>;

/** Zod schema of the body updating several Labels: each item names the one it changes. */
export const bulkUpdateLabelsBodySchema = bulkBodySchema(updateLabelBodySchema.extend({ id: z.uuid() }));

/** TypeScript type inferred from {@link bulkUpdateLabelsBodySchema}, after defaults apply. */
export type BulkUpdateLabelsBody = z.infer<typeof bulkUpdateLabelsBodySchema>;

/** Zod schema of what a bulk of Labels answers. */
export const bulkLabelResultSchema = bulkResultSchema(labelSchema);

/**
 * Zod schema of what a Label marks: one entry per resource, with its kind and its name.
 *
 * @property resourceType - The kind of resource
 * @property resourceId - The resource
 * @property name - Its name, denormalized so a listing needs no second call
 */
export const labelledResourceSchema = z.object({
  resourceType: labelResourceTypeSchema,
  resourceId: z.uuid(),
  name: z.string(),
});

/** TypeScript type inferred from {@link labelledResourceSchema}. */
export type LabelledResource = z.infer<typeof labelledResourceSchema>;

/** Zod schema of a page of the resources a Label marks. */
export const labelledResourcePageSchema = paginatedSchema(labelledResourceSchema);
