import { z } from 'zod';

import {
  bulkAdGroupResultSchema,
  bulkCreateAdGroupsBodySchema,
  bulkDeletionResultSchema,
  bulkIdsBodySchema,
  bulkUpdateAdGroupsBodySchema,
  adGroupPageSchema,
  adGroupSchema,
  createAdGroupBodySchema,
  deletionResultSchema,
  listAdGroupsQuerySchema,
  organizationArgSchema,
  setLabelsBodySchema,
  updateAdGroupBodySchema,
} from '@src/types';

/** Argument naming the Lever a AdGroup belongs to. */
const leverIdArg = z.uuid().describe('Lever id (from list-levers)');

/** Argument naming a AdGroup. */
const adGroupIdArg = z.uuid().describe('AdGroup id (from list-ad-groups)');

/** Input of `list-ad-groups`. */
export const listAdGroupsInputSchema = listAdGroupsQuerySchema.extend({
  organizationId: organizationArgSchema,
  leverId: leverIdArg,
});

/** TypeScript type inferred from {@link listAdGroupsInputSchema}, after defaults apply. */
export type ListAdGroupsInput = z.infer<typeof listAdGroupsInputSchema>;

/** Input of `get-ad-group`, `delete-ad-group` and `restore-ad-group`. */
export const adGroupInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  adGroupId: adGroupIdArg,
});

/** TypeScript type inferred from {@link adGroupInputSchema}. */
export type AdGroupInput = z.infer<typeof adGroupInputSchema>;

/** Input of `create-ad-group`. */
export const createAdGroupInputSchema = createAdGroupBodySchema.extend({
  organizationId: organizationArgSchema,
  leverId: leverIdArg,
});

/** TypeScript type inferred from {@link createAdGroupInputSchema}. */
export type CreateAdGroupInput = z.infer<typeof createAdGroupInputSchema>;

/** Input of `update-ad-group`. */
export const updateAdGroupInputSchema = updateAdGroupBodySchema.extend({
  organizationId: organizationArgSchema,
  adGroupId: adGroupIdArg,
});

/** TypeScript type inferred from {@link updateAdGroupInputSchema}. */
export type UpdateAdGroupInput = z.infer<typeof updateAdGroupInputSchema>;

/** Input of `set-ad-group-labels`. */
export const setAdGroupLabelsInputSchema = setLabelsBodySchema.extend({
  organizationId: organizationArgSchema,
  adGroupId: adGroupIdArg,
});

/** TypeScript type inferred from {@link setAdGroupLabelsInputSchema}. */
export type SetAdGroupLabelsInput = z.infer<typeof setAdGroupLabelsInputSchema>;

/** Input of `bulk-create-ad-groups`. */
export const bulkCreateAdGroupsInputSchema = bulkCreateAdGroupsBodySchema.extend({
  organizationId: organizationArgSchema,
  leverId: leverIdArg,
});

/** TypeScript type inferred from {@link bulkCreateAdGroupsInputSchema}, after defaults apply. */
export type BulkCreateAdGroupsInput = z.infer<typeof bulkCreateAdGroupsInputSchema>;

/** Input of `bulk-update-ad-groups`. */
export const bulkUpdateAdGroupsInputSchema = bulkUpdateAdGroupsBodySchema.extend({
  organizationId: organizationArgSchema,
});

/** TypeScript type inferred from {@link bulkUpdateAdGroupsInputSchema}, after defaults apply. */
export type BulkUpdateAdGroupsInput = z.infer<typeof bulkUpdateAdGroupsInputSchema>;

/** Input of `bulk-delete-ad-groups` and `bulk-restore-ad-groups`. */
export const bulkAdGroupIdsInputSchema = bulkIdsBodySchema.extend({ organizationId: organizationArgSchema });

/** TypeScript type inferred from {@link bulkAdGroupIdsInputSchema}, after defaults apply. */
export type BulkAdGroupIdsInput = z.infer<typeof bulkAdGroupIdsInputSchema>;

