import { z } from 'zod';

import { messageCodeSchema, messageParamsSchema } from './error.types';
import { leverSchema, treeLevelSchema } from './lever.types';
import { platformObjectSchema } from './preview.types';
import { platformSchema } from './platform.types';

/**
 * Where a unit stands with its platform.
 *
 * `pending` is the **dirty bit** of `../../CADRAGE.md` § 14: it is written in the same transaction as
 * the modification that caused it, so it survives a worker dying, a deploy, anything. `error` carries
 * a code and, when the failure was temporary, the time of the next attempt.
 */
export const syncStateSchema = z.enum(['pending', 'synced', 'error']);

/** TypeScript type inferred from {@link syncStateSchema}. */
export type SyncState = z.infer<typeof syncStateSchema>;

/**
 * Zod schema of one object a platform holds for us.
 *
 * The `key` is how the engine and the adapter name it on both sides: `<level>:<nodeId>` for an object
 * of the tree, `keyword:<id>` for a keyword. The split of `../../CADRAGE.md` § 7 needs nothing more —
 * several keys simply name several objects of the same platform level.
 *
 * @property key - Its key in the unit's map of external ids
 * @property level - The level of ours it comes from
 * @property nodeId - The node of ours it comes from; for a keyword, the node it hangs from
 * @property keywordId - The keyword it **is**, `null` for every other object
 * @property object - What it is in the platform's own words
 * @property externalId - Its id over there, `null` until it was created
 */
export const platformObjectRefSchema = z.object({
  key: z.string(),
  level: treeLevelSchema,
  nodeId: z.uuid(),
  keywordId: z.uuid().nullable(),
  object: platformObjectSchema,
  externalId: z.string().nullable(),
});

/** TypeScript type inferred from {@link platformObjectRefSchema}. */
export type PlatformObjectRef = z.infer<typeof platformObjectRefSchema>;

/**
 * Zod schema of one unit of synchronisation, as the API returns it.
 *
 * A unit is the couple **(AdGroup, platform)**: what the platform treats as a whole, and what one
 * call of an adapter applies (`docs/phase-9.md` § 2).
 *
 * @property id - Its id, which the retry route takes
 * @property platform - The platform
 * @property lever - The lever its AdGroup buys on
 * @property adGroupId - Our AdGroup
 * @property adAccountId - The account the brand buys on
 * @property currency - The account's currency
 * @property fxRate - Units of the account currency for one of the campaign currency, frozen (D22)
 * @property state - Where it stands
 * @property objects - What exists over there, or is still to be created
 * @property attempts - Failed attempts in a row
 * @property nextAttemptAt - When a temporary failure will be tried again, `null` otherwise
 * @property lastAttemptAt - When it was last tried, whatever the outcome
 * @property lastSyncedAt - When it was last applied successfully
 * @property errorCode - Stable code of the last failure, `null` when the platform's own text had none
 * @property errorParams - The values of that message
 * @property errorMessage - The last failure, as it was worded
 */
export const platformUnitSchema = z.object({
  id: z.uuid(),
  platform: platformSchema,
  lever: leverSchema,
  adGroupId: z.uuid(),
  adAccountId: z.uuid(),
  currency: z.string(),
  fxRate: z.number(),
  state: syncStateSchema,
  objects: z.array(platformObjectRefSchema),
  attempts: z.number().int(),
  nextAttemptAt: z.iso.datetime().nullable(),
  lastAttemptAt: z.iso.datetime().nullable(),
  lastSyncedAt: z.iso.datetime().nullable(),
  errorCode: messageCodeSchema.nullable(),
  errorParams: messageParamsSchema.nullable(),
  errorMessage: z.string().nullable(),
});

/** TypeScript type inferred from {@link platformUnitSchema}. */
export type PlatformUnitView = z.infer<typeof platformUnitSchema>;

/**
 * Zod schema of where a campaign stands on its platforms.
 *
 * @property campaignId - The campaign
 * @property units - One per couple (AdGroup, platform), sorted by platform then AdGroup
 * @property pending - How many units still have something to apply (`pending` or `error`)
 */
export const campaignPlatformStatusSchema = z.object({
  campaignId: z.uuid(),
  units: z.array(platformUnitSchema),
  pending: z.number().int().min(0),
});

/** TypeScript type inferred from {@link campaignPlatformStatusSchema}. */
export type CampaignPlatformStatus = z.infer<typeof campaignPlatformStatusSchema>;

/**
 * Zod schema of the answer to a sync request.
 *
 * A request is a **demand, not a result**: the job runs in the background, and the status route says
 * where it got to.
 *
 * @property campaignId - The campaign
 * @property units - How many units were marked to be applied again
 */
export const syncRequestedSchema = z.object({
  campaignId: z.uuid(),
  units: z.number().int().min(0),
});

/** TypeScript type inferred from {@link syncRequestedSchema}. */
export type SyncRequested = z.infer<typeof syncRequestedSchema>;

/** Zod schema of the params of a route naming one unit of a campaign. */
export const platformUnitParamsSchema = z.strictObject({
  id: z.uuid(),
  unitId: z.uuid(),
});

/** TypeScript type inferred from {@link platformUnitParamsSchema}. */
export type PlatformUnitParams = z.infer<typeof platformUnitParamsSchema>;
