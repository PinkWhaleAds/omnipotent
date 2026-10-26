import type { FastifySchema } from 'fastify';

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
  idParamSchema,
  listCreativeVersionsQuerySchema,
  listCreativesQuerySchema,
  organizationHeadersSchema,
  setLabelsBodySchema,
  updateCreativeBodySchema,
} from '@src/types';
import { errorResponses, toJsonSchema } from '@utils';

/** Tag grouping the creative routes in Swagger. */
const TAGS: string[] = ['Creatives'];

/** Headers of every creative route: they all act on one Organization. */
const headers: object = toJsonSchema(organizationHeadersSchema, 'input');

/** Params of a route naming one resource, the Advertiser of a nested route included. */
const params: object = toJsonSchema(idParamSchema, 'input');

/** Fastify schema for `GET /creative-formats`. */
export const getCreativeFormatsSchema: FastifySchema = {
  tags: TAGS,
  description:
    'The couples (format, subtype) this API knows, with the JSON schema of each payload and the asset ' +
    'roles it needs: what a creative can be, whatever the platform',
  response: { 200: toJsonSchema(creativeCatalogSchema), ...errorResponses(401) },
};

/** Fastify schema for `GET /advertisers/:id/creatives`. */
export const listCreativesSchema: FastifySchema = {
  tags: TAGS,
  description: 'List the creatives of an Advertiser, filtered by couple, by name and by Labels (viewer)',
  headers,
  params,
  querystring: toJsonSchema(listCreativesQuerySchema, 'input'),
  response: { 200: toJsonSchema(creativePageSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /advertisers/:id/creatives`. */
export const createCreativeSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Create a creative **and its first version**, which delivers at once; the format and the subtype ' +
    'never change afterwards (manager)',
  headers,
  params,
  body: toJsonSchema(createCreativeBodySchema, 'input'),
  response: { 201: toJsonSchema(creativeSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `GET /creatives/:id`. */
export const getCreativeSchema: FastifySchema = {
  tags: TAGS,
  description: 'Get a creative, deleted or not, with the version that delivers (viewer)',
  headers,
  params,
  response: { 200: toJsonSchema(creativeSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PATCH /creatives/:id`. */
export const updateCreativeSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Update what stays true across versions: the name, the IAB categories, the click URL. A new ' +
    'payload is a new version (manager)',
  headers,
  params,
  body: toJsonSchema(updateCreativeBodySchema, 'input'),
  response: { 200: toJsonSchema(creativeSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `DELETE /creatives/:id`. */
export const deleteCreativeSchema: FastifySchema = {
  tags: TAGS,
  description: 'Delete a creative and its versions; its assets survive, being resources of their own (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /creatives/:id/restore`. */
export const restoreCreativeSchema: FastifySchema = {
  tags: TAGS,
  description: 'Restore a deleted creative, its versions with it (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `PUT /creatives/:id/labels`. */
export const setCreativeLabelsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Post the complete set of Labels a creative carries, replacing what it had (manager)',
  headers,
  params,
  body: toJsonSchema(setLabelsBodySchema, 'input'),
  response: { 200: toJsonSchema(creativeSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `GET /creatives/:id/versions`. */
export const listCreativeVersionsSchema: FastifySchema = {
  tags: TAGS,
  description: 'List the versions of a creative, the most recent first (viewer)',
  headers,
  params,
  querystring: toJsonSchema(listCreativeVersionsQuerySchema, 'input'),
  response: { 200: toJsonSchema(creativeVersionPageSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /creatives/:id/versions`. */
export const createCreativeVersionSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Add a version to a creative; nothing existing is touched and the new one does not deliver until ' +
    'it is activated (manager)',
  headers,
  params,
  body: toJsonSchema(createCreativeVersionBodySchema, 'input'),
  response: { 201: toJsonSchema(creativeVersionSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `GET /creative-versions/:id`. */
export const getCreativeVersionSchema: FastifySchema = {
  tags: TAGS,
  description: 'Get one version and the assets it uses (viewer)',
  headers,
  params,
  response: { 200: toJsonSchema(creativeVersionSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /creative-versions/:id/activate`. */
export const activateCreativeVersionSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Put a version in delivery. Explicit for now: when the platforms validate, their approval will ' +
    'drive it, and the previous version serves until then (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(creativeVersionSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /advertisers/:id/creatives/bulk`. */
export const bulkCreateCreativesSchema: FastifySchema = {
  tags: TAGS,
  description: 'Create several creatives, atomically or item by item (manager)',
  headers,
  params,
  body: toJsonSchema(bulkCreateCreativesBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkCreativeResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PATCH /creatives/bulk`. */
export const bulkUpdateCreativesSchema: FastifySchema = {
  tags: TAGS,
  description: 'Update several creatives, atomically or item by item (manager)',
  headers,
  body: toJsonSchema(bulkUpdateCreativesBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkCreativeResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `DELETE /creatives/bulk`. */
export const bulkDeleteCreativesSchema: FastifySchema = {
  tags: TAGS,
  description: 'Delete several creatives, atomically or item by item (manager)',
  headers,
  body: toJsonSchema(bulkIdsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkDeletionResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /creatives/bulk/restore`. */
export const bulkRestoreCreativesSchema: FastifySchema = {
  tags: TAGS,
  description: 'Restore several creatives, atomically or item by item (manager)',
  headers,
  body: toJsonSchema(bulkIdsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkDeletionResultSchema), ...errorResponses(400, 401, 403, 404) },
};
