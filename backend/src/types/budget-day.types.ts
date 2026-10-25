import { z } from 'zod';

import { treeLevelSchema } from './lever.types';

/**
 * The daily curve of a node: one day, one amount (`../../CADRAGE.md` § 4).
 *
 * Amounts are in **integer cents**, as everywhere else in this API — multi-search exposed them in
 * currency units, and the conversion at the edge was a source of rounding nobody needed.
 */

/** Longest period a curve may cover: two years, as multi-search caps it. */
export const MAX_CURVE_DAYS = 731;

/** Weight of a weekend day in the `weekend_boost` preset when none is given. */
export const DEFAULT_WEEKEND_FACTOR = 1.5;

/**
 * The days of the week, as a caller names them.
 *
 * `selected_days` uses them to say which days deliver: « pas de samedi » is a weekday list without
 * `saturday`, and the days left out go to **0**, which pauses the node that day.
 */
export const weekdaySchema = z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);

/** TypeScript type inferred from {@link weekdaySchema}. */
export type Weekday = z.infer<typeof weekdaySchema>;

/**
 * The shapes a curve can be given.
 *
 * - `flat` — every day equal, the default;
 * - `weekend_boost` — a Saturday and a Sunday weigh `factor` times a weekday;
 * - `ramp_up` — the first quarter of the period climbs, the rest is flat;
 * - `selected_days` — only the weekdays named deliver, the others go to 0.
 */
export const budgetPresetSchema = z.enum(['flat', 'weekend_boost', 'ramp_up', 'selected_days']);

/** TypeScript type inferred from {@link budgetPresetSchema}. */
export type BudgetPreset = z.infer<typeof budgetPresetSchema>;

/**
 * Zod schema of one day of a curve, as the API answers it.
 *
 * @property day - `YYYY-MM-DD`, in the timezone of the campaign
 * @property cents - What the day may spend; **0 is a value**, and pauses delivery that day
 * @property locked - Whether the day keeps its amount when the others are recalculated
 * @property weekend - Whether it is a Saturday or a Sunday, so an interface can show it
 */
export const budgetDaySchema = z.object({
  day: z.iso.date(),
  cents: z.number().int().min(0),
  locked: z.boolean(),
  weekend: z.boolean(),
});

/** TypeScript type inferred from {@link budgetDaySchema}. */
export type BudgetDay = z.infer<typeof budgetDaySchema>;

/**
 * Zod schema of the curve of a node.
 *
 * @property level - The level of the node
 * @property nodeId - The node
 * @property source - `own` when the node carries its own curve, `inherited` when it follows the
 *   shape of its parent pro rata — which is what a node with no explicit budget does
 * @property totalCents - What the days add up to, which is the node's effective budget
 * @property days - The days, in order
 */
export const budgetCurveSchema = z.object({
  level: treeLevelSchema,
  nodeId: z.uuid(),
  source: z.enum(['own', 'inherited']),
  totalCents: z.number().int().min(0),
  days: z.array(budgetDaySchema),
});

/** TypeScript type inferred from {@link budgetCurveSchema}. */
export type BudgetCurve = z.infer<typeof budgetCurveSchema>;

/**
 * Zod schema of the body editing days of a curve.
 *
 * A day named here is **pinned**: it keeps what the caller gave it, and the free days absorb the
 * difference. A day already past may be listed, but not changed.
 *
 * @property days - The days to change, each with an amount, a lock, or both
 */
export const updateBudgetDaysBodySchema = z.strictObject({
  days: z
    .array(
      z.strictObject({
        day: z.iso.date(),
        cents: z.number().int().min(0).optional(),
        locked: z.boolean().optional(),
      })
    )
    .min(1)
    .max(MAX_CURVE_DAYS),
});

/** TypeScript type inferred from {@link updateBudgetDaysBodySchema}. */
export type UpdateBudgetDaysBody = z.infer<typeof updateBudgetDaysBodySchema>;

/**
 * Zod schema of the body applying a shape to a curve.
 *
 * Two ways of saying a day must not deliver, and they compose:
 *
 * - `weekdays`, with the `selected_days` shape — « pas le samedi », which holds for the whole period;
 * - `excludedDays`, with **any** shape — « pas le 26 octobre », a named day whatever its weekday.
 *
 * Both put the day at **0**, which pauses the node that day. `selected_days` needs its list: a shape
 * that delivers on nothing would be a budget nobody can spend, so it is required there and refused
 * elsewhere.
 */
export const applyBudgetPresetBodySchema = z
  .strictObject({
    preset: budgetPresetSchema,
    factor: z.number().min(0.1).max(10).optional(),
    weekdays: z.array(weekdaySchema).min(1).optional(),
    excludedDays: z.array(z.iso.date()).min(1).max(MAX_CURVE_DAYS).optional(),
  })
  .refine(
    (body): boolean => (body.preset === 'selected_days') === (body.weekdays !== undefined),
    'weekdays is required by the selected_days preset, and meaningless for the others'
  );

/** TypeScript type inferred from {@link applyBudgetPresetBodySchema}. */
export type ApplyBudgetPresetBody = z.infer<typeof applyBudgetPresetBodySchema>;

/**
 * Where the spend of a node stands against its plan.
 *
 * - `on_track` — within 10 % of what the curve planned up to yesterday;
 * - `underspending` / `overspending` — further away than that;
 * - `budget_reached` — the planned total is spent, and delivery stops.
 */
export const pacingStatusSchema = z.enum(['on_track', 'underspending', 'overspending', 'budget_reached']);

/** TypeScript type inferred from {@link pacingStatusSchema}. */
export type PacingStatus = z.infer<typeof pacingStatusSchema>;

/**
 * Zod schema of the pacing of a node, for the current day.
 *
 * @property plannedCents - The total the curve plans
 * @property plannedToDateCents - What it planned up to yesterday included
 * @property remainingCents - Planned minus spent before today, never below zero
 * @property todayCents - What to spend today: the remainder spread over the days left, keeping the
 *   shape of the curve
 * @property budgetReached - Whether the planned total is spent
 * @property status - Where the spend stands
 */
export const pacingSchema = z.object({
  plannedCents: z.number().int().min(0),
  plannedToDateCents: z.number().int().min(0),
  remainingCents: z.number().int().min(0),
  todayCents: z.number().int().min(0),
  budgetReached: z.boolean(),
  status: pacingStatusSchema,
});

/** TypeScript type inferred from {@link pacingSchema}. */
export type Pacing = z.infer<typeof pacingSchema>;
