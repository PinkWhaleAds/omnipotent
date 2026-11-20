import { z } from 'zod';

import {
  campaignSchema,
  nodeStatusChangeSchema,
  organizationArgSchema,
  previewSchema,
  setCampaignStatusBodySchema,
  setNodeStatusBodySchema,
} from '@src/types';

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

/** Arguments of `set-lever-status`. */
export const setLeverStatusInputSchema = setNodeStatusBodySchema.extend({
  organizationId: organizationArgSchema,
  leverId: z.uuid().describe('Lever id (from get-campaign)'),
});

/** Arguments of `set-ad-group-status`. */
export const setAdGroupStatusInputSchema = setNodeStatusBodySchema.extend({
  organizationId: organizationArgSchema,
  adGroupId: z.uuid().describe('AdGroup id (from list-ad-groups)'),
});

/** Arguments of `set-targeting-group-status`. */
export const setTargetingGroupStatusInputSchema = setNodeStatusBodySchema.extend({
  organizationId: organizationArgSchema,
  targetingGroupId: z.uuid().describe('TargetingGroup id (from list-targeting-groups)'),
});

/** Arguments of `set-line-status`. */
export const setLineStatusInputSchema = setNodeStatusBodySchema.extend({
  organizationId: organizationArgSchema,
  lineId: z.uuid().describe('Line id (from list-lines)'),
});

/** TypeScript type inferred from {@link setLeverStatusInputSchema}. */
export type SetLeverStatusInput = z.infer<typeof setLeverStatusInputSchema>;

/** TypeScript type inferred from {@link setAdGroupStatusInputSchema}. */
export type SetAdGroupStatusInput = z.infer<typeof setAdGroupStatusInputSchema>;

/** TypeScript type inferred from {@link setTargetingGroupStatusInputSchema}. */
export type SetTargetingGroupStatusInput = z.infer<typeof setTargetingGroupStatusInputSchema>;

/** TypeScript type inferred from {@link setLineStatusInputSchema}. */
export type SetLineStatusInput = z.infer<typeof setLineStatusInputSchema>;

/**
 * What every `set-<level>-status` tool says of itself.
 *
 * @param level - The level, as a sentence names it
 * @returns Its title and description
 */
function nodeStatusTool(level: string): { title: string; description: string } {
  return {
    title: `Pause or activate a ${level}`,
    description:
      `Pause or activate one ${level}. A ${level} created in a launched campaign is born paused and ` +
      'reaches no platform until it is activated here. Activating one is refused when its window has ' +
      'ended, and when preview-campaign reports an error on it or under it: fix those first. A node of ' +
      'an ended or archived campaign keeps its status. Requires the manager role',
  };
}

export const setLeverStatusSchema = {
  ...nodeStatusTool('lever'),
  inputSchema: setLeverStatusInputSchema,
  outputSchema: nodeStatusChangeSchema,
  annotations: {},
};

export const setAdGroupStatusSchema = {
  ...nodeStatusTool('AdGroup'),
  inputSchema: setAdGroupStatusInputSchema,
  outputSchema: nodeStatusChangeSchema,
  annotations: {},
};

export const setTargetingGroupStatusSchema = {
  ...nodeStatusTool('TargetingGroup'),
  inputSchema: setTargetingGroupStatusInputSchema,
  outputSchema: nodeStatusChangeSchema,
  annotations: {},
};

export const setLineStatusSchema = {
  ...nodeStatusTool('Line'),
  inputSchema: setLineStatusInputSchema,
  outputSchema: nodeStatusChangeSchema,
  annotations: {},
};
