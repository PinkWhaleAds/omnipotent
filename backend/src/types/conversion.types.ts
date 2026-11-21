import { z } from 'zod';

import { paginatedSchema, paginationQuerySchema } from './api.types';
import { messageCodeSchema, messageParamsSchema } from './error.types';
import { platformSchema } from './platform.types';

/**
 * What a conversion is, in a vocabulary every platform maps (`src/platforms/conversion-events.ts`).
 * Transcribed from multi-search (D58, `docs/phase-10.md` § 8.10).
 */
export const conversionCategorySchema = z.enum([
  'purchase',
  'lead',
  'signup',
  'subscription',
  'trial',
  'appointment',
  'contact',
  'add_to_cart',
  'begin_checkout',
  'other',
]);

/** TypeScript type inferred from {@link conversionCategorySchema}. */
export type ConversionCategory = z.infer<typeof conversionCategorySchema>;

/** How a conversion is valued: not at all, at a fixed value, or at the value the site sends (the default as a fallback). */
export const conversionValueModeSchema = z.enum(['none', 'fixed', 'dynamic']);

/** TypeScript type inferred from {@link conversionValueModeSchema}. */
export type ConversionValueMode = z.infer<typeof conversionValueModeSchema>;

/** Which conversions count: every one, or one per click. */
export const conversionCountingSchema = z.enum(['every', 'one']);

/** TypeScript type inferred from {@link conversionCountingSchema}. */
export type ConversionCounting = z.infer<typeof conversionCountingSchema>;

/** Whether a goal is measured (`active`) or not any more (`archived`). A goal is never deleted. */
export const conversionGoalStatusSchema = z.enum(['active', 'archived']);

/** TypeScript type inferred from {@link conversionGoalStatusSchema}. */
export type ConversionGoalStatus = z.infer<typeof conversionGoalStatusSchema>;

/** Longest key of a goal. */
export const MAX_GOAL_KEY_LENGTH = 40;

/** Highest value of a goal, in cents: a million units of its currency. */
export const MAX_GOAL_VALUE_CENTS = 100_000_000;

/**
 * The key the site sends: lower case letters, digits, dashes and underscores, starting with a letter
 * (`purchase`, `quote-request`, `devis_pro`). Two keys of an Advertiser that differ only by a dash and an
 * underscore are refused by the service: a platform naming its events after them would not tell them
 * apart.
 */
const goalKeySchema = z
  .string()
  .trim()
  .regex(
    /^[a-z][a-z0-9_-]{0,39}$/,
    'lower case letters, digits, dashes and underscores, starting with a letter, 40 at most'
  );

/** Name of a goal. */
const goalNameSchema = z.string().trim().min(1).max(80);

/** Value of a goal in integer cents of its currency. */
const goalValueCentsSchema = z.number().int().positive().max(MAX_GOAL_VALUE_CENTS);

/**
 * ISO 4217 code of the currency of a goal's value. Only the shape is checked, as for a campaign's: a
 * platform refuses a currency it does not know when the goal is set up there.
 */
const goalCurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'A currency is an ISO 4217 code, e.g. EUR');

/**
 * Zod schema of a conversion goal, as returned.
 *
 * @property id - Goal id
 * @property advertiserId - The Advertiser it belongs to
 * @property key - What the site sends: `msq('conversion', { goal: '<key>' })`; fixed once created
 * @property name - Its name, the base of its name at the platforms
 * @property category - What the conversion is; fixed once created
 * @property valueMode - How it is valued, see {@link conversionValueModeSchema}
 * @property defaultValueCents - Fixed value, or fallback of a dynamic one, in integer cents of `currency`
 * @property currency - Currency of the value, `null` without one
 * @property counting - Which conversions count, see {@link conversionCountingSchema}
 * @property status - `active`, or `archived`
 * @property createdAt - Creation date (ISO 8601)
 * @property updatedAt - Last update date (ISO 8601)
 */
