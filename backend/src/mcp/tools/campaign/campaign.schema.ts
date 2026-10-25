import { z } from 'zod';

import {
  bulkCampaignResultSchema,
  bulkCreateCampaignsBodySchema,
  bulkDeletionResultSchema,
  bulkIdsBodySchema,
  bulkUpdateCampaignsBodySchema,
  campaignPageSchema,
  campaignSchema,
  createCampaignBodySchema,
  deletionResultSchema,
  listCampaignsQuerySchema,
  organizationArgSchema,
  setLabelsBodySchema,
  updateCampaignBodySchema,
} from '@src/types';

/** Argument naming the Advertiser a Campaign belongs to. */
const advertiserIdArg = z.uuid().describe('Advertiser id (from list-advertisers)');

/** Argument naming a Campaign. */
const campaignIdArg = z.uuid().describe('Campaign id (from list-campaigns)');

/** Input of `list-campaigns`. */
export const listCampaignsInputSchema = listCampaignsQuerySchema.extend({
  organizationId: organizationArgSchema,
  advertiserId: advertiserIdArg,
});

/** TypeScript type inferred from {@link listCampaignsInputSchema}, after defaults apply. */
export type ListCampaignsInput = z.infer<typeof listCampaignsInputSchema>;

/** Input of `get-campaign`, `delete-campaign` and `restore-campaign`. */
export const campaignInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  campaignId: campaignIdArg,
});

/** TypeScript type inferred from {@link campaignInputSchema}. */
export type CampaignInput = z.infer<typeof campaignInputSchema>;

/** Input of `create-campaign`. */
export const createCampaignInputSchema = createCampaignBodySchema.extend({
  organizationId: organizationArgSchema,
  advertiserId: advertiserIdArg,
});

/** TypeScript type inferred from {@link createCampaignInputSchema}. */
export type CreateCampaignInput = z.infer<typeof createCampaignInputSchema>;

/** Input of `update-campaign`. */
export const updateCampaignInputSchema = updateCampaignBodySchema.extend({
  organizationId: organizationArgSchema,
  campaignId: campaignIdArg,
});

/** TypeScript type inferred from {@link updateCampaignInputSchema}. */
export type UpdateCampaignInput = z.infer<typeof updateCampaignInputSchema>;

/** Input of `set-campaign-labels`. */
export const setCampaignLabelsInputSchema = setLabelsBodySchema.extend({
  organizationId: organizationArgSchema,
  campaignId: campaignIdArg,
});

/** TypeScript type inferred from {@link setCampaignLabelsInputSchema}. */
export type SetCampaignLabelsInput = z.infer<typeof setCampaignLabelsInputSchema>;

/** Input of `bulk-create-campaigns`. */
export const bulkCreateCampaignsInputSchema = bulkCreateCampaignsBodySchema.extend({
  organizationId: organizationArgSchema,
  advertiserId: advertiserIdArg,
});

/** TypeScript type inferred from {@link bulkCreateCampaignsInputSchema}, after defaults apply. */
export type BulkCreateCampaignsInput = z.infer<typeof bulkCreateCampaignsInputSchema>;

/** Input of `bulk-update-campaigns`. */
export const bulkUpdateCampaignsInputSchema = bulkUpdateCampaignsBodySchema.extend({
  organizationId: organizationArgSchema,
});

/** TypeScript type inferred from {@link bulkUpdateCampaignsInputSchema}, after defaults apply. */
export type BulkUpdateCampaignsInput = z.infer<typeof bulkUpdateCampaignsInputSchema>;

/** Input of `bulk-delete-campaigns` and `bulk-restore-campaigns`. */
export const bulkCampaignIdsInputSchema = bulkIdsBodySchema.extend({ organizationId: organizationArgSchema });

/** TypeScript type inferred from {@link bulkCampaignIdsInputSchema}, after defaults apply. */
export type BulkCampaignIdsInput = z.infer<typeof bulkCampaignIdsInputSchema>;

