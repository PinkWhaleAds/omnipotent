import { z } from 'zod';

import { paginatedSchema } from './api.types';
import { bulkBodySchema, bulkResultSchema, listQuerySchema } from './crud.types';
import { cappingSchema } from './lever.types';
import { labelSummarySchema } from './label.types';
import { budgetBlockSchema, campaignStatusSchema } from './tree.types';

/** Fields a Campaign list may be sorted on; the first is the default. */
export const CAMPAIGN_SORTABLE_FIELDS = ['name', 'startsOn', 'endsOn', 'createdAt', 'updatedAt'] as const;

/** Name of a campaign; not unique, since the same plan runs again next quarter. */
const campaignNameSchema = z.string().trim().min(1).max(255);

/**
 * ISO 4217 code of the currency every amount of the tree is expressed in.
 *
 * Only the shape is checked here. Whether a platform can be bought in that currency is the platform
 * registry's business, and a preview warning — not something the model can know.
 */
const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'A currency is an ISO 4217 code, e.g. EUR');

/**
 * IANA timezone the days of the campaign are counted in, `null` to follow the Organization's.
 *
 * Checked against the timezones this runtime knows, so a typo is refused at entry rather than
 * shifting every budget day by an unknown amount.
 */
const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value: string): boolean => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown IANA timezone, e.g. Europe/Paris');

/** A day of delivery (`YYYY-MM-DD`), in the timezone of the campaign. */
const daySchema = z.iso.date();

/**
 * Zod schema of a Campaign as returned by the API.
 *
 * @property id - Campaign id
 * @property organizationId - Organization owning it, an opaque uuid from omnipass
 * @property advertiserId - Advertiser it runs for
 * @property name - Its name
 * @property status - Where it stands in its lifecycle
 * @property currency - ISO 4217 currency of every amount of the tree
 * @property timezone - IANA timezone, `null` to follow the Organization's
 * @property startsOn - First day of delivery
 * @property endsOn - Last day of delivery
 * @property budget - What it carries and what it may spend, computed at read time
 * @property capping - The stack of frequency caps; empty means explicitly none
 * @property insertionOrderNumber - Commercial reference of the order (L24)
 * @property containsPoliticalAdvertising - What the user declared about political advertising (D53)
 * @property labels - The Labels posted on it
 * @property createdAt - Creation date (ISO 8601)
 * @property updatedAt - Last update date (ISO 8601)
 * @property deletedAt - Deletion date (ISO 8601), `null` while it lives
 */
export const campaignSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  advertiserId: z.uuid(),
  name: z.string(),
  status: campaignStatusSchema,
  currency: z.string(),
  timezone: z.string().nullable(),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  budget: budgetBlockSchema,
  capping: cappingSchema,
  insertionOrderNumber: z.string().nullable(),
  containsPoliticalAdvertising: z.boolean(),
  labels: z.array(labelSummarySchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});

/** TypeScript type inferred from {@link campaignSchema}. */
export type Campaign = z.infer<typeof campaignSchema>;

/** Zod schema of a page of Campaigns. */
export const campaignPageSchema = paginatedSchema(campaignSchema);

/** Zod schema of the querystring listing the Campaigns of an Advertiser. */
export const listCampaignsQuerySchema = listQuerySchema(CAMPAIGN_SORTABLE_FIELDS);

/** TypeScript type inferred from {@link listCampaignsQuerySchema}, after defaults apply. */
export type ListCampaignsQuery = z.infer<typeof listCampaignsQuerySchema>;

/**
 * Zod schema of the body creating a Campaign.
 *
 * The budget, the dates and the currency are **mandatory**: they are the columns of a campaign, not
 * its completeness. Everything else may come later — a campaign is born a draft and is saved
 * permissively (`../../CADRAGE.md` § 13).
 *
 * @property name - Its name
 * @property currency - ISO 4217 currency of the whole tree
 * @property timezone - IANA timezone, left out to follow the Organization's
 * @property startsOn - First day of delivery
 * @property endsOn - Last day of delivery
 * @property budgetCents - Total budget in integer cents. A **volume** entry (L25) is not offered
 *   here: it converts through a bid CPM, and the bid lives on the AdGroup
 * @property capping - The stack of frequency caps
 * @property insertionOrderNumber - Commercial reference of the order
 * @property containsPoliticalAdvertising - **Required**: whether the campaign carries political
 *   advertising, as the EU regulation 2024/900 makes every platform ask. It is the advertiser's
 *   declaration, so the API **receives** it and never assumes it (D53); `true` is refused by the
 *   preview, with a stable code, until the sponsor declarations the platforms then demand are
 *   modelled
 * @property labelIds - Labels to post on it right away
 */
export const createCampaignBodySchema = z.strictObject({
  name: campaignNameSchema,
  currency: currencySchema,
  timezone: timezoneSchema.nullable().optional(),
  startsOn: daySchema,
  endsOn: daySchema,
  budgetCents: z.number().int().min(0),
  capping: cappingSchema.optional(),
  insertionOrderNumber: z.string().trim().min(1).max(64).nullable().optional(),
  containsPoliticalAdvertising: z.boolean(),
  labelIds: z.array(z.uuid()).optional(),
});

/** TypeScript type inferred from {@link createCampaignBodySchema}. */
export type CreateCampaignBody = z.infer<typeof createCampaignBodySchema>;

/**
 * Zod schema of the body updating a Campaign. A field left out is left alone.
 *
 * The status is **not** here: moving a campaign through its lifecycle is `preview` and `launch`, and
 * belongs to the phase that owns them. Neither is a budget of `null`: the whole tree divides the
 * campaign's amount, so there is nothing to give up.
 */
export const updateCampaignBodySchema = z.strictObject({
  name: campaignNameSchema.optional(),
  timezone: timezoneSchema.nullable().optional(),
  startsOn: daySchema.optional(),
  endsOn: daySchema.optional(),
  budgetCents: z.number().int().min(0).optional(),
  capping: cappingSchema.nullable().optional(),
  insertionOrderNumber: z.string().trim().min(1).max(64).nullable().optional(),
  containsPoliticalAdvertising: z.boolean().optional(),
});

/** TypeScript type inferred from {@link updateCampaignBodySchema}. */
export type UpdateCampaignBody = z.infer<typeof updateCampaignBodySchema>;

/** Zod schema of the body creating several Campaigns under one Advertiser. */
export const bulkCreateCampaignsBodySchema = bulkBodySchema(createCampaignBodySchema);

/** TypeScript type inferred from {@link bulkCreateCampaignsBodySchema}, after defaults apply. */
export type BulkCreateCampaignsBody = z.infer<typeof bulkCreateCampaignsBodySchema>;

/** Zod schema of the body updating several Campaigns: each item names the one it changes. */
export const bulkUpdateCampaignsBodySchema = bulkBodySchema(updateCampaignBodySchema.extend({ id: z.uuid() }));

/** TypeScript type inferred from {@link bulkUpdateCampaignsBodySchema}, after defaults apply. */
export type BulkUpdateCampaignsBody = z.infer<typeof bulkUpdateCampaignsBodySchema>;

/** Zod schema of what a bulk of Campaigns answers. */
export const bulkCampaignResultSchema = bulkResultSchema(campaignSchema);
