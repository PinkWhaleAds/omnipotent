import { z } from 'zod';

import { cappingSchema, volumeUnitSchema } from './lever.types';
import { platformShareSchema } from './platform.types';

/**
 * What the five levels of the campaign tree share: their statuses, the budget they carry, and the
 * budget a reader gets back.
 *
 * A level's own fields live in its own `*.types.ts`; what is here is written once because the
 * Campaign, the Lever, the AdGroup, the TargetingGroup and the Line all answer it.
 */

/**
 * The lifecycle of a campaign (`../../CADRAGE.md` § 13).
 *
 * `draft` is a state of the **campaign alone**: while it is there, nothing is sent to any platform
 * and the campaign is saved permissively — an incomplete campaign is a campaign being written, not
 * an error. The transitions belong to the phase that previews and launches.
 */
export const campaignStatusSchema = z.enum(['draft', 'active', 'paused', 'ended', 'archived']);

/** TypeScript type inferred from {@link campaignStatusSchema}. */
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;

/**
 * The status of a node below the campaign: it delivers, or it does not.
 *
 * A node created inside a launched campaign starts `paused` and reaches no platform until it is
 * activated — which the phase of the lifecycle enforces.
 */
export const nodeStatusSchema = z.enum(['active', 'paused']);

/** TypeScript type inferred from {@link nodeStatusSchema}. */
export type NodeStatus = z.infer<typeof nodeStatusSchema>;

/** Where the effective budget of a node comes from, as the API says it. */
export const budgetSourceSchema = z.enum(['explicit', 'inherited', 'forbidden']);

/**
 * Zod schema of a budget **entered in volume** (L25).
 *
 * The money is the truth: this is kept beside it as the entry that produced it, so the interface can
 * show what the user asked for and recompute the amount if the bid CPM changes.
 *
 * @property amount - How many impressions, plays or completions were asked for
 * @property unit - The unit, which the lever profile permits
 */
export const budgetVolumeSchema = z.object({
  amount: z.number().int().min(1),
  unit: volumeUnitSchema,
});

/** TypeScript type inferred from {@link budgetVolumeSchema}. */
export type BudgetVolume = z.infer<typeof budgetVolumeSchema>;

/**
 * Zod schema of what one platform gets of a node's budget.
 *
 * @property platform - The platform
 * @property shareBasisPoints - Its share of the node, in hundredths of a percent
 * @property cents - What that share comes to, in the campaign currency
 */
export const platformBudgetSchema = platformShareSchema.extend({
  cents: z.number().int().min(0),
});

/**
 * Zod schema of the budget of a node, as every read answers it.
 *
 * The effective amount is **computed at read time**, never stored: a resolved budget is wrong as
 * soon as a sibling changes, and storing it would need a job to catch up — a second source of truth
 * (`../../CADRAGE.md` § 4).
 *
 * @property explicitCents - What the node carries, `null` when it inherits
 * @property effectiveCents - What it may actually spend, explicit or divided
 * @property source - Whether that amount was entered, divided, or cannot exist on this level
 * @property volume - The volume entry that produced the amount, when there was one
 * @property perPlatform - The same amount split by the distribution key resolved at the AdGroup
 */
export const budgetBlockSchema = z.object({
  explicitCents: z.number().int().min(0).nullable(),
  effectiveCents: z.number().int().min(0),
  source: budgetSourceSchema,
  volume: budgetVolumeSchema.nullable(),
  perPlatform: z.array(platformBudgetSchema),
});

/** TypeScript type inferred from {@link budgetBlockSchema}. */
export type BudgetBlock = z.infer<typeof budgetBlockSchema>;

/**
 * Zod schema of the delivery window of a node, as the API answers it.
 *
 * @property startsOn - First day of delivery (`YYYY-MM-DD`), `null` when it follows its parent
 * @property endsOn - Last day of delivery, `null` when it follows its parent
 */
export const windowSchema = z.object({
  startsOn: z.iso.date().nullable(),
  endsOn: z.iso.date().nullable(),
});

/**
 * Zod schema of the capping of a node, as the API answers it: `null` when it inherits its parent's,
 * an empty list when it explicitly has none, a stack otherwise (L5).
 */
export const nodeCappingSchema = cappingSchema.nullable();
