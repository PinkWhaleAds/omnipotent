import type { FastifySchema } from 'fastify';

import {
  bulkAdGroupResultSchema,
  bulkCreateAdGroupsBodySchema,
  bulkDeletionResultSchema,
  bulkIdsBodySchema,
  bulkUpdateAdGroupsBodySchema,
  adGroupPageSchema,
  adGroupSchema,
  createAdGroupBodySchema,
  deletionResultSchema,
  idParamSchema,
  listAdGroupsQuerySchema,
  organizationHeadersSchema,
  setLabelsBodySchema,
  updateAdGroupBodySchema,
} from '@src/types';
import { errorResponses, toJsonSchema } from '@utils';

/** Tag grouping the AdGroup routes in Swagger. */
const TAGS: string[] = ['AdGroups'];

/** Headers of every AdGroup route: they all act on one Organization. */
const headers: object = toJsonSchema(organizationHeadersSchema, 'input');

/** Params of a route naming one resource, the Lever of a nested route included. */
const params: object = toJsonSchema(idParamSchema, 'input');

/** Fastify schema for `GET /levers/:id/ad-groups`. */
export const listAdGroupsSchema: FastifySchema = {
  tags: TAGS,
  description: 'List the AdGroups of a Lever, filtered by name and by Labels (viewer)',
  headers,
  params,
  querystring: toJsonSchema(listAdGroupsQuerySchema, 'input'),
  response: { 200: toJsonSchema(adGroupPageSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /levers/:id/ad-groups`. */
export const createAdGroupSchema: FastifySchema = {
  tags: TAGS,
  description: 'Create an AdGroup under a Lever; its budget, its window and its currency are required (manager)',
  headers,
  params,
  body: toJsonSchema(createAdGroupBodySchema, 'input'),
  response: { 201: toJsonSchema(adGroupSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `GET /ad-groups/:id`. */
export const getAdGroupSchema: FastifySchema = {
  tags: TAGS,
  description: 'Get an AdGroup, deleted or not, with its budget resolved (viewer)',
  headers,
  params,
  response: { 200: toJsonSchema(adGroupSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PATCH /ad-groups/:id`. */
export const updateAdGroupSchema: FastifySchema = {
  tags: TAGS,
  description: 'Update an AdGroup (manager); its status moves with the lifecycle, not here',
  headers,
  params,
  body: toJsonSchema(updateAdGroupBodySchema, 'input'),
  response: { 200: toJsonSchema(adGroupSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `DELETE /ad-groups/:id`. */
export const deleteAdGroupSchema: FastifySchema = {
  tags: TAGS,
  description: 'Delete an AdGroup and its whole subtree (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /ad-groups/:id/restore`. */
export const restoreAdGroupSchema: FastifySchema = {
  tags: TAGS,
  description: 'Restore an AdGroup and the subtree its deletion took with it (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `PUT /ad-groups/:id/labels`. */
export const setAdGroupLabelsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Post the complete set of Labels an AdGroup carries, replacing what it had (manager)',
  headers,
  params,
  body: toJsonSchema(setLabelsBodySchema, 'input'),
  response: { 200: toJsonSchema(adGroupSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /levers/:id/ad-groups/bulk`. */
export const bulkCreateAdGroupsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Create several AdGroups, all or nothing (atomic) or item by item (partial) (manager)',
  headers,
  params,
  body: toJsonSchema(bulkCreateAdGroupsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkAdGroupResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PATCH /ad-groups/bulk`. */
export const bulkUpdateAdGroupsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Update several AdGroups, all or nothing (atomic) or item by item (partial) (manager)',
  headers,
  body: toJsonSchema(bulkUpdateAdGroupsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkAdGroupResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `DELETE /ad-groups/bulk`. */
export const bulkDeleteAdGroupsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Delete several AdGroups with their subtrees, atomically or item by item (manager)',
  headers,
  body: toJsonSchema(bulkIdsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkDeletionResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /ad-groups/bulk/restore`. */
export const bulkRestoreAdGroupsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Restore several AdGroups with their subtrees, atomically or item by item (manager)',
  headers,
  body: toJsonSchema(bulkIdsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkDeletionResultSchema), ...errorResponses(400, 401, 403, 404, 409) },
};
