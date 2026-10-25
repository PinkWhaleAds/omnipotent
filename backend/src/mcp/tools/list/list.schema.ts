import { z } from 'zod';

import {
  bulkCreateListsBodySchema,
  bulkDeletionResultSchema,
  bulkIdsBodySchema,
  bulkListResultSchema,
  bulkUpdateListsBodySchema,
  createListBodySchema,
  deletionResultSchema,
  listListsQuerySchema,
  listPageSchema,
  listSchema,
  organizationArgSchema,
  updateListBodySchema,
} from '@src/types';

/** Argument naming one list. */
const listIdArg = z.uuid().describe('List id (from list-lists)');

/** Input of `list-lists`. */
export const listListsInputSchema = listListsQuerySchema.extend({ organizationId: organizationArgSchema });

/** TypeScript type inferred from {@link listListsInputSchema}, after defaults apply. */
export type ListListsInput = z.infer<typeof listListsInputSchema>;

/** Input of `get-list`, `delete-list` and `restore-list`. */
export const listInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  listId: listIdArg,
});

/** TypeScript type inferred from {@link listInputSchema}. */
export type ListInput = z.infer<typeof listInputSchema>;

/** Input of `create-list`. */
export const createListInputSchema = createListBodySchema.extend({ organizationId: organizationArgSchema });

/** TypeScript type inferred from {@link createListInputSchema}. */
export type CreateListInput = z.infer<typeof createListInputSchema>;

/** Input of `update-list`. */
export const updateListInputSchema = updateListBodySchema.extend({
  organizationId: organizationArgSchema,
  listId: listIdArg,
});

/** TypeScript type inferred from {@link updateListInputSchema}. */
export type UpdateListInput = z.infer<typeof updateListInputSchema>;

/**
 * Input of `duplicate-list` and `move-list`.
 *
 * Two Organizations are named here, so they are named apart: `organizationId` is the one the caller
 * acts in, as in every other tool, and `targetOrganizationId` is where the list goes.
 */
export const transferListInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  listId: listIdArg,
  targetOrganizationId: z.uuid().describe('Organization of the same Seat the list goes to'),
});

/** TypeScript type inferred from {@link transferListInputSchema}. */
export type TransferListInput = z.infer<typeof transferListInputSchema>;

/** Input of `bulk-create-lists`. */
export const bulkCreateListsInputSchema = bulkCreateListsBodySchema.extend({
  organizationId: organizationArgSchema,
});

/** TypeScript type inferred from {@link bulkCreateListsInputSchema}, after defaults apply. */
export type BulkCreateListsInput = z.infer<typeof bulkCreateListsInputSchema>;

/** Input of `bulk-update-lists`. */
export const bulkUpdateListsInputSchema = bulkUpdateListsBodySchema.extend({
  organizationId: organizationArgSchema,
});

/** TypeScript type inferred from {@link bulkUpdateListsInputSchema}, after defaults apply. */
export type BulkUpdateListsInput = z.infer<typeof bulkUpdateListsInputSchema>;

/** Input of `bulk-delete-lists` and `bulk-restore-lists`. */
export const bulkListIdsInputSchema = bulkIdsBodySchema.extend({ organizationId: organizationArgSchema });

/** TypeScript type inferred from {@link bulkListIdsInputSchema}, after defaults apply. */
export type BulkListIdsInput = z.infer<typeof bulkListIdsInputSchema>;

/** MCP tool schema for `list-lists`. */
export const listListsSchema = {
  title: 'List the reusable lists',
  description:
    'The reusable lists of an Organization — sites and applications, bundles, devices, geographic ' +
    'meshes, postal codes, publishers, placements, inventory sources, audiences, retargeting, points ' +
    'of interest, screens, negative keywords. A targeting references them by id, and the kind of a ' +
    'list decides which dimension it plugs into. Requires the viewer role',
  inputSchema: listListsInputSchema,
  outputSchema: listPageSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `get-list`. */
export const getListSchema = {
  title: 'Get a reusable list',
  description: 'One list with its items, deleted or not. Requires the viewer role',
  inputSchema: listInputSchema,
  outputSchema: listSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `create-list`. */
export const createListSchema = {
  title: 'Create a reusable list',
  description:
    'Create a list of a kind, with its items: value is what travels to the platform, label what a ' +
    'human reads, metadata the values an adapter needs (coordinates, régie, country, match type). The ' +
    'kind never changes afterwards, dimensions referencing a list by what it holds. Requires the ' +
    'manager role',
  inputSchema: createListInputSchema,
  outputSchema: listSchema,
  annotations: {},
};

/** MCP tool schema for `update-list`. */
export const updateListSchema = {
  title: 'Change a reusable list',
  description:
    'Change the name of a list, or the complete set of its items — items replaces what it had, it does ' +
    'not add to it. Requires the manager role',
  inputSchema: updateListInputSchema,
  outputSchema: listSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `delete-list`. */
export const deleteListSchema = {
  title: 'Delete a reusable list',
  description:
    'Delete a list; the targetings referencing it are left alone, so restoring it brings them back. ' +
    'Requires the manager role',
  inputSchema: listInputSchema,
  outputSchema: deletionResultSchema,
  annotations: { idempotentHint: true, destructiveHint: true },
};

/** MCP tool schema for `restore-list`. */
export const restoreListSchema = {
  title: 'Restore a reusable list',
  description: 'Bring back a deleted list, name still free. Requires the manager role',
  inputSchema: listInputSchema,
  outputSchema: deletionResultSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `duplicate-list`. */
export const duplicateListSchema = {
  title: 'Duplicate a reusable list',
  description:
    'Copy a list into another Organization of the same Seat: the copy is a list of its own from that ' +
    'moment, so changing one does not change the other. Requires the seat_admin role',
  inputSchema: transferListInputSchema,
  outputSchema: listSchema,
  annotations: {},
};

/** MCP tool schema for `move-list`. */
export const moveListSchema = {
  title: 'Move a reusable list',
  description:
    'Move a list into another Organization of the same Seat. Refused while a targeting of its ' +
    'Organization still references it — that targeting would be left pointing at a list it can no ' +
    'longer see; duplicate it instead. Requires the seat_admin role',
  inputSchema: transferListInputSchema,
  outputSchema: listSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `bulk-create-lists`. */
export const bulkCreateListsSchema = {
  title: 'Create several reusable lists',
  description:
    'Create several lists at once. mode atomic refuses everything on the first failure, partial keeps ' +
    'what worked and reports the rest. Requires the manager role',
  inputSchema: bulkCreateListsInputSchema,
  outputSchema: bulkListResultSchema,
  annotations: {},
};

/** MCP tool schema for `bulk-update-lists`. */
export const bulkUpdateListsSchema = {
  title: 'Change several reusable lists',
  description: 'Change several lists at once, each item naming the list it changes. Requires the manager role',
  inputSchema: bulkUpdateListsInputSchema,
  outputSchema: bulkListResultSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `bulk-delete-lists`. */
export const bulkDeleteListsSchema = {
  title: 'Delete several reusable lists',
  description: 'Delete several lists at once. Requires the manager role',
  inputSchema: bulkListIdsInputSchema,
  outputSchema: bulkDeletionResultSchema,
  annotations: { idempotentHint: true, destructiveHint: true },
};

/** MCP tool schema for `bulk-restore-lists`. */
export const bulkRestoreListsSchema = {
  title: 'Restore several reusable lists',
  description: 'Bring back several deleted lists at once. Requires the manager role',
  inputSchema: bulkListIdsInputSchema,
  outputSchema: bulkDeletionResultSchema,
  annotations: { idempotentHint: true },
};
