import { z } from 'zod';

import {
  bulkTargetingGroupResultSchema,
  bulkCreateTargetingGroupsBodySchema,
  bulkDeletionResultSchema,
  bulkIdsBodySchema,
  bulkUpdateTargetingGroupsBodySchema,
  targetingGroupPageSchema,
  targetingGroupSchema,
  createTargetingGroupBodySchema,
  deletionResultSchema,
  listTargetingGroupsQuerySchema,
  organizationArgSchema,
  setLabelsBodySchema,
  updateTargetingGroupBodySchema,
} from '@src/types';

/** Argument naming the AdGroup a TargetingGroup belongs to. */
const adGroupIdArg = z.uuid().describe('AdGroup id (from list-ad-groups)');

/** Argument naming a TargetingGroup. */
const targetingGroupIdArg = z.uuid().describe('TargetingGroup id (from list-targeting-groups)');

/** Input of `list-targeting-groups`. */
export const listTargetingGroupsInputSchema = listTargetingGroupsQuerySchema.extend({
  organizationId: organizationArgSchema,
  adGroupId: adGroupIdArg,
});

/** TypeScript type inferred from {@link listTargetingGroupsInputSchema}, after defaults apply. */
export type ListTargetingGroupsInput = z.infer<typeof listTargetingGroupsInputSchema>;

/** Input of `get-targeting-group`, `delete-targeting-group` and `restore-targeting-group`. */
export const targetingGroupInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  targetingGroupId: targetingGroupIdArg,
});

/** TypeScript type inferred from {@link targetingGroupInputSchema}. */
export type TargetingGroupInput = z.infer<typeof targetingGroupInputSchema>;

/** Input of `create-targeting-group`. */
export const createTargetingGroupInputSchema = createTargetingGroupBodySchema.extend({
  organizationId: organizationArgSchema,
  adGroupId: adGroupIdArg,
});

/** TypeScript type inferred from {@link createTargetingGroupInputSchema}. */
export type CreateTargetingGroupInput = z.infer<typeof createTargetingGroupInputSchema>;

/** Input of `update-targeting-group`. */
export const updateTargetingGroupInputSchema = updateTargetingGroupBodySchema.extend({
  organizationId: organizationArgSchema,
  targetingGroupId: targetingGroupIdArg,
});

/** TypeScript type inferred from {@link updateTargetingGroupInputSchema}. */
export type UpdateTargetingGroupInput = z.infer<typeof updateTargetingGroupInputSchema>;

/** Input of `set-targeting-group-labels`. */
export const setTargetingGroupLabelsInputSchema = setLabelsBodySchema.extend({
  organizationId: organizationArgSchema,
  targetingGroupId: targetingGroupIdArg,
});

/** TypeScript type inferred from {@link setTargetingGroupLabelsInputSchema}. */
export type SetTargetingGroupLabelsInput = z.infer<typeof setTargetingGroupLabelsInputSchema>;

/** Input of `bulk-create-targeting-groups`. */
export const bulkCreateTargetingGroupsInputSchema = bulkCreateTargetingGroupsBodySchema.extend({
  organizationId: organizationArgSchema,
  adGroupId: adGroupIdArg,
});

/** TypeScript type inferred from {@link bulkCreateTargetingGroupsInputSchema}, after defaults apply. */
export type BulkCreateTargetingGroupsInput = z.infer<typeof bulkCreateTargetingGroupsInputSchema>;

/** Input of `bulk-update-targeting-groups`. */
export const bulkUpdateTargetingGroupsInputSchema = bulkUpdateTargetingGroupsBodySchema.extend({
  organizationId: organizationArgSchema,
});

/** TypeScript type inferred from {@link bulkUpdateTargetingGroupsInputSchema}, after defaults apply. */
export type BulkUpdateTargetingGroupsInput = z.infer<typeof bulkUpdateTargetingGroupsInputSchema>;

/** Input of `bulk-delete-targeting-groups` and `bulk-restore-targeting-groups`. */
export const bulkTargetingGroupIdsInputSchema = bulkIdsBodySchema.extend({ organizationId: organizationArgSchema });

/** TypeScript type inferred from {@link bulkTargetingGroupIdsInputSchema}, after defaults apply. */
export type BulkTargetingGroupIdsInput = z.infer<typeof bulkTargetingGroupIdsInputSchema>;

