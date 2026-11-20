import { z } from 'zod';

import { leverSchema, treeLevelSchema } from './lever.types';
import { messageCodeSchema, messageParamsSchema } from './error.types';
import { platformSchema } from './platform.types';
import { campaignStatusSchema, nodeStatusSchema } from './tree.types';

/**
 * What one of our levels becomes on a platform (`../../CADRAGE.md` § 7).
 *
 * The vocabulary is the platforms' own, because the preview answers in **their** words: a front that
 * says « three Google campaigns instead of one » is saying what the user will see over there.
 */
export const platformObjectSchema = z.enum([
  'media_plan',
  'insertion_order',
  'campaign',
  'order',
  'ad_group',
  'line_item',
  'ad',
  'creative',
  'line',
  'keyword',
]);

/** TypeScript type inferred from {@link platformObjectSchema}. */
export type PlatformObject = z.infer<typeof platformObjectSchema>;

/**
 * Zod schema of a finding of the preview.
 *
 * An **error** blocks the launch; a **warning** says something will be delivered short. Both carry a
 * stable code and its values, which the French front translates (`docs/error-codes.md`), plus the
 * node they concern when they concern one.
 *
 * @property code - Stable code of the finding
 * @property params - The values of its message
 * @property level - The level of the node at fault, `null` for a finding about the campaign itself
 * @property nodeId - That node, `null` likewise
 * @property platform - The platform it concerns, `null` when it concerns every one of them
 */
export const previewFindingSchema = z.object({
  code: messageCodeSchema,
  params: messageParamsSchema,
  level: treeLevelSchema.nullable(),
  nodeId: z.uuid().nullable(),
  platform: platformSchema.nullable(),
});

/** TypeScript type inferred from {@link previewFindingSchema}. */
export type PreviewFinding = z.infer<typeof previewFindingSchema>;

/**
 * Zod schema of what one platform of one lever will receive.
 *
 * @property platform - The platform
 * @property lever - The lever it serves here
 * @property adAccountId - The account the brand buys on, `null` when none is linked
 * @property accountCurrency - That account's currency, `null` likewise
 * @property fxRate - Units of the account's currency for one of the campaign's; `null` until a rate
 *   service exists (D22 freezes it at launch), the field being in the contract from the start
 * @property effectiveCents - What this platform receives of the campaign budget, its share applied
 * @property objects - How many objects of each kind will be created there; a kind it creates none of
 *   is simply absent
 */
export const platformPreviewSchema = z.object({
  platform: platformSchema,
  lever: leverSchema,
  adAccountId: z.uuid().nullable(),
  accountCurrency: z.string().nullable(),
  fxRate: z.number().nullable(),
  effectiveCents: z.number().int().min(0),
  objects: z.partialRecord(platformObjectSchema, z.number().int().min(0)),
});

/** TypeScript type inferred from {@link platformPreviewSchema}. */
export type PlatformPreview = z.infer<typeof platformPreviewSchema>;

/**
 * Zod schema of what a preview answers.
 *
 * @property campaignId - The campaign it looked at
 * @property status - Where that campaign stands
 * @property launchable - Exactly « no error »; a warning never blocks
 * @property platforms - What each platform of each lever will receive
 * @property errors - What must be fixed before launching
 * @property warnings - What will be delivered short
 */
export const previewSchema = z.object({
  campaignId: z.uuid(),
  status: campaignStatusSchema,
  launchable: z.boolean(),
  platforms: z.array(platformPreviewSchema),
  errors: z.array(previewFindingSchema),
  warnings: z.array(previewFindingSchema),
});

/** TypeScript type inferred from {@link previewSchema}. */
export type Preview = z.infer<typeof previewSchema>;

/**
 * Zod schema of the body applying a transition of the campaign lifecycle.
 *
 * `active` is absent on purpose when the campaign is a draft: a campaign is not launched by changing
 * a field, it is launched by passing the preview (`docs/phase-8.md` § 4).
 *
 * @property status - Where the campaign goes
 */
export const setCampaignStatusBodySchema = z.strictObject({
  status: campaignStatusSchema.exclude(['draft']),
});

/** TypeScript type inferred from {@link setCampaignStatusBodySchema}. */
export type SetCampaignStatusBody = z.infer<typeof setCampaignStatusBodySchema>;

/** The levels below the campaign, whose status is set on its own (`docs/phase-10.md` § 8.4). */
export const nodeLevelSchema = treeLevelSchema.exclude(['campaign']);

/** TypeScript type inferred from {@link nodeLevelSchema}. */
export type NodeLevel = z.infer<typeof nodeLevelSchema>;

/**
 * Zod schema of the body pausing or activating one node.
 *
 * @property status - What it becomes
 */
export const setNodeStatusBodySchema = z.strictObject({
  status: nodeStatusSchema,
});

/** TypeScript type inferred from {@link setNodeStatusBodySchema}. */
export type SetNodeStatusBody = z.infer<typeof setNodeStatusBodySchema>;

/**
 * Zod schema of a node whose status was set.
 *
 * @property level - Its level
 * @property id - Its id
 * @property campaignId - Its campaign
 * @property status - Its status now
 */
export const nodeStatusChangeSchema = z.object({
  level: nodeLevelSchema,
  id: z.uuid(),
  campaignId: z.uuid(),
  status: nodeStatusSchema,
});

/** TypeScript type inferred from {@link nodeStatusChangeSchema}. */
export type NodeStatusChange = z.infer<typeof nodeStatusChangeSchema>;
