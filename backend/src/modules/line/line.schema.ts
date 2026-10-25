import type { FastifySchema } from 'fastify';

import {
  bulkLineResultSchema,
  bulkCreateLinesBodySchema,
  bulkDeletionResultSchema,
  bulkIdsBodySchema,
  bulkUpdateLinesBodySchema,
  linePageSchema,
  lineSchema,
  createLineBodySchema,
  deletionResultSchema,
  idParamSchema,
  listLinesQuerySchema,
  organizationHeadersSchema,
  setLabelsBodySchema,
  updateLineBodySchema,
} from '@src/types';
import { errorResponses, toJsonSchema } from '@utils';

/** Tag grouping the Line routes in Swagger. */
const TAGS: string[] = ['Lines'];

/** Headers of every Line route: they all act on one Organization. */
const headers: object = toJsonSchema(organizationHeadersSchema, 'input');

/** Params of a route naming one resource, the TargetingGroup of a nested route included. */
const params: object = toJsonSchema(idParamSchema, 'input');

/** Fastify schema for `GET /targeting-groups/:id/lines`. */
export const listLinesSchema: FastifySchema = {
  tags: TAGS,
  description: 'List the Lines of a TargetingGroup, filtered by name and by Labels (viewer)',
  headers,
  params,
  querystring: toJsonSchema(listLinesQuerySchema, 'input'),
  response: { 200: toJsonSchema(linePageSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /targeting-groups/:id/lines`. */
export const createLineSchema: FastifySchema = {
  tags: TAGS,
  description: 'Create a Line under a TargetingGroup, with the landing page that overrides the creative (manager)',
  headers,
  params,
  body: toJsonSchema(createLineBodySchema, 'input'),
  response: { 201: toJsonSchema(lineSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `GET /lines/:id`. */
export const getLineSchema: FastifySchema = {
  tags: TAGS,
  description: 'Get a Line, deleted or not, with its budget resolved (viewer)',
  headers,
  params,
  response: { 200: toJsonSchema(lineSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PATCH /lines/:id`. */
export const updateLineSchema: FastifySchema = {
  tags: TAGS,
  description: 'Update a Line (manager); its status moves with the lifecycle, not here',
  headers,
  params,
  body: toJsonSchema(updateLineBodySchema, 'input'),
  response: { 200: toJsonSchema(lineSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `DELETE /lines/:id`. */
export const deleteLineSchema: FastifySchema = {
  tags: TAGS,
  description: 'Delete a Line and its whole subtree (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /lines/:id/restore`. */
export const restoreLineSchema: FastifySchema = {
  tags: TAGS,
  description: 'Restore a Line and the subtree its deletion took with it (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `PUT /lines/:id/labels`. */
export const setLineLabelsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Post the complete set of Labels a Line carries, replacing what it had (manager)',
  headers,
  params,
  body: toJsonSchema(setLabelsBodySchema, 'input'),
  response: { 200: toJsonSchema(lineSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /targeting-groups/:id/lines/bulk`. */
export const bulkCreateLinesSchema: FastifySchema = {
  tags: TAGS,
  description: 'Create several Lines, all or nothing (atomic) or item by item (partial) (manager)',
  headers,
  params,
  body: toJsonSchema(bulkCreateLinesBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkLineResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PATCH /lines/bulk`. */
export const bulkUpdateLinesSchema: FastifySchema = {
  tags: TAGS,
  description: 'Update several Lines, all or nothing (atomic) or item by item (partial) (manager)',
  headers,
  body: toJsonSchema(bulkUpdateLinesBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkLineResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `DELETE /lines/bulk`. */
export const bulkDeleteLinesSchema: FastifySchema = {
  tags: TAGS,
  description: 'Delete several Lines with their subtrees, atomically or item by item (manager)',
  headers,
  body: toJsonSchema(bulkIdsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkDeletionResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /lines/bulk/restore`. */
export const bulkRestoreLinesSchema: FastifySchema = {
  tags: TAGS,
  description: 'Restore several Lines with their subtrees, atomically or item by item (manager)',
  headers,
  body: toJsonSchema(bulkIdsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkDeletionResultSchema), ...errorResponses(400, 401, 403, 404, 409) },
};
