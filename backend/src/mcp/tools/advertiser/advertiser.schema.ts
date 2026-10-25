import { z } from 'zod';

import {
  advertiserPageSchema,
  advertiserSchema,
  bulkAdvertiserResultSchema,
  bulkCreateAdvertisersBodySchema,
  bulkDeletionResultSchema,
  bulkIdsBodySchema,
  bulkUpdateAdvertisersBodySchema,
  createAdvertiserBodySchema,
  deletionResultSchema,
  listAdvertisersQuerySchema,
  organizationArgSchema,
  setLabelsBodySchema,
  updateAdvertiserBodySchema,
} from '@src/types';

/** Argument naming an Advertiser. */
const advertiserIdArg = z.uuid().describe('Advertiser id (from list-advertisers)');

/** Input of `list-advertisers`. */
export const listAdvertisersInputSchema = listAdvertisersQuerySchema.extend({ organizationId: organizationArgSchema });

/** TypeScript type inferred from {@link listAdvertisersInputSchema}, after defaults apply. */
export type ListAdvertisersInput = z.infer<typeof listAdvertisersInputSchema>;

/** Input of `get-advertiser`, `delete-advertiser` and `restore-advertiser`. */
export const advertiserInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  advertiserId: advertiserIdArg,
});

/** TypeScript type inferred from {@link advertiserInputSchema}. */
export type AdvertiserInput = z.infer<typeof advertiserInputSchema>;

/** Input of `create-advertiser`. */
export const createAdvertiserInputSchema = createAdvertiserBodySchema.extend({ organizationId: organizationArgSchema });

/** TypeScript type inferred from {@link createAdvertiserInputSchema}. */
export type CreateAdvertiserInput = z.infer<typeof createAdvertiserInputSchema>;

/** Input of `update-advertiser`. */
export const updateAdvertiserInputSchema = updateAdvertiserBodySchema.extend({
  organizationId: organizationArgSchema,
  advertiserId: advertiserIdArg,
});

/** TypeScript type inferred from {@link updateAdvertiserInputSchema}. */
export type UpdateAdvertiserInput = z.infer<typeof updateAdvertiserInputSchema>;

/** Input of `set-advertiser-labels`. */
export const setAdvertiserLabelsInputSchema = setLabelsBodySchema.extend({
  organizationId: organizationArgSchema,
  advertiserId: advertiserIdArg,
});

/** TypeScript type inferred from {@link setAdvertiserLabelsInputSchema}. */
export type SetAdvertiserLabelsInput = z.infer<typeof setAdvertiserLabelsInputSchema>;

/** Input of `bulk-create-advertisers`. */
export const bulkCreateAdvertisersInputSchema = bulkCreateAdvertisersBodySchema.extend({
  organizationId: organizationArgSchema,
});

/** TypeScript type inferred from {@link bulkCreateAdvertisersInputSchema}, after defaults apply. */
export type BulkCreateAdvertisersInput = z.infer<typeof bulkCreateAdvertisersInputSchema>;

/** Input of `bulk-update-advertisers`. */
export const bulkUpdateAdvertisersInputSchema = bulkUpdateAdvertisersBodySchema.extend({
  organizationId: organizationArgSchema,
});

/** TypeScript type inferred from {@link bulkUpdateAdvertisersInputSchema}, after defaults apply. */
export type BulkUpdateAdvertisersInput = z.infer<typeof bulkUpdateAdvertisersInputSchema>;

/** Input of `bulk-delete-advertisers` and `bulk-restore-advertisers`. */
export const bulkAdvertiserIdsInputSchema = bulkIdsBodySchema.extend({ organizationId: organizationArgSchema });

/** TypeScript type inferred from {@link bulkAdvertiserIdsInputSchema}, after defaults apply. */
export type BulkAdvertiserIdsInput = z.infer<typeof bulkAdvertiserIdsInputSchema>;