/** MCP tool schema for `list-targeting-groups`. */
export const listTargetingGroupsSchema = {
  title: 'List targeting-groups',
  description:
    'List the targeting-groups of a adGroup, filtered by name (search) or by labels (labelIds); includeDeleted also lists the deleted ones',
  inputSchema: listTargetingGroupsInputSchema,
  outputSchema: targetingGroupPageSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `get-targeting-group`. */
export const getTargetingGroupSchema = {
  title: 'Get a targetingGroup',
  description:
    'Get one targetingGroup, deleted or not, with its budget: what it carries, what it may spend, and the split per platform',
  inputSchema: targetingGroupInputSchema,
  outputSchema: targetingGroupSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `create-targeting-group`. */
export const createTargetingGroupSchema = {
  title: 'Create a targetingGroup',
  description:
    'Create a targetingGroup under a adGroup. Its budget (in integer cents), its window and its currency are required: the whole tree below divides that amount and runs in that window. It is born a draft, so nothing reaches a platform. Requires the manager role',
  inputSchema: createTargetingGroupInputSchema,
  outputSchema: targetingGroupSchema,
};

/** MCP tool schema for `update-targeting-group`. */
export const updateTargetingGroupSchema = {
  title: 'Update a targetingGroup',
  description:
    'Change a targetingGroup; a field left out is left alone. Its status moves with the lifecycle, not here. Requires the manager role',
  inputSchema: updateTargetingGroupInputSchema,
  outputSchema: targetingGroupSchema,
};

/** MCP tool schema for `delete-targeting-group`. */
export const deleteTargetingGroupSchema = {
  title: 'Delete a targetingGroup',
  description:
    'Delete a targetingGroup **and its whole subtree** — levers, ad groups, targeting groups and lines. restore-targeting-group brings back exactly what this deletion took. Requires the manager role',
  inputSchema: targetingGroupInputSchema,
  outputSchema: deletionResultSchema,
  annotations: { destructiveHint: true },
};

/** MCP tool schema for `restore-targeting-group`. */
export const restoreTargetingGroupSchema = {
  title: 'Restore a targetingGroup',
  description:
    'Restore a deleted targetingGroup and the subtree its deletion took with it; anything deleted before stays deleted. Requires the manager role',
  inputSchema: targetingGroupInputSchema,
  outputSchema: deletionResultSchema,
};

/** MCP tool schema for `set-targeting-group-labels`. */
export const setTargetingGroupLabelsSchema = {
  title: 'Set the labels of a targetingGroup',
  description:
    'Post the complete set of labels a targetingGroup carries, replacing what it had (an empty list clears them). Requires the manager role',
  inputSchema: setTargetingGroupLabelsInputSchema,
  outputSchema: targetingGroupSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `bulk-create-targeting-groups`. */
export const bulkCreateTargetingGroupsSchema = {
  title: 'Create several targeting-groups',
  description:
    'Create up to 200 targeting-groups under one advertiser: mode atomic (the default) creates all or nothing, mode partial creates what it can and reports the rest in failed. Requires the manager role',
  inputSchema: bulkCreateTargetingGroupsInputSchema,
  outputSchema: bulkTargetingGroupResultSchema,
};

/** MCP tool schema for `bulk-update-targeting-groups`. */
export const bulkUpdateTargetingGroupsSchema = {
  title: 'Update several targeting-groups',
  description:
    'Change up to 200 targeting-groups at once, each item naming the targetingGroup it changes: mode atomic (the default) changes all or nothing, mode partial reports what it could not in failed. Requires the manager role',
  inputSchema: bulkUpdateTargetingGroupsInputSchema,
  outputSchema: bulkTargetingGroupResultSchema,
};

/** MCP tool schema for `bulk-delete-targeting-groups`. */
export const bulkDeleteTargetingGroupsSchema = {
  title: 'Delete several targeting-groups',
  description:
    'Delete up to 200 targeting-groups with their subtrees: mode atomic (the default) deletes all or nothing, mode partial reports what it could not in failed. Requires the manager role',
  inputSchema: bulkTargetingGroupIdsInputSchema,
  outputSchema: bulkDeletionResultSchema,
  annotations: { destructiveHint: true },
};

/** MCP tool schema for `bulk-restore-targeting-groups`. */
export const bulkRestoreTargetingGroupsSchema = {
  title: 'Restore several targeting-groups',
  description:
    'Restore up to 200 deleted targeting-groups with their subtrees: mode atomic (the default) restores all or nothing, mode partial reports what it could not in failed. Requires the manager role',
  inputSchema: bulkTargetingGroupIdsInputSchema,
  outputSchema: bulkDeletionResultSchema,
};