/** MCP tool schema for `list-campaigns`. */
export const listCampaignsSchema = {
  title: 'List campaigns',
  description:
    'List the campaigns of an advertiser, filtered by name (search) or by labels (labelIds); includeDeleted also lists the deleted ones',
  inputSchema: listCampaignsInputSchema,
  outputSchema: campaignPageSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `get-campaign`. */
export const getCampaignSchema = {
  title: 'Get a campaign',
  description:
    'Get one campaign, deleted or not, with its budget: what it carries, what it may spend, and the split per platform',
  inputSchema: campaignInputSchema,
  outputSchema: campaignSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `create-campaign`. */
export const createCampaignSchema = {
  title: 'Create a campaign',
  description:
    'Create a campaign under an advertiser. Its budget (in integer cents), its window and its currency are required: the whole tree below divides that amount and runs in that window. It is born a draft, so nothing reaches a platform. Requires the manager role',
  inputSchema: createCampaignInputSchema,
  outputSchema: campaignSchema,
};

/** MCP tool schema for `update-campaign`. */
export const updateCampaignSchema = {
  title: 'Update a campaign',
  description:
    'Change a campaign; a field left out is left alone. Its status moves with the lifecycle, not here. Requires the manager role',
  inputSchema: updateCampaignInputSchema,
  outputSchema: campaignSchema,
};

/** MCP tool schema for `delete-campaign`. */
export const deleteCampaignSchema = {
  title: 'Delete a campaign',
  description:
    'Delete a campaign **and its whole subtree** — levers, ad groups, targeting groups and lines. restore-campaign brings back exactly what this deletion took. Requires the manager role',
  inputSchema: campaignInputSchema,
  outputSchema: deletionResultSchema,
  annotations: { destructiveHint: true },
};

/** MCP tool schema for `restore-campaign`. */
export const restoreCampaignSchema = {
  title: 'Restore a campaign',
  description:
    'Restore a deleted campaign and the subtree its deletion took with it; anything deleted before stays deleted. Requires the manager role',
  inputSchema: campaignInputSchema,
  outputSchema: deletionResultSchema,
};

/** MCP tool schema for `set-campaign-labels`. */
export const setCampaignLabelsSchema = {
  title: 'Set the labels of a campaign',
  description:
    'Post the complete set of labels a campaign carries, replacing what it had (an empty list clears them). Requires the manager role',
  inputSchema: setCampaignLabelsInputSchema,
  outputSchema: campaignSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `bulk-create-campaigns`. */
export const bulkCreateCampaignsSchema = {
  title: 'Create several campaigns',
  description:
    'Create up to 200 campaigns under one advertiser: mode atomic (the default) creates all or nothing, mode partial creates what it can and reports the rest in failed. Requires the manager role',
  inputSchema: bulkCreateCampaignsInputSchema,
  outputSchema: bulkCampaignResultSchema,
};

/** MCP tool schema for `bulk-update-campaigns`. */
export const bulkUpdateCampaignsSchema = {
  title: 'Update several campaigns',
  description:
    'Change up to 200 campaigns at once, each item naming the campaign it changes: mode atomic (the default) changes all or nothing, mode partial reports what it could not in failed. Requires the manager role',
  inputSchema: bulkUpdateCampaignsInputSchema,
  outputSchema: bulkCampaignResultSchema,
};

/** MCP tool schema for `bulk-delete-campaigns`. */
export const bulkDeleteCampaignsSchema = {
  title: 'Delete several campaigns',
  description:
    'Delete up to 200 campaigns with their subtrees: mode atomic (the default) deletes all or nothing, mode partial reports what it could not in failed. Requires the manager role',
  inputSchema: bulkCampaignIdsInputSchema,
  outputSchema: bulkDeletionResultSchema,
  annotations: { destructiveHint: true },
};

/** MCP tool schema for `bulk-restore-campaigns`. */
export const bulkRestoreCampaignsSchema = {
  title: 'Restore several campaigns',
  description:
    'Restore up to 200 deleted campaigns with their subtrees: mode atomic (the default) restores all or nothing, mode partial reports what it could not in failed. Requires the manager role',
  inputSchema: bulkCampaignIdsInputSchema,
  outputSchema: bulkDeletionResultSchema,
};
