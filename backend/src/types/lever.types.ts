import { z } from 'zod';

/**
 * The levers a campaign buys on: one channel each (`../../CADRAGE.md` § 3 and § 6).
 *
 * A lever appears **at most once per campaign**. The lever is the inventory, never the family of
 * platform: TikTok Search Ads will be `search` on TikTok, not a `social_search` lever.
 */
export const leverSchema = z.enum(['search', 'dooh', 'audio', 'social', 'ctv_tvs', 'dac']);

/** TypeScript type inferred from {@link leverSchema}. */
export type Lever = z.infer<typeof leverSchema>;

/**
 * The levels of the campaign tree, from the campaign down to the line.
 *
 * The same names the label assignments and the budget days use for their `level` column, so one
 * vocabulary covers the whole domain.
 */
export const treeLevelSchema = z.enum(['campaign', 'lever', 'ad_group', 'targeting_group', 'line']);

/** TypeScript type inferred from {@link treeLevelSchema}. */
export type TreeLevel = z.infer<typeof treeLevelSchema>;

/**
 * What a lever profile says about one field at one level (`../../CADRAGE.md` § 5).
 *
 * The distinction between `forbidden` and a `null` value is what makes the whole model work:
 *
 * | Rule        | Meaning                                              | Effective budget?        |
 * | ----------- | ---------------------------------------------------- | ------------------------ |
 * | `required`  | the field must be filled                             | yes, explicit            |
 * | `allowed`   | `null` inherits by division, a value is explicit     | **yes**                  |
 * | `forbidden` | the field must be absent                             | **no, none at all**      |
 *
 * A level that is `allowed` with a `null` value still has an effective budget — its share by
 * division — so it is a candidate to become the budget-carrying object of a platform. A `forbidden`
 * level has none, so it never can.
 */
export const fieldRuleSchema = z.enum(['required', 'allowed', 'forbidden']);

/** TypeScript type inferred from {@link fieldRuleSchema}. */
export type FieldRule = z.infer<typeof fieldRuleSchema>;

/** The fields a lever profile rules on, level by level. */
export const ruledFieldSchema = z.enum(['budget', 'dates', 'capping']);

/** TypeScript type inferred from {@link ruledFieldSchema}. */
export type RuledField = z.infer<typeof ruledFieldSchema>;

/**
 * How a node bids (`leviers.md` L3). The four strategies of the Search are not enough once a
 * campaign carries six levers:
 *
 * - `fixed_cpm` — DV360's `fixedBid`, Amazon's `baseBid`;
 * - `target_cpc` — Demand Gen;
 * - `target_cpcv` — the video and audio form, a cost per completed view;
 * - `maximize_reach` — the awareness form of the programmatic levers;
 * - `from_deal` — **the price comes from the deal**, and no strategy applies.
 *
 * The profile of each lever declares which ones it permits, and its default.
 */
export const bidStrategySchema = z.enum([
  'max_cpc',
  'target_cpc',
  'maximize_clicks',
  'maximize_conversions',
  'cpm',
  'fixed_cpm',
  'target_cpcv',
  'maximize_reach',
  'from_deal',
]);

/** TypeScript type inferred from {@link bidStrategySchema}. */
export type BidStrategy = z.infer<typeof bidStrategySchema>;

/**
 * What an AdGroup is for (`leviers.md` L4, G2).
 *
 * Ours, never a platform's: Meta's ODAX `objective`, TikTok's `objective_type`, Snap's
 * `objective_v2_type`, DV360's `lineItemType` and Amazon's `inventoryType` are each projected from
 * this value by their own adapter. It conditions the bidding strategies available, whether a
 * conversion can be bid on, and sometimes the capping — and it is **immutable once launched**.
 */
export const objectiveSchema = z.enum([
  'awareness',
  'reach',
  'traffic',
  'engagement',
  'video_views',
  'leads',
  'conversions',
  'sales',
  'app_installs',
  'store_visits',
]);

/** TypeScript type inferred from {@link objectiveSchema}. */
export type Objective = z.infer<typeof objectiveSchema>;

/**
 * The unit a budget may be **entered** in, when the profile permits it (`leviers.md` L25).
 *
 * The money stays the truth: the volume is converted through the bid CPM and the **amount** is what
 * is stored. A DOOH or CTV brief is commonly written in impressions or plays, hence this.
 */
export const volumeUnitSchema = z.enum(['impressions', 'plays', 'completions']);

/** TypeScript type inferred from {@link volumeUnitSchema}. */
export type VolumeUnit = z.infer<typeof volumeUnitSchema>;

/**
 * A period a frequency cap counts over (`../../CADRAGE.md` § 4).
 *
 * No multi-unit window ("per 3 days"): some platforms only accept unit periods, and a window we
 * could not express faithfully would become a silent approximation.
 */
export const cappingPeriodSchema = z.enum(['hour', 'day', 'week', 'month', 'lifetime']);

/** TypeScript type inferred from {@link cappingPeriodSchema}. */
export type CappingPeriod = z.infer<typeof cappingPeriodSchema>;

/**
 * Zod schema of one frequency cap: at most `maxImpressions` per `period` and per user.
 *
 * @property maxImpressions - How many impressions one user may see in the period
 * @property period - The period it counts over
 */
export const cappingEntrySchema = z.object({
  maxImpressions: z.number().int().min(1),
  period: cappingPeriodSchema,
});

/** TypeScript type inferred from {@link cappingEntrySchema}. */
export type CappingEntry = z.infer<typeof cappingEntrySchema>;

/**
 * Zod schema of the capping of a node: a **stack** of caps (`leviers.md` L5).
 *
 * "3 a day **and** 10 in all" is an ordinary brief, and a single cap cannot write it. On a node:
 *
 * - `null` — inherits the parent's;
 * - `[]` — **explicitly no cap**, the explicit override of D10;
 * - a non-empty list — the stack, at most one cap per period.
 *
 * What a platform cannot express is the preview's business, not the model's: the degradation engine
 * (most restrictive entry when only one cap fits, visible clamping, named `lifetime` approximation)
 * is written once, in the phase that previews.
 */
export const cappingSchema = z.array(cappingEntrySchema).max(cappingPeriodSchema.options.length);

/** TypeScript type inferred from {@link cappingSchema}. */
export type Capping = z.infer<typeof cappingSchema>;
