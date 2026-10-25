import type { FastifySchema } from 'fastify';

import {
  bulkCreateListsBodySchema,
  bulkDeletionResultSchema,
  bulkIdsBodySchema,
  bulkListResultSchema,
  bulkUpdateListsBodySchema,
  createListBodySchema,
  deletionResultSchema,
  idParamSchema,
  listListsQuerySchema,
  listPageSchema,
  listSchema,
  organizationHeadersSchema,
  transferListBodySchema,
  updateListBodySchema,
} from '@src/types';
import { errorResponses, toJsonSchema } from '@utils';

/** Tag grouping the list routes in Swagger. */
const TAGS: string[] = ['Lists'];

/** Headers of every list route: they all act on one Organization. */
const headers: object = toJsonSchema(organizationHeadersSchema, 'input');

/** Params of a route naming one list. */
const params: object = toJsonSchema(idParamSchema, 'input');

/** Fastify schema for `GET /lists`. */
export const listListsSchema: FastifySchema = {
  tags: TAGS,
  description: 'List the reusable lists of an Organization, filtered by kind and by name (viewer)',
  headers,
  querystring: toJsonSchema(listListsQuerySchema, 'input'),
  response: { 200: toJsonSchema(listPageSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /lists`. */
export const createListSchema: FastifySchema = {
  tags: TAGS,
  description: 'Create a reusable list; its kind decides which targeting dimensions it plugs into (manager)',
  headers,
  body: toJsonSchema(createListBodySchema, 'input'),
  response: { 201: toJsonSchema(listSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `GET /lists/:id`. */
export const getListSchema: FastifySchema = {
  tags: TAGS,
  description: 'Get a list, deleted or not, with its items (viewer)',
  headers,
  params,
  response: { 200: toJsonSchema(listSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PATCH /lists/:id`. */
export const updateListSchema: FastifySchema = {
  tags: TAGS,
  description: 'Update a list: its name, or the complete set of its items; its kind never changes (manager)',
  headers,
  params,
  body: toJsonSchema(updateListBodySchema, 'input'),
  response: { 200: toJsonSchema(listSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `DELETE /lists/:id`. */
export const deleteListSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Delete a list; the targetings referencing it are left alone, so restoring it brings them back (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /lists/:id/restore`. */
export const restoreListSchema: FastifySchema = {
  tags: TAGS,
  description: 'Restore a deleted list (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `POST /lists/:id/duplicate`. */
export const duplicateListSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Copy a list into another Organization of the same Seat; the copy is a list of its own from that ' +
    'moment (seat_admin)',
  headers,
  params,
  body: toJsonSchema(transferListBodySchema, 'input'),
  response: { 201: toJsonSchema(listSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `POST /lists/:id/move`. */
export const moveListSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Move a list into another Organization of the same Seat; refused while a targeting of this ' +
    'Organization still references it, duplicate it instead (seat_admin)',
  headers,
  params,
  body: toJsonSchema(transferListBodySchema, 'input'),
  response: { 200: toJsonSchema(listSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `POST /lists/bulk`. */
export const bulkCreateListsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Create several lists, atomically or item by item (manager)',
  headers,
  body: toJsonSchema(bulkCreateListsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkListResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PATCH /lists/bulk`. */
export const bulkUpdateListsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Update several lists, atomically or item by item (manager)',
  headers,
  body: toJsonSchema(bulkUpdateListsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkListResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `DELETE /lists/bulk`. */
export const bulkDeleteListsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Delete several lists, atomically or item by item (manager)',
  headers,
  body: toJsonSchema(bulkIdsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkDeletionResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /lists/bulk/restore`. */
export const bulkRestoreListsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Restore several lists, atomically or item by item (manager)',
  headers,
  body: toJsonSchema(bulkIdsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkDeletionResultSchema), ...errorResponses(400, 401, 403, 404) },
};
