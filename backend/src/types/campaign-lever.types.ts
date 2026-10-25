import { z } from 'zod';

import { paginatedSchema } from './api.types';
import { listQuerySchema } from './crud.types';
import { labelSummarySchema } from './label.types';
import { leverSchema } from './lever.types';
import { platformShareSchema } from './platform.types';
import { budgetBlockSchema, cappingSchema, nodeStatusSchema, nodeWriteFields } from './tree.types';

/**
 * The resource side of a lever: one channel of one campaign.
 *
 * It lives apart from `lever.types.ts`, which holds the channel and the values a profile declares:
 * that file must not depend on anything, since the shapes of the tree depend on **it**. Named
 * `CampaignLever` so that `Lever` keeps meaning *the channel* — the key the profiles and the
 * platform registry are written against.
 */

/** Fields a Lever list may be sorted on; the first is the default. */
export const LEVER_SORTABLE_FIELDS = ['lever', 'createdAt', 'updatedAt'] as const;

/**
 * Zod schema of a Lever as returned by the API.
 *
 * @property id - Lever id
 * @property organizationId - Organization owning it, an opaque uuid from omnipass
 * @property campaignId - Campaign it belongs to
 * @property lever - Its channel
 * @property status - Whether it delivers
 * @property productsMode - Whether it runs in Products mode (L14)
 * @property platformShares - Its platforms and their shares, the distribution key of the subtree
 * @property budget - What it carries and what it may spend, computed at read time
 * @property startsOn - First day of delivery, `null` to follow the campaign's
 * @property endsOn - Last day of delivery, `null` to follow the campaign's
 * @property capping - The stack of frequency caps, `null` to inherit the campaign's
 * @property labels - The Labels posted on it
 * @property createdAt - Creation date (ISO 8601)
 * @property updatedAt - Last update date (ISO 8601)
 * @property deletedAt - Deletion date (ISO 8601), `null` while it lives
 */
export const campaignLeverSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  campaignId: z.uuid(),
  lever: leverSchema,
  status: nodeStatusSchema,
  productsMode: z.boolean(),
  platformShares: z.array(platformShareSchema),
  budget: budgetBlockSchema,
  startsOn: z.iso.date().nullable(),
  endsOn: z.iso.date().nullable(),
  capping: cappingSchema.nullable(),
  labels: z.array(labelSummarySchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});

/** TypeScript type inferred from {@link campaignLeverSchema}. */
export type CampaignLever = z.infer<typeof campaignLeverSchema>;

/** Zod schema of a page of Levers. */
export const campaignLeverPageSchema = paginatedSchema(campaignLeverSchema);

/**
 * Zod schema of the querystring listing the Levers of a Campaign.
 *
 * A Lever has no name of its own — it *is* its channel — so the text search of the shared query is
 * dropped: it would be a question with no answer.
 */
export const listLeversQuerySchema = listQuerySchema(LEVER_SORTABLE_FIELDS).omit({ search: true });

/** TypeScript type inferred from {@link listLeversQuerySchema}, after defaults apply. */
export type ListLeversQuery = z.infer<typeof listLeversQuerySchema>;

/**
 * Zod schema of the body adding a Lever to a Campaign.
 *
 * The platforms and their shares come with the lever: they are the distribution key of everything
 * below it (`../../CADRAGE.md` § 4).
 *
 * @property lever - The channel
 * @property platformShares - Its platforms and their shares, totalling a hundred percent
 * @property productsMode - Whether it runs in Products mode, which only the Search permits
 * @property labelIds - Labels to post on it right away
 */
export const createLeverBodySchema = z.strictObject({
  lever: leverSchema,
  platformShares: z.array(platformShareSchema).min(1),
  productsMode: z.boolean().optional(),
  labelIds: z.array(z.uuid()).optional(),
  ...nodeWriteFields,
});

/** TypeScript type inferred from {@link createLeverBodySchema}. */
export type CreateLeverBody = z.infer<typeof createLeverBodySchema>;

/**
 * Zod schema of the body changing a Lever. Its channel is **not** here: a lever that changed channel
 * would be another lever, and the subtree below it would mean nothing.
 */
export const updateLeverBodySchema = z.strictObject({
  platformShares: z.array(platformShareSchema).min(1).optional(),
  productsMode: z.boolean().optional(),
  ...nodeWriteFields,
});

/** TypeScript type inferred from {@link updateLeverBodySchema}. */
export type UpdateLeverBody = z.infer<typeof updateLeverBodySchema>;
