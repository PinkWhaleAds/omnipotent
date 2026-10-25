import { z } from 'zod';

import {
  bulkCreateLabelsBodySchema,
  bulkDeletionResultSchema,
  bulkIdsBodySchema,
  bulkLabelResultSchema,
  bulkUpdateLabelsBodySchema,
  createLabelBodySchema,
  deletionResultSchema,
  labelledResourcePageSchema,
  labelPageSchema,
  labelSchema,
  listLabelsQuerySchema,
  organizationArgSchema,
  paginationQuerySchema,
  updateLabelBodySchema,
} from '@src/types';

/** Argument naming a Label. */
const labelIdArg = z.uuid().describe('Label id (from list-labels)');

/** Input of `list-labels`. */
export const listLabelsInputSchema = listLabelsQuerySchema.extend({ organizationId: organizationArgSchema });

/** TypeScript type inferred from {@link listLabelsInputSchema}, after defaults apply. */
export type ListLabelsInput = z.infer<typeof listLabelsInputSchema>;

/** Input of `get-label`, `delete-label` and `restore-label`. */
export const labelInputSchema = z.strictObject({ organizationId: organizationArgSchema, labelId: labelIdArg });

/** TypeScript type inferred from {@link labelInputSchema}. */
export type LabelInput = z.infer<typeof labelInputSchema>;

/** Input of `create-label`. */
export const createLabelInputSchema = createLabelBodySchema.extend({ organizationId: organizationArgSchema });

/** TypeScript type inferred from {@link createLabelInputSchema}. */
export type CreateLabelInput = z.infer<typeof createLabelInputSchema>;

/** Input of `update-label`. */
export const updateLabelInputSchema = updateLabelBodySchema.extend({
  organizationId: organizationArgSchema,
  labelId: labelIdArg,
});

/** TypeScript type inferred from {@link updateLabelInputSchema}. */
export type UpdateLabelInput = z.infer<typeof updateLabelInputSchema>;

/** Input of `list-label-resources`. */
export const listLabelResourcesInputSchema = paginationQuerySchema.extend({
  organizationId: organizationArgSchema,
  labelId: labelIdArg,
});

/** TypeScript type inferred from {@link listLabelResourcesInputSchema}, after defaults apply. */
export type ListLabelResourcesInput = z.infer<typeof listLabelResourcesInputSchema>;

/** Input of `bulk-create-labels`. */
export const bulkCreateLabelsInputSchema = bulkCreateLabelsBodySchema.extend({
  organizationId: organizationArgSchema,
});

/** TypeScript type inferred from {@link bulkCreateLabelsInputSchema}, after defaults apply. */
export type BulkCreateLabelsInput = z.infer<typeof bulkCreateLabelsInputSchema>;

/** Input of `bulk-update-labels`. */
export const bulkUpdateLabelsInputSchema = bulkUpdateLabelsBodySchema.extend({
  organizationId: organizationArgSchema,
});

/** TypeScript type inferred from {@link bulkUpdateLabelsInputSchema}, after defaults apply. */
export type BulkUpdateLabelsInput = z.infer<typeof bulkUpdateLabelsInputSchema>;

/** Input of `bulk-delete-labels` and `bulk-restore-labels`. */
export const bulkLabelIdsInputSchema = bulkIdsBodySchema.extend({ organizationId: organizationArgSchema });

/** TypeScript type inferred from {@link bulkLabelIdsInputSchema}, after defaults apply. */
export type BulkLabelIdsInput = z.infer<typeof bulkLabelIdsInputSchema>;

/** MCP tool schema for `list-labels`. */
export const listLabelsSchema = {
  title: 'List labels',
  description:
    'List the labels of an Organization, filtered by name (search); includeDeleted also lists the deleted ones. A label organizes resources and never changes how they behave',
  inputSchema: listLabelsInputSchema,
  outputSchema: labelPageSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `get-label`. */
export const getLabelSchema = {
  title: 'Get a label',
  description: 'Get one label of an Organization, deleted or not',
  inputSchema: labelInputSchema,
  outputSchema: labelSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `create-label`. */
export const createLabelSchema = {
  title: 'Create a label',
  description:
    'Create a label in an Organization, with its colour as #rrggbb; its name must be free among the live ones. Requires the manager role',
  inputSchema: createLabelInputSchema,
  outputSchema: labelSchema,
};

/** MCP tool schema for `update-label`. */
export const updateLabelSchema = {
  title: 'Update a label',
  description: 'Rename a label or change its colour; a field left out is left alone. Requires the manager role',
  inputSchema: updateLabelInputSchema,
  outputSchema: labelSchema,
};

/** MCP tool schema for `delete-label`. */
export const deleteLabelSchema = {
  title: 'Delete a label',
  description:
    'Delete a label, which hides it from the resources carrying it without losing them: restore-label shows it again. Requires the manager role',
  inputSchema: labelInputSchema,
  outputSchema: deletionResultSchema,
  annotations: { destructiveHint: true },
};

/** MCP tool schema for `restore-label`. */
export const restoreLabelSchema = {
  title: 'Restore a label',
  description:
    'Restore a deleted label, with the resources it marked; refused when it is not deleted or its name was taken again. Requires the manager role',
  inputSchema: labelInputSchema,
  outputSchema: deletionResultSchema,
};

/** MCP tool schema for `list-label-resources`. */
export const listLabelResourcesSchema = {
  title: 'List what a label marks',
  description: 'List the resources a label is posted on, whatever their kind, each with its name',
  inputSchema: listLabelResourcesInputSchema,
  outputSchema: labelledResourcePageSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `bulk-create-labels`. */
export const bulkCreateLabelsSchema = {
  title: 'Create several labels',
  description:
    'Create up to 200 labels at once: mode atomic (the default) creates all or nothing, mode partial creates what it can and reports the rest in failed. Requires the manager role',
  inputSchema: bulkCreateLabelsInputSchema,
  outputSchema: bulkLabelResultSchema,
};

/** MCP tool schema for `bulk-update-labels`. */
export const bulkUpdateLabelsSchema = {
  title: 'Update several labels',
  description:
    'Update up to 200 labels at once, each item naming the label it changes: mode atomic (the default) updates all or nothing, mode partial reports what it could not in failed. Requires the manager role',
  inputSchema: bulkUpdateLabelsInputSchema,
  outputSchema: bulkLabelResultSchema,
};

/** MCP tool schema for `bulk-delete-labels`. */
export const bulkDeleteLabelsSchema = {
  title: 'Delete several labels',
  description:
    'Delete up to 200 labels at once: mode atomic (the default) deletes all or nothing, mode partial reports what it could not in failed. Requires the manager role',
  inputSchema: bulkLabelIdsInputSchema,
  outputSchema: bulkDeletionResultSchema,
  annotations: { destructiveHint: true },
};

/** MCP tool schema for `bulk-restore-labels`. */
export const bulkRestoreLabelsSchema = {
  title: 'Restore several labels',
  description:
    'Restore up to 200 deleted labels at once: mode atomic (the default) restores all or nothing, mode partial reports what it could not in failed. Requires the manager role',
  inputSchema: bulkLabelIdsInputSchema,
  outputSchema: bulkDeletionResultSchema,
};