/** MCP tool schema for `list-advertisers`. */
export const listAdvertisersSchema = {
  title: 'List advertisers',
  description:
    'List the advertisers (brands) of an Organization, filtered by name (search) or by labels (labelIds); includeDeleted also lists the deleted ones',
  inputSchema: listAdvertisersInputSchema,
  outputSchema: advertiserPageSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `get-advertiser`. */
export const getAdvertiserSchema = {
  title: 'Get an advertiser',
  description: 'Get one advertiser of an Organization, deleted or not, with the labels it carries',
  inputSchema: advertiserInputSchema,
  outputSchema: advertiserSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `create-advertiser`. */
export const createAdvertiserSchema = {
  title: 'Create an advertiser',
  description:
    'Create an advertiser (brand) in an Organization, with the labels it carries; its name must be free among the live ones. Requires the manager role',
  inputSchema: createAdvertiserInputSchema,
  outputSchema: advertiserSchema,
};

/** MCP tool schema for `update-advertiser`. */
export const updateAdvertiserSchema = {
  title: 'Update an advertiser',
  description:
    'Rename an advertiser or change its website (null clears it); a field left out is left alone. Requires the manager role',
  inputSchema: updateAdvertiserInputSchema,
  outputSchema: advertiserSchema,
};

/** MCP tool schema for `delete-advertiser`. */
export const deleteAdvertiserSchema = {
  title: 'Delete an advertiser',
  description:
    'Delete an advertiser, which frees its name and can be undone with restore-advertiser. Requires the manager role',
  inputSchema: advertiserInputSchema,
  outputSchema: deletionResultSchema,
  annotations: { destructiveHint: true },
};

/** MCP tool schema for `restore-advertiser`. */
export const restoreAdvertiserSchema = {
  title: 'Restore an advertiser',
  description:
    'Restore a deleted advertiser, with the labels it carried; refused when it is not deleted or its name was taken again. Requires the manager role',
  inputSchema: advertiserInputSchema,
  outputSchema: deletionResultSchema,
};

/** MCP tool schema for `set-advertiser-labels`. */
export const setAdvertiserLabelsSchema = {
  title: 'Set the labels of an advertiser',
  description:
    'Post the complete set of labels an advertiser carries, replacing what it had: send every label it should keep (an empty list clears them). Requires the manager role',
  inputSchema: setAdvertiserLabelsInputSchema,
  outputSchema: advertiserSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `bulk-create-advertisers`. */
export const bulkCreateAdvertisersSchema = {
  title: 'Create several advertisers',
  description:
    'Create up to 200 advertisers at once: mode atomic (the default) creates all or nothing, mode partial creates what it can and reports the rest in failed. Requires the manager role',
  inputSchema: bulkCreateAdvertisersInputSchema,
  outputSchema: bulkAdvertiserResultSchema,
};

/** MCP tool schema for `bulk-update-advertisers`. */
export const bulkUpdateAdvertisersSchema = {
  title: 'Update several advertisers',
  description:
    'Update up to 200 advertisers at once, each item naming the advertiser it changes: mode atomic (the default) updates all or nothing, mode partial reports what it could not in failed. Requires the manager role',
  inputSchema: bulkUpdateAdvertisersInputSchema,
  outputSchema: bulkAdvertiserResultSchema,
};

/** MCP tool schema for `bulk-delete-advertisers`. */
export const bulkDeleteAdvertisersSchema = {
  title: 'Delete several advertisers',
  description:
    'Delete up to 200 advertisers at once: mode atomic (the default) deletes all or nothing, mode partial reports what it could not in failed. Requires the manager role',
  inputSchema: bulkAdvertiserIdsInputSchema,
  outputSchema: bulkDeletionResultSchema,
  annotations: { destructiveHint: true },
};

/** MCP tool schema for `bulk-restore-advertisers`. */
export const bulkRestoreAdvertisersSchema = {
  title: 'Restore several advertisers',
  description:
    'Restore up to 200 deleted advertisers at once: mode atomic (the default) restores all or nothing, mode partial reports what it could not in failed. Requires the manager role',
  inputSchema: bulkAdvertiserIdsInputSchema,
  outputSchema: bulkDeletionResultSchema,
};
