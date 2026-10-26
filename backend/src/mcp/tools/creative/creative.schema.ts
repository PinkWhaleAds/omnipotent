import { z } from 'zod';

import {
  bulkCreateCreativesBodySchema,
  bulkCreativeResultSchema,
  bulkDeletionResultSchema,
  bulkIdsBodySchema,
  bulkUpdateCreativesBodySchema,
  createCreativeBodySchema,
  createCreativeVersionBodySchema,
  creativeCatalogSchema,
  creativePageSchema,
  creativeSchema,
  creativeVersionPageSchema,
  creativeVersionSchema,
  deletionResultSchema,
  listCreativeVersionsQuerySchema,
  listCreativesQuerySchema,
  organizationArgSchema,
  setLabelsBodySchema,
  updateCreativeBodySchema,
} from '@src/types';

/** Argument naming the Advertiser whose library is read or written. */
const advertiserIdArg = z.uuid().describe('Advertiser id (from list-advertisers)');

/** Argument naming one creative. */
const creativeIdArg = z.uuid().describe('Creative id (from list-creatives)');

/** Argument naming one version. */
const versionIdArg = z.uuid().describe('Creative version id (from list-creative-versions)');

/** Input of `get-creative-formats`: the registry is the same for everyone. */
export const creativeFormatsInputSchema = z.strictObject({});

/** Input of `list-creatives`. */
export const listCreativesInputSchema = listCreativesQuerySchema.extend({
  organizationId: organizationArgSchema,
  advertiserId: advertiserIdArg,
});

/** TypeScript type inferred from {@link listCreativesInputSchema}, after defaults apply. */
export type ListCreativesInput = z.infer<typeof listCreativesInputSchema>;

/** Input of `get-creative`, `delete-creative` and `restore-creative`. */
export const creativeInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  creativeId: creativeIdArg,
});

/** TypeScript type inferred from {@link creativeInputSchema}. */
export type CreativeInput = z.infer<typeof creativeInputSchema>;

/** Input of `create-creative`. */
export const createCreativeInputSchema = createCreativeBodySchema.extend({
  organizationId: organizationArgSchema,
  advertiserId: advertiserIdArg,
});

/** TypeScript type inferred from {@link createCreativeInputSchema}, after defaults apply. */
export type CreateCreativeInput = z.infer<typeof createCreativeInputSchema>;

/** Input of `update-creative`. */
export const updateCreativeInputSchema = updateCreativeBodySchema.extend({
  organizationId: organizationArgSchema,
  creativeId: creativeIdArg,
});

/** TypeScript type inferred from {@link updateCreativeInputSchema}. */
export type UpdateCreativeInput = z.infer<typeof updateCreativeInputSchema>;

/** Input of `set-creative-labels`. */
export const setCreativeLabelsInputSchema = setLabelsBodySchema.extend({
  organizationId: organizationArgSchema,
  creativeId: creativeIdArg,
});

/** TypeScript type inferred from {@link setCreativeLabelsInputSchema}. */
export type SetCreativeLabelsInput = z.infer<typeof setCreativeLabelsInputSchema>;

/** Input of `list-creative-versions`. */
export const listCreativeVersionsInputSchema = listCreativeVersionsQuerySchema.extend({
  organizationId: organizationArgSchema,
  creativeId: creativeIdArg,
});

/** TypeScript type inferred from {@link listCreativeVersionsInputSchema}, after defaults apply. */
export type ListCreativeVersionsInput = z.infer<typeof listCreativeVersionsInputSchema>;

/** Input of `create-creative-version`. */
export const createCreativeVersionInputSchema = createCreativeVersionBodySchema.extend({
  organizationId: organizationArgSchema,
  creativeId: creativeIdArg,
});

/** TypeScript type inferred from {@link createCreativeVersionInputSchema}, after defaults apply. */
export type CreateCreativeVersionInput = z.infer<typeof createCreativeVersionInputSchema>;

/** Input of `get-creative-version` and `activate-creative-version`. */
export const creativeVersionInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  versionId: versionIdArg,
});

/** TypeScript type inferred from {@link creativeVersionInputSchema}. */
export type CreativeVersionInput = z.infer<typeof creativeVersionInputSchema>;

/** Input of `bulk-create-creatives`. */
export const bulkCreateCreativesInputSchema = bulkCreateCreativesBodySchema.extend({
  organizationId: organizationArgSchema,
  advertiserId: advertiserIdArg,
});

/** TypeScript type inferred from {@link bulkCreateCreativesInputSchema}, after defaults apply. */
export type BulkCreateCreativesInput = z.infer<typeof bulkCreateCreativesInputSchema>;

/** Input of `bulk-update-creatives`. */
export const bulkUpdateCreativesInputSchema = bulkUpdateCreativesBodySchema.extend({
  organizationId: organizationArgSchema,
});

/** TypeScript type inferred from {@link bulkUpdateCreativesInputSchema}, after defaults apply. */
export type BulkUpdateCreativesInput = z.infer<typeof bulkUpdateCreativesInputSchema>;

/** Input of `bulk-delete-creatives` and `bulk-restore-creatives`. */
export const bulkCreativeIdsInputSchema = bulkIdsBodySchema.extend({ organizationId: organizationArgSchema });

/** TypeScript type inferred from {@link bulkCreativeIdsInputSchema}, after defaults apply. */
export type BulkCreativeIdsInput = z.infer<typeof bulkCreativeIdsInputSchema>;

