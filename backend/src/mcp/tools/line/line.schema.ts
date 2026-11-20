import { z } from 'zod';

import {
  bulkLineResultSchema,
  bulkCreateLinesBodySchema,
  bulkDeletionResultSchema,
  bulkIdsBodySchema,
  bulkUpdateLinesBodySchema,
  creativeLinePageSchema,
  linePageSchema,
  lineSchema,
  createLineBodySchema,
  deletionResultSchema,
  listLinesQuerySchema,
  organizationArgSchema,
  setLabelsBodySchema,
  updateLineBodySchema,
} from '@src/types';

/** Argument naming the TargetingGroup a Line belongs to. */
const targetingGroupIdArg = z.uuid().describe('TargetingGroup id (from list-targeting-groups)');

/** Argument naming a Line. */
const lineIdArg = z.uuid().describe('Line id (from list-lines)');

/** Input of `list-lines`. */
export const listLinesInputSchema = listLinesQuerySchema.extend({
  organizationId: organizationArgSchema,
  targetingGroupId: targetingGroupIdArg,
});

/** TypeScript type inferred from {@link listLinesInputSchema}, after defaults apply. */
export type ListLinesInput = z.infer<typeof listLinesInputSchema>;

/** Input of `list-creative-lines`. */
export const listCreativeLinesInputSchema = listLinesQuerySchema.extend({
  organizationId: organizationArgSchema,
  creativeId: z.uuid().describe('Creative id (from list-creatives)'),
});

/** TypeScript type inferred from {@link listCreativeLinesInputSchema}, after defaults apply. */
export type ListCreativeLinesInput = z.infer<typeof listCreativeLinesInputSchema>;

/** Input of `get-line`, `delete-line` and `restore-line`. */
export const lineInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  lineId: lineIdArg,
});

/** TypeScript type inferred from {@link lineInputSchema}. */
export type LineInput = z.infer<typeof lineInputSchema>;

/** Input of `create-line`. */
export const createLineInputSchema = createLineBodySchema.extend({
  organizationId: organizationArgSchema,
  targetingGroupId: targetingGroupIdArg,
});

/** TypeScript type inferred from {@link createLineInputSchema}. */
export type CreateLineInput = z.infer<typeof createLineInputSchema>;

/** Input of `update-line`. */
export const updateLineInputSchema = updateLineBodySchema.extend({
  organizationId: organizationArgSchema,
  lineId: lineIdArg,
});

/** TypeScript type inferred from {@link updateLineInputSchema}. */
export type UpdateLineInput = z.infer<typeof updateLineInputSchema>;

/** Input of `set-line-labels`. */
export const setLineLabelsInputSchema = setLabelsBodySchema.extend({
  organizationId: organizationArgSchema,
  lineId: lineIdArg,
});

/** TypeScript type inferred from {@link setLineLabelsInputSchema}. */
export type SetLineLabelsInput = z.infer<typeof setLineLabelsInputSchema>;

/** Input of `bulk-create-lines`. */
export const bulkCreateLinesInputSchema = bulkCreateLinesBodySchema.extend({
  organizationId: organizationArgSchema,
  targetingGroupId: targetingGroupIdArg,
});

/** TypeScript type inferred from {@link bulkCreateLinesInputSchema}, after defaults apply. */
export type BulkCreateLinesInput = z.infer<typeof bulkCreateLinesInputSchema>;

/** Input of `bulk-update-lines`. */
export const bulkUpdateLinesInputSchema = bulkUpdateLinesBodySchema.extend({
  organizationId: organizationArgSchema,
});

/** TypeScript type inferred from {@link bulkUpdateLinesInputSchema}, after defaults apply. */
export type BulkUpdateLinesInput = z.infer<typeof bulkUpdateLinesInputSchema>;

/** Input of `bulk-delete-lines` and `bulk-restore-lines`. */
export const bulkLineIdsInputSchema = bulkIdsBodySchema.extend({ organizationId: organizationArgSchema });

/** TypeScript type inferred from {@link bulkLineIdsInputSchema}, after defaults apply. */
export type BulkLineIdsInput = z.infer<typeof bulkLineIdsInputSchema>;