export const conversionGoalSchema = z.object({
  id: z.uuid(),
  advertiserId: z.uuid(),
  key: z.string(),
  name: z.string(),
  category: conversionCategorySchema,
  valueMode: conversionValueModeSchema,
  defaultValueCents: z.number().int().nullable(),
  currency: z.string().nullable(),
  counting: conversionCountingSchema,
  status: conversionGoalStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** TypeScript type inferred from {@link conversionGoalSchema}. */
export type ConversionGoal = z.infer<typeof conversionGoalSchema>;

/** Zod schema of a page of conversion goals. */
export const conversionGoalPageSchema = paginatedSchema(conversionGoalSchema);

/** Zod schema of the querystring listing the conversion goals of an Advertiser, oldest first. */
export const listConversionGoalsQuerySchema = paginationQuerySchema.extend({
  status: conversionGoalStatusSchema.optional(),
});

/** TypeScript type inferred from {@link listConversionGoalsQuerySchema}, after defaults apply. */
export type ListConversionGoalsQuery = z.infer<typeof listConversionGoalsQuerySchema>;

/**
 * Zod schema of the body creating a conversion goal. A value needs a currency; a fixed one needs an
 * amount.
 *
 * @property key - What the site sends, see {@link goalKeySchema}
 * @property name - Its name
 * @property category - What the conversion is
 * @property valueMode - How it is valued, `none` by default
 * @property defaultValueCents - Fixed value, or fallback of a dynamic one
 * @property currency - Currency of the value
 * @property counting - Which conversions count, `every` by default
 */
export const createConversionGoalBodySchema = z.strictObject({
  key: goalKeySchema,
  name: goalNameSchema,
  category: conversionCategorySchema,
  valueMode: conversionValueModeSchema.default('none'),
  defaultValueCents: goalValueCentsSchema.nullable().optional(),
  currency: goalCurrencySchema.nullable().optional(),
  counting: conversionCountingSchema.default('every'),
});

/** TypeScript type inferred from {@link createConversionGoalBodySchema}, after defaults apply. */
export type CreateConversionGoalBody = z.infer<typeof createConversionGoalBodySchema>;

/**
 * Zod schema of the body changing a conversion goal: its key and category are fixed. `status:
 * 'archived'` stops measuring it, `active` measures it again; a field left out is left alone.
 */
export const updateConversionGoalBodySchema = z.strictObject({
  name: goalNameSchema.optional(),
  valueMode: conversionValueModeSchema.optional(),
  defaultValueCents: goalValueCentsSchema.nullable().optional(),
  currency: goalCurrencySchema.nullable().optional(),
  counting: conversionCountingSchema.optional(),
  status: conversionGoalStatusSchema.optional(),
});

/** TypeScript type inferred from {@link updateConversionGoalBodySchema}. */
export type UpdateConversionGoalBody = z.infer<typeof updateConversionGoalBodySchema>;

/**
 * Where a platform object — the tracking code of an Advertiser, or a goal — stands on one ad account.
 *
 * - `pending`: not set up yet
 * - `ready`: set up and usable
 * - `manual_required`: someone must act first (`messageCode` says who and how)
 * - `failed`: the platform refused (`message` says why); set up again at the next sweep
 * - `paused`: the goal is archived, and no longer measured
 */
export const trackingRefStatusSchema = z.enum(['pending', 'ready', 'manual_required', 'failed', 'paused']);

/** TypeScript type inferred from {@link trackingRefStatusSchema}. */
export type TrackingRefStatus = z.infer<typeof trackingRefStatusSchema>;

/**
 * Zod schema of the tracking of an Advertiser, as returned by `GET /advertisers/:id/tracking`.
 *
 * Each tracking code and goal tells why it is not ready, or what to do, in `message` (English), with
 * `messageCode` and `messageParams` when we worded it, for its translation; a platform's own text has
 * `messageCode` `null`. The codes are in `docs/error-codes.md`.
 *
 * @property advertiserId - The Advertiser
 * @property snippet - The one code to paste in the `<head>` of every page of the site
 * @property scriptUrl - The script the snippet loads
 * @property cspDomains - Domains the site's Content Security Policy must allow (scripts and connections)
 * @property lastSeenAt - Last time a page of the site loaded the script (recorded once an hour at most),
 *   `null` until one does: whether the code is installed
 * @property platforms - Per ad account linked to the Advertiser: its tracking code and each goal's state
 */
export const advertiserTrackingSchema = z.object({
  advertiserId: z.uuid(),
  snippet: z.string(),
  scriptUrl: z.string(),
  cspDomains: z.array(z.string()),
  lastSeenAt: z.iso.datetime().nullable(),
  platforms: z.array(
    z.object({
      platform: platformSchema,
      adAccountId: z.uuid(),
      adAccountName: z.string().nullable(),
      status: trackingRefStatusSchema,
      message: z.string().nullable(),
      messageCode: messageCodeSchema.nullable(),
      messageParams: messageParamsSchema.nullable(),
      goals: z.array(
        z.object({
          goalId: z.uuid(),
          key: z.string(),
          status: trackingRefStatusSchema,
          message: z.string().nullable(),
          messageCode: messageCodeSchema.nullable(),
          messageParams: messageParamsSchema.nullable(),
          biddable: z.boolean(),
        })
      ),
    })
  ),
});

/** TypeScript type inferred from {@link advertiserTrackingSchema}. */
export type AdvertiserTracking = z.infer<typeof advertiserTrackingSchema>;

/** A public tracking key, as the script route accepts it (those given out have 24 characters). */
export const TRACKING_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** Zod schema of the params of `GET /t/:key.js`. */
export const trackingScriptParamsSchema = z.strictObject({
  key: z.string().regex(TRACKING_KEY_PATTERN),
});

/** TypeScript type inferred from {@link trackingScriptParamsSchema}. */
export type TrackingScriptParams = z.infer<typeof trackingScriptParamsSchema>;