/** MCP tool schema for `get-creative-formats`. */
export const getCreativeFormatsSchema = {
  title: 'List the creative formats',
  description:
    'The couples (format, subtype) this API knows, with the JSON schema of each payload and the asset ' +
    'roles it needs: read it before creating a creative rather than guessing a shape. The format is ' +
    'the inventory aimed at — search_text, display, video, audio, native — and the subtype how the ' +
    'creative reaches the platform: rsa, image, mraid, file, vast_url, youtube_id, assets',
  inputSchema: creativeFormatsInputSchema,
  outputSchema: creativeCatalogSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `list-creatives`. */
export const listCreativesSchema = {
  title: 'List the creatives of an Advertiser',
  description:
    'The creative library of an Advertiser, each creative with the version that delivers. A creative is ' +
    'never the bytes: those are assets it uses. Requires the viewer role',
  inputSchema: listCreativesInputSchema,
  outputSchema: creativePageSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `get-creative`. */
export const getCreativeSchema = {
  title: 'Get a creative',
  description: 'One creative, deleted or not, with the version that delivers. Requires the viewer role',
  inputSchema: creativeInputSchema,
  outputSchema: creativeSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `create-creative`. */
export const createCreativeSchema = {
  title: 'Create a creative',
  description:
    'Create a creative and its first version, which delivers at once. The payload must match the couple ' +
    '(format, subtype) — get-creative-formats gives its shape and the asset roles it needs — and the ' +
    'assets must belong to the same Advertiser. Neither the format nor the subtype changes afterwards. ' +
    'Requires the manager role',
  inputSchema: createCreativeInputSchema,
  outputSchema: creativeSchema,
  annotations: {},
};

/** MCP tool schema for `update-creative`. */
export const updateCreativeSchema = {
  title: 'Change a creative',
  description:
    'Change what stays true across versions: the name, the IAB categories, the click URL. A new payload ' +
    'is a new version, not an update. Requires the manager role',
  inputSchema: updateCreativeInputSchema,
  outputSchema: creativeSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `delete-creative`. */
export const deleteCreativeSchema = {
  title: 'Delete a creative',
  description:
    'Delete a creative and its versions; its assets survive, being resources of their own — which is ' +
    'also how an asset in use becomes deletable. Requires the manager role',
  inputSchema: creativeInputSchema,
  outputSchema: deletionResultSchema,
  annotations: { idempotentHint: true, destructiveHint: true },
};

/** MCP tool schema for `restore-creative`. */
export const restoreCreativeSchema = {
  title: 'Restore a creative',
  description: 'Bring back a deleted creative, its versions with it. Requires the manager role',
  inputSchema: creativeInputSchema,
  outputSchema: deletionResultSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `set-creative-labels`. */
export const setCreativeLabelsSchema = {
  title: 'Set the labels of a creative',
  description:
    'Post the complete set of labels a creative carries, replacing what it had (an empty list clears ' +
    'them). Requires the manager role',
  inputSchema: setCreativeLabelsInputSchema,
  outputSchema: creativeSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `list-creative-versions`. */
export const listCreativeVersionsSchema = {
  title: 'List the versions of a creative',
  description:
    'The versions of a creative, the most recent first, each with the assets it uses and whether it ' +
    'delivers. A version is immutable: a change is a new version, so delivery never stops while the ' +
    'platforms revalidate. Requires the viewer role',
  inputSchema: listCreativeVersionsInputSchema,
  outputSchema: creativeVersionPageSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `create-creative-version`. */
export const createCreativeVersionSchema = {
  title: 'Add a version to a creative',
  description:
    'Add a version: nothing existing is touched, and the new one does not deliver until it is ' +
    'activated. The payload must match the couple of the creative. Requires the manager role',
  inputSchema: createCreativeVersionInputSchema,
  outputSchema: creativeVersionSchema,
  annotations: {},
};

/** MCP tool schema for `get-creative-version`. */
export const getCreativeVersionSchema = {
  title: 'Get a creative version',
  description: 'One version with the assets it uses. Requires the viewer role',
  inputSchema: creativeVersionInputSchema,
  outputSchema: creativeVersionSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `activate-creative-version`. */
export const activateCreativeVersionSchema = {
  title: 'Put a creative version in delivery',
  description:
    'Make a version the one that delivers. The previous one serves until this call, which is the point ' +
    'of the versioned model. Requires the manager role',
  inputSchema: creativeVersionInputSchema,
  outputSchema: creativeVersionSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `bulk-create-creatives`. */
export const bulkCreateCreativesSchema = {
  title: 'Create several creatives',
  description:
    'Create several creatives at once, each with its first version. mode atomic refuses everything on ' +
    'the first failure, partial keeps what worked and reports the rest. Requires the manager role',
  inputSchema: bulkCreateCreativesInputSchema,
  outputSchema: bulkCreativeResultSchema,
  annotations: {},
};

/** MCP tool schema for `bulk-update-creatives`. */
export const bulkUpdateCreativesSchema = {
  title: 'Change several creatives',
  description: 'Change several creatives at once, each item naming the one it changes. Requires the manager role',
  inputSchema: bulkUpdateCreativesInputSchema,
  outputSchema: bulkCreativeResultSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `bulk-delete-creatives`. */
export const bulkDeleteCreativesSchema = {
  title: 'Delete several creatives',
  description: 'Delete several creatives at once, their versions with them. Requires the manager role',
  inputSchema: bulkCreativeIdsInputSchema,
  outputSchema: bulkDeletionResultSchema,
  annotations: { idempotentHint: true, destructiveHint: true },
};

/** MCP tool schema for `bulk-restore-creatives`. */
export const bulkRestoreCreativesSchema = {
  title: 'Restore several creatives',
  description: 'Bring back several deleted creatives at once. Requires the manager role',
  inputSchema: bulkCreativeIdsInputSchema,
  outputSchema: bulkDeletionResultSchema,
  annotations: { idempotentHint: true },
};
