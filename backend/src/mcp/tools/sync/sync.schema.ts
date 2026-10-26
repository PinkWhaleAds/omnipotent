import { z } from 'zod';

import {
  campaignPlatformStatusSchema,
  organizationArgSchema,
  platformUnitSchema,
  syncRequestedSchema,
} from '@src/types';

/** Argument naming the campaign the synchronization acts on. */
const campaignIdArg = z.uuid().describe('Campaign id (from list-campaigns)');

/** Input of `get-campaign-platform-status` and `sync-campaign`. */
export const campaignSyncInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  campaignId: campaignIdArg,
});

/** TypeScript type inferred from {@link campaignSyncInputSchema}. */
export type CampaignSyncInput = z.infer<typeof campaignSyncInputSchema>;

/** Input of `retry-platform-unit`. */
export const retryPlatformUnitInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  campaignId: campaignIdArg,
  platformUnitId: z.uuid().describe('Unit id (from get-campaign-platform-status)'),
});

/** TypeScript type inferred from {@link retryPlatformUnitInputSchema}. */
export type RetryPlatformUnitInput = z.infer<typeof retryPlatformUnitInputSchema>;

/** MCP tool schema for `get-campaign-platform-status`. */
export const getPlatformStatusSchema = {
  title: 'Where a campaign stands on its platforms',
  description:
    'What exists on each platform for a campaign, and what is still to be created: one entry per ' +
    'couple (AdGroup, platform), with the id of every object over there. A unit in error carries a ' +
    'stable code and its values; when nextAttemptAt is null, trying again cannot help on its own and ' +
    'something has to be fixed first. Read this after launching a campaign, and whenever someone asks ' +
    'whether a change has reached the platforms. Requires the viewer role',
  inputSchema: campaignSyncInputSchema,
  outputSchema: campaignPlatformStatusSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `sync-campaign`. */
export const syncCampaignSchema = {
  title: 'Apply a campaign to its platforms now',
  description:
    'Queue the work of making the platforms match the campaign, and answer at once — the result shows ' +
    'in get-campaign-platform-status. Every change already asks for this on its own, so you rarely ' +
    'need it: it is for when something was changed by hand on a platform. It is safe to call twice, ' +
    'and it sends nothing at all when nothing changed. Requires the manager role',
  inputSchema: campaignSyncInputSchema,
  outputSchema: syncRequestedSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `retry-platform-unit`. */
export const retryPlatformUnitSchema = {
  title: 'Try one unit again',
  description:
    'Try one unit of a campaign again without waiting for its backoff. Use it once what its error ' +
    'named has been fixed. Requires the manager role',
  inputSchema: retryPlatformUnitInputSchema,
  outputSchema: platformUnitSchema,
  annotations: { idempotentHint: true },
};