/** MCP tool schema for `list-ad-groups`. */
export const listAdGroupsSchema = {
  title: 'List ad-groups',
  description:
    'List the ad-groups of a lever, filtered by name (search) or by labels (labelIds); includeDeleted also lists the deleted ones',
  inputSchema: listAdGroupsInputSchema,
  outputSchema: adGroupPageSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `get-ad-group`. */
export const getAdGroupSchema = {
  title: 'Get a adGroup',
  description:
    'Get one adGroup, deleted or not, with its budget: what it carries, what it may spend, and the split per platform',
  inputSchema: adGroupInputSchema,
  outputSchema: adGroupSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `create-ad-group`. */
export const createAdGroupSchema = {
  title: 'Create a adGroup',
  description:
    'Create a adGroup under a lever. Its budget (in integer cents), its window and its currency are required: the whole tree below divides that amount and runs in that window. It is born a draft, so nothing reaches a platform. Requires the manager role',
  inputSchema: createAdGroupInputSchema,
  outputSchema: adGroupSchema,
};

/** MCP tool schema for `update-ad-group`. */
export const updateAdGroupSchema = {
  title: 'Update a adGroup',
  description:
    'Change a adGroup; a field left out is left alone. Its status moves with the lifecycle, not here. Requires the manager role',
  inputSchema: updateAdGroupInputSchema,
  outputSchema: adGroupSchema,
};

/** MCP tool schema for `delete-ad-group`. */
export const deleteAdGroupSchema = {
  title: 'Delete a adGroup',
  description:
    'Delete a adGroup **and its whole subtree** — levers, ad groups, targeting groups and lines. restore-ad-group brings back exactly what this deletion took. Requires the manager role',
  inputSchema: adGroupInputSchema,
  outputSchema: deletionResultSchema,
  annotations: { destructiveHint: true },
};

/** MCP tool schema for `restore-ad-group`. */
export const restoreAdGroupSchema = {
  title: 'Restore a adGroup',
  description:
    'Restore a deleted adGroup and the subtree its deletion took with it; anything deleted before stays deleted. Requires the manager role',
  inputSchema: adGroupInputSchema,
  outputSchema: deletionResultSchema,
};

/** MCP tool schema for `set-ad-group-labels`. */
export const setAdGroupLabelsSchema = {
  title: 'Set the labels of a adGroup',
  description:
    'Post the complete set of labels a adGroup carries, replacing what it had (an empty list clears them). Requires the manager role',
  inputSchema: setAdGroupLabelsInputSchema,
  outputSchema: adGroupSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `bulk-create-ad-groups`. */
export const bulkCreateAdGroupsSchema = {
  title: 'Create several ad-groups',
  description:
    'Create up to 200 ad-groups under one advertiser: mode atomic (the default) creates all or nothing, mode partial creates what it can and reports the rest in failed. Requires the manager role',
  inputSchema: bulkCreateAdGroupsInputSchema,
  outputSchema: bulkAdGroupResultSchema,
};

/** MCP tool schema for `bulk-update-ad-groups`. */
export const bulkUpdateAdGroupsSchema = {
  title: 'Update several ad-groups',
  description:
    'Change up to 200 ad-groups at once, each item naming the adGroup it changes: mode atomic (the default) changes all or nothing, mode partial reports what it could not in failed. Requires the manager role',
  inputSchema: bulkUpdateAdGroupsInputSchema,
  outputSchema: bulkAdGroupResultSchema,
};

/** MCP tool schema for `bulk-delete-ad-groups`. */
export const bulkDeleteAdGroupsSchema = {
  title: 'Delete several ad-groups',
  description:
    'Delete up to 200 ad-groups with their subtrees: mode atomic (the default) deletes all or nothing, mode partial reports what it could not in failed. Requires the manager role',
  inputSchema: bulkAdGroupIdsInputSchema,
  outputSchema: bulkDeletionResultSchema,
  annotations: { destructiveHint: true },
};

/** MCP tool schema for `bulk-restore-ad-groups`. */
export const bulkRestoreAdGroupsSchema = {
  title: 'Restore several ad-groups',
  description:
    'Restore up to 200 deleted ad-groups with their subtrees: mode atomic (the default) restores all or nothing, mode partial reports what it could not in failed. Requires the manager role',
  inputSchema: bulkAdGroupIdsInputSchema,
  outputSchema: bulkDeletionResultSchema,
};
