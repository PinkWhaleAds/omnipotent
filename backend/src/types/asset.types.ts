import { z } from 'zod';

import { paginatedSchema } from './api.types';
import { listQuerySchema } from './crud.types';
import { labelSummarySchema } from './label.types';

/** Fields an asset library may be sorted on; the first is the default. */
export const ASSET_SORTABLE_FIELDS = ['createdAt', 'fileName', 'sizeBytes', 'updatedAt'] as const;

/**
 * What an asset holds, derived from its MIME type.
 *
 * A **kind** is what a creative couple asks for — an image role takes an image, whatever the exact
 * encoding — so it is answered and filtered on, while the MIME type stays the precise truth.
 */
export const assetKindSchema = z.enum(['image', 'video', 'audio', 'bundle']);

/** TypeScript type inferred from {@link assetKindSchema}. */
export type AssetKind = z.infer<typeof assetKindSchema>;

/**
 * The MIME types the library accepts, by kind.
 *
 * Nothing is accepted that no couple of the creative registry can use: a format arrives with the
 * platform study that proves a platform takes it.
 */
export const ACCEPTED_MIME_TYPES: Readonly<Record<string, AssetKind>> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
  'audio/mpeg': 'audio',
  'audio/mp4': 'audio',
  'audio/ogg': 'audio',
  'application/zip': 'bundle',
};

/** The MIME type of an asset, one the library accepts. */
export const assetMimeTypeSchema = z.enum(Object.keys(ACCEPTED_MIME_TYPES) as [string, ...string[]]);

/**
 * Where the bytes come from (`../../CADRAGE.md` § 9).
 *
 * `ai_generated` is what the generation phase writes, with the generation it came from; a client
 * upload is always `uploaded`.
 */
export const assetProvenanceSchema = z.enum(['uploaded', 'ai_generated']);

/** TypeScript type inferred from {@link assetProvenanceSchema}. */
export type AssetProvenance = z.infer<typeof assetProvenanceSchema>;

/** The longest a video or an audio may be declared, in milliseconds: six hours. */
export const MAX_ASSET_DURATION_MS = 6 * 60 * 60 * 1_000;

/**
 * Zod schema of an asset as returned by the API.
 *
 * @property id - Asset id
 * @property organizationId - Organization owning it, an opaque uuid from omnipass
 * @property advertiserId - Advertiser whose library it belongs to
 * @property fileName - Name it was uploaded under
 * @property kind - What it holds, derived from its MIME type
 * @property mimeType - Its MIME type, read from the bytes for an image
 * @property sizeBytes - Its weight
 * @property width - Pixels, for an image; `null` otherwise
 * @property height - Pixels, for an image; `null` otherwise
 * @property durationMs - Milliseconds, **declared** by the caller for a video or an audio
 * @property fingerprint - SHA-256 of the bytes: the same file twice is the same asset
 * @property provenance - Uploaded, or produced by a generation
 * @property aiGenerationId - The generation it came from, `null` otherwise
 * @property downloadUrl - A presigned URL, valid for a while
 * @property labels - The Labels posted on it
 * @property createdAt - Creation date (ISO 8601)
 * @property updatedAt - Last update date (ISO 8601)
 * @property deletedAt - Deletion date (ISO 8601), `null` while it lives
 */
export const assetSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  advertiserId: z.uuid(),
  fileName: z.string(),
  kind: assetKindSchema,
  mimeType: z.string(),
  sizeBytes: z.number().int().min(0),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  fingerprint: z.string(),
  provenance: assetProvenanceSchema,
  aiGenerationId: z.uuid().nullable(),
  downloadUrl: z.string(),
  labels: z.array(labelSummarySchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});

/** TypeScript type inferred from {@link assetSchema}. */
export type Asset = z.infer<typeof assetSchema>;

/** Zod schema of a page of assets. */
export const assetPageSchema = paginatedSchema(assetSchema);

/**
 * Zod schema of the querystring listing the assets of an Advertiser.
 *
 * @property kind - Only the assets of that kind
 */
export const listAssetsQuerySchema = listQuerySchema(ASSET_SORTABLE_FIELDS).extend({
  kind: assetKindSchema.optional(),
});

/** TypeScript type inferred from {@link listAssetsQuerySchema}, after defaults apply. */
export type ListAssetsQuery = z.infer<typeof listAssetsQuerySchema>;

/**
 * Zod schema of the fields a multipart upload may carry beside its file.
 *
 * `durationMs` is **declared**: measuring it would need `ffprobe`, which the image does not carry,
 * and the platforms revalidate anyway (`docs/phase-6.md` § 10).
 *
 * @property durationMs - Length of a video or an audio
 * @property labelIds - Labels to post on it right away
 */
export const uploadAssetFieldsSchema = z.strictObject({
  durationMs: z.coerce.number().int().min(1).max(MAX_ASSET_DURATION_MS).optional(),
  labelIds: z.array(z.uuid()).optional(),
});

/** TypeScript type inferred from {@link uploadAssetFieldsSchema}. */
export type UploadAssetFields = z.infer<typeof uploadAssetFieldsSchema>;

/**
 * Zod schema of the body updating an asset.
 *
 * The **bytes never change**: a new file is a new asset, which is what makes a version's assets
 * immutable in practice.
 *
 * @property fileName - New name
 */
export const updateAssetBodySchema = z.strictObject({
  fileName: z.string().trim().min(1).max(255).optional(),
});

/** TypeScript type inferred from {@link updateAssetBodySchema}. */
export type UpdateAssetBody = z.infer<typeof updateAssetBodySchema>;

/** How long a base64 payload may be: the upload cap, plus the third the encoding adds. */
export const MAX_BASE64_LENGTH = 40 * 1_048_576;

/**
 * Zod schema of the MCP input uploading an asset, the file in **base64**.
 *
 * An MCP tool has no multipart body, so the bytes travel encoded and the type is declared — which is
 * verified anyway for an image, its header giving the truth (`docs/phase-6.md` § 10).
 *
 * @property fileName - Name to store it under
 * @property mimeType - The type the caller declares
 * @property base64 - The bytes, base64-encoded
 * @property durationMs - Length of a video or an audio
 * @property labelIds - Labels to post on it right away
 */
export const uploadAssetInputSchema = z.strictObject({
  fileName: z.string().trim().min(1).max(255),
  mimeType: assetMimeTypeSchema,
  base64: z.string().min(1).max(MAX_BASE64_LENGTH).describe('File content, base64-encoded'),
  durationMs: z.number().int().min(1).max(MAX_ASSET_DURATION_MS).optional(),
  labelIds: z.array(z.uuid()).optional(),
});

/** TypeScript type inferred from {@link uploadAssetInputSchema}. */
export type UploadAssetInput = z.infer<typeof uploadAssetInputSchema>;
