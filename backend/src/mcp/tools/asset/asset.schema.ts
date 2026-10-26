import { z } from 'zod';

import {
  assetPageSchema,
  assetSchema,
  deletionResultSchema,
  listAssetsQuerySchema,
  organizationArgSchema,
  setLabelsBodySchema,
  updateAssetBodySchema,
  uploadAssetInputSchema,
} from '@src/types';

/** Argument naming the Advertiser whose library is read or written. */
const advertiserIdArg = z.uuid().describe('Advertiser id (from list-advertisers)');

/** Argument naming one asset. */
const assetIdArg = z.uuid().describe('Asset id (from list-assets)');

/** Input of `list-assets`. */
export const listAssetsInputSchema = listAssetsQuerySchema.extend({
  organizationId: organizationArgSchema,
  advertiserId: advertiserIdArg,
});

/** TypeScript type inferred from {@link listAssetsInputSchema}, after defaults apply. */
export type ListAssetsInput = z.infer<typeof listAssetsInputSchema>;

/** Input of `get-asset`, `delete-asset` and `restore-asset`. */
export const assetInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  assetId: assetIdArg,
});

/** TypeScript type inferred from {@link assetInputSchema}. */
export type AssetInput = z.infer<typeof assetInputSchema>;

/** Input of `upload-asset`. */
export const uploadAssetToolInputSchema = uploadAssetInputSchema.extend({
  organizationId: organizationArgSchema,
  advertiserId: advertiserIdArg,
});

/** TypeScript type inferred from {@link uploadAssetToolInputSchema}. */
export type UploadAssetToolInput = z.infer<typeof uploadAssetToolInputSchema>;

/** Input of `update-asset`. */
export const updateAssetInputSchema = updateAssetBodySchema.extend({
  organizationId: organizationArgSchema,
  assetId: assetIdArg,
});

/** TypeScript type inferred from {@link updateAssetInputSchema}. */
export type UpdateAssetInput = z.infer<typeof updateAssetInputSchema>;

/** Input of `set-asset-labels`. */
export const setAssetLabelsInputSchema = setLabelsBodySchema.extend({
  organizationId: organizationArgSchema,
  assetId: assetIdArg,
});

/** TypeScript type inferred from {@link setAssetLabelsInputSchema}. */
export type SetAssetLabelsInput = z.infer<typeof setAssetLabelsInputSchema>;

/** MCP tool schema for `list-assets`. */
export const listAssetsSchema = {
  title: 'List the assets of an Advertiser',
  description:
    'The library of an Advertiser: images, videos, audios and bundles, with their type, their weight, ' +
    'their dimensions and a temporary download url. An asset is a resource of its own — it exists ' +
    'before any creative, and several creatives share it. Requires the viewer role',
  inputSchema: listAssetsInputSchema,
  outputSchema: assetPageSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `get-asset`. */
export const getAssetSchema = {
  title: 'Get an asset',
  description: 'One asset with its metadata and a temporary download url. Requires the viewer role',
  inputSchema: assetInputSchema,
  outputSchema: assetSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `upload-asset`. */
export const uploadAssetSchema = {
  title: 'Put a file in a library',
  description:
    'Upload a file into the library of an Advertiser, its content base64-encoded. The same bytes twice ' +
    'answer the **same asset**: the fingerprint is unique per Advertiser, so a retry costs nothing. An ' +
    'image is verified against its bytes, which give its real type and its dimensions; the duration of ' +
    'a video or an audio is taken as declared. Requires the manager role',
  inputSchema: uploadAssetToolInputSchema,
  outputSchema: assetSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `update-asset`. */
export const updateAssetSchema = {
  title: 'Rename an asset',
  description:
    'Change the name of an asset; its bytes never change, a new file being a new asset. Requires the ' + 'manager role',
  inputSchema: updateAssetInputSchema,
  outputSchema: assetSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `delete-asset`. */
export const deleteAssetSchema = {
  title: 'Delete an asset',
  description:
    'Delete an asset. Refused while a living creative uses it, so no creative ever breaks: delete the ' +
    'creative first, or keep the asset. Requires the manager role',
  inputSchema: assetInputSchema,
  outputSchema: deletionResultSchema,
  annotations: { idempotentHint: true, destructiveHint: true },
};

/** MCP tool schema for `restore-asset`. */
export const restoreAssetSchema = {
  title: 'Restore an asset',
  description: 'Bring a deleted asset back to the library. Requires the manager role',
  inputSchema: assetInputSchema,
  outputSchema: deletionResultSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `set-asset-labels`. */
export const setAssetLabelsSchema = {
  title: 'Set the labels of an asset',
  description:
    'Post the complete set of labels an asset carries, replacing what it had (an empty list clears ' +
    'them). Requires the manager role',
  inputSchema: setAssetLabelsInputSchema,
  outputSchema: assetSchema,
  annotations: { idempotentHint: true },
};
