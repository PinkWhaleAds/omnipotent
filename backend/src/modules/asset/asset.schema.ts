import type { FastifySchema } from 'fastify';

import {
  assetPageSchema,
  assetSchema,
  deletionResultSchema,
  idParamSchema,
  listAssetsQuerySchema,
  organizationHeadersSchema,
  setLabelsBodySchema,
  updateAssetBodySchema,
} from '@src/types';
import { errorResponses, toJsonSchema } from '@utils';

/** Tag grouping the asset routes in Swagger. */
const TAGS: string[] = ['Assets'];

/** Headers of every asset route: they all act on one Organization. */
const headers: object = toJsonSchema(organizationHeadersSchema, 'input');

/** Params of a route naming one resource, the Advertiser of a nested route included. */
const params: object = toJsonSchema(idParamSchema, 'input');

/** Fastify schema for `GET /advertisers/:id/assets`. */
export const listAssetsSchema: FastifySchema = {
  tags: TAGS,
  description: 'List the assets of an Advertiser, filtered by kind, by name and by Labels (viewer)',
  headers,
  params,
  querystring: toJsonSchema(listAssetsQuerySchema, 'input'),
  response: { 200: toJsonSchema(assetPageSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /advertisers/:id/assets`. */
export const uploadAssetSchema: FastifySchema = {
  tags: TAGS,
  description: [
    'Put a file in the library of an Advertiser (manager).',
    '',
    'Send `multipart/form-data` with:',
    '- `file` — the file itself: JPEG, PNG, WebP, GIF, MP4, WebM, MP3, M4A, OGG or ZIP;',
    '- `durationMs` — optional text field, the length of a video or an audio in milliseconds;',
    '- `labelIds` — optional text field, a JSON array of Label ids.',
    '',
    'The same bytes twice answer the **same asset** with **200**, a new one with **201**: the',
    'fingerprint is unique per Advertiser, so an upload can be retried.',
    '',
    'An image is verified against its bytes, which give its real type and its dimensions. A video, an',
    'audio or a bundle is taken as declared.',
  ].join('\n'),
  consumes: ['multipart/form-data'],
  headers,
  params,
  response: {
    200: toJsonSchema(assetSchema),
    201: toJsonSchema(assetSchema),
    ...errorResponses(400, 401, 403, 404, 413, 415),
  },
};

/** Fastify schema for `GET /assets/:id`. */
export const getAssetSchema: FastifySchema = {
  tags: TAGS,
  description: 'Get an asset, deleted or not, with a download URL valid for a while (viewer)',
  headers,
  params,
  response: { 200: toJsonSchema(assetSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PATCH /assets/:id`. */
export const updateAssetSchema: FastifySchema = {
  tags: TAGS,
  description: 'Rename an asset; its bytes never change, a new file being a new asset (manager)',
  headers,
  params,
  body: toJsonSchema(updateAssetBodySchema, 'input'),
  response: { 200: toJsonSchema(assetSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `DELETE /assets/:id`. */
export const deleteAssetSchema: FastifySchema = {
  tags: TAGS,
  description: 'Delete an asset; refused while a living creative uses it, so no creative ever breaks (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `POST /assets/:id/restore`. */
export const restoreAssetSchema: FastifySchema = {
  tags: TAGS,
  description: 'Restore a deleted asset (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `PUT /assets/:id/labels`. */
export const setAssetLabelsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Post the complete set of Labels an asset carries, replacing what it had (manager)',
  headers,
  params,
  body: toJsonSchema(setLabelsBodySchema, 'input'),
  response: { 200: toJsonSchema(assetSchema), ...errorResponses(400, 401, 403, 404) },
};