/** MCP tool schema for `list-lines`. */
export const listLinesSchema = {
  title: 'List lines',
  description:
    'List the lines of a targetingGroup, filtered by name (search) or by labels (labelIds); includeDeleted also lists the deleted ones',
  inputSchema: listLinesInputSchema,
  outputSchema: linePageSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `list-creative-lines`. */
export const listCreativeLinesSchema = {
  title: 'List the lines of a creative',
  description:
    'List the lines that deliver a creative, whichever targetingGroups they hang from, each with what every ' +
    'platform made of its ad (reviews): pending (not reviewed yet, or again after a change), approved, limited ' +
    "(approved, shown to fewer people) or rejected, with the platform's reasons as it words them",
  inputSchema: listCreativeLinesInputSchema,
  outputSchema: creativeLinePageSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `get-line`. */
export const getLineSchema = {
  title: 'Get a line',
  description:
    'Get one line, deleted or not, with its budget: what it carries, what it may spend, and the split per platform',
  inputSchema: lineInputSchema,
  outputSchema: lineSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `create-line`. */
export const createLineSchema = {
  title: 'Create a line',
  description:
    'Create a line under a targetingGroup. Its budget (in integer cents), its window and its currency are required: the whole tree below divides that amount and runs in that window. It is born a draft, so nothing reaches a platform. Requires the manager role',
  inputSchema: createLineInputSchema,
  outputSchema: lineSchema,
};

/** MCP tool schema for `update-line`. */
export const updateLineSchema = {
  title: 'Update a line',
  description:
    'Change a line; a field left out is left alone. Its status moves with the lifecycle, not here. Requires the manager role',
  inputSchema: updateLineInputSchema,
  outputSchema: lineSchema,
};

/** MCP tool schema for `delete-line`. */
export const deleteLineSchema = {
  title: 'Delete a line',
  description:
    'Delete a line **and its whole subtree** — levers, ad groups, targeting groups and lines. restore-line brings back exactly what this deletion took. Requires the manager role',
  inputSchema: lineInputSchema,
  outputSchema: deletionResultSchema,
  annotations: { destructiveHint: true },
};

/** MCP tool schema for `restore-line`. */
export const restoreLineSchema = {
  title: 'Restore a line',
  description:
    'Restore a deleted line and the subtree its deletion took with it; anything deleted before stays deleted. Requires the manager role',
  inputSchema: lineInputSchema,
  outputSchema: deletionResultSchema,
};

/** MCP tool schema for `set-line-labels`. */
export const setLineLabelsSchema = {
  title: 'Set the labels of a line',
  description:
    'Post the complete set of labels a line carries, replacing what it had (an empty list clears them). Requires the manager role',
  inputSchema: setLineLabelsInputSchema,
  outputSchema: lineSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `bulk-create-lines`. */
export const bulkCreateLinesSchema = {
  title: 'Create several lines',
  description:
    'Create up to 200 lines under one advertiser: mode atomic (the default) creates all or nothing, mode partial creates what it can and reports the rest in failed. Requires the manager role',
  inputSchema: bulkCreateLinesInputSchema,
  outputSchema: bulkLineResultSchema,
};

/** MCP tool schema for `bulk-update-lines`. */
export const bulkUpdateLinesSchema = {
  title: 'Update several lines',
  description:
    'Change up to 200 lines at once, each item naming the line it changes: mode atomic (the default) changes all or nothing, mode partial reports what it could not in failed. Requires the manager role',
  inputSchema: bulkUpdateLinesInputSchema,
  outputSchema: bulkLineResultSchema,
};

/** MCP tool schema for `bulk-delete-lines`. */
export const bulkDeleteLinesSchema = {
  title: 'Delete several lines',
  description:
    'Delete up to 200 lines with their subtrees: mode atomic (the default) deletes all or nothing, mode partial reports what it could not in failed. Requires the manager role',
  inputSchema: bulkLineIdsInputSchema,
  outputSchema: bulkDeletionResultSchema,
  annotations: { destructiveHint: true },
};

/** MCP tool schema for `bulk-restore-lines`. */
export const bulkRestoreLinesSchema = {
  title: 'Restore several lines',
  description:
    'Restore up to 200 deleted lines with their subtrees: mode atomic (the default) restores all or nothing, mode partial reports what it could not in failed. Requires the manager role',
  inputSchema: bulkLineIdsInputSchema,
  outputSchema: bulkDeletionResultSchema,
};
