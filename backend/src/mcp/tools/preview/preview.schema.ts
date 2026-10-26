import { z } from 'zod';

import { campaignSchema, organizationArgSchema, previewSchema, setCampaignStatusBodySchema } from '@src/types';

/** Argument naming the campaign the lifecycle acts on. */
const campaignIdArg = z.uuid().describe('Campaign id (from list-campaigns)');

/** Input of `preview-campaign` and `launch-campaign`. */
export const campaignLifecycleInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  campaignId: campaignIdArg,
});

/** TypeScript type inferred from {@link campaignLifecycleInputSchema}. */
export type CampaignLifecycleInput = z.infer<typeof campaignLifecycleInputSchema>;

/** Input of `set-campaign-status`. */
export const setCampaignStatusInputSchema = setCampaignStatusBodySchema.extend({
  organizationId: organizationArgSchema,
  campaignId: campaignIdArg,
});

/** TypeScript type inferred from {@link setCampaignStatusInputSchema}. */
export type SetCampaignStatusInput = z.infer<typeof setCampaignStatusInputSchema>;

/** MCP tool schema for `preview-campaign`. */
export const previewCampaignSchema = {
  title: 'Preview a campaign',
  description:
    'What would be created on each platform, and what is wrong. Read-only and callable at any time: ' +
    'call it before proposing anything. errors block the launch — a missing creative, a brand with no ' +
    'account on a platform, a creative no platform of the lever accepts — while warnings say ' +
    'something will be delivered short: a platform that cannot apply a targeting dimension spends its ' +
    'share without it, and the warning names that amount. Every finding carries a stable code, its ' +
    'values and the node it concerns. Requires the viewer role',
  inputSchema: campaignLifecycleInputSchema,
  outputSchema: previewSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `launch-campaign`. */
export const launchCampaignSchema = {
  title: 'Launch a campaign',
  description:
    'Launch a campaign: refused while the preview reports an error, and the only way out of draft. ' +
    'Check preview-campaign first and fix what it reports. Requires the manager role',
  inputSchema: campaignLifecycleInputSchema,
  outputSchema: campaignSchema,
  annotations: {},
};

/** MCP tool schema for `set-campaign-status`. */
export const setCampaignStatusSchema = {
  title: 'Pause, resume, end or archive a campaign',
  description:
    'Apply a transition of the lifecycle: active ↔ paused, either to ended, ended to archived. A draft ' +
    'is launched, never switched. Requires the manager role',
  inputSchema: setCampaignStatusInputSchema,
  outputSchema: campaignSchema,
  annotations: { idempotentHint: true },
};
