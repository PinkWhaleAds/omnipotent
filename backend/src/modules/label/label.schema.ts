import type { FastifySchema } from 'fastify';

import {
  bulkCreateLabelsBodySchema,
  bulkDeletionResultSchema,
  bulkIdsBodySchema,
  bulkLabelResultSchema,
  bulkUpdateLabelsBodySchema,
  createLabelBodySchema,
  deletionResultSchema,
  idParamSchema,
  labelledResourcePageSchema,
  labelPageSchema,
  labelSchema,
  listLabelsQuerySchema,
  organizationHeadersSchema,
  paginationQuerySchema,
  updateLabelBodySchema,
} from '@src/types';
import { errorResponses, toJsonSchema } from '@utils';

/** Tag grouping the Label routes in Swagger. */
const TAGS: string[] = ['Labels'];

/** Headers of every Label route: they all act on one Organization. */
const headers: object = toJsonSchema(organizationHeadersSchema, 'input');

/** Params of every route naming one Label. */
const params: object = toJsonSchema(idParamSchema, 'input');

/** Fastify schema for `GET /labels`. */
export const listLabelsSchema: FastifySchema = {
  tags: TAGS,
  description: 'List the Labels of the Organization, filtered by name (viewer)',
  headers,
  querystring: toJsonSchema(listLabelsQuerySchema, 'input'),
  response: { 200: toJsonSchema(labelPageSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /labels`. */
export const createLabelSchema: FastifySchema = {
  tags: TAGS,
  description: 'Create a Label in the Organization (manager)',
  headers,
  body: toJsonSchema(createLabelBodySchema, 'input'),
  response: { 201: toJsonSchema(labelSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `GET /labels/:id`. */
export const getLabelSchema: FastifySchema = {
  tags: TAGS,
  description: 'Get a Label of the Organization, deleted or not (viewer)',
  headers,
  params,
  response: { 200: toJsonSchema(labelSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PATCH /labels/:id`. */
export const updateLabelSchema: FastifySchema = {
  tags: TAGS,
  description: 'Rename a Label or change its colour (manager)',
  headers,
  params,
  body: toJsonSchema(updateLabelBodySchema, 'input'),
  response: { 200: toJsonSchema(labelSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `DELETE /labels/:id`. */
export const deleteLabelSchema: FastifySchema = {
  tags: TAGS,
  description: 'Delete a Label, which hides it from the resources carrying it (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /labels/:id/restore`. */
export const restoreLabelSchema: FastifySchema = {
  tags: TAGS,
  description: 'Restore a deleted Label, which shows its assignments again (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `GET /labels/:id/resources`. */
export const listLabelResourcesSchema: FastifySchema = {
  tags: TAGS,
  description: 'List what a Label marks, whatever the kind of resource (viewer)',
  headers,
  params,
  querystring: toJsonSchema(paginationQuerySchema, 'input'),
  response: { 200: toJsonSchema(labelledResourcePageSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /labels/bulk`. */
export const bulkCreateLabelsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Create several Labels, all or nothing (atomic) or item by item (partial) (manager)',
  headers,
  body: toJsonSchema(bulkCreateLabelsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkLabelResultSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `PATCH /labels/bulk`. */
export const bulkUpdateLabelsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Update several Labels, all or nothing (atomic) or item by item (partial) (manager)',
  headers,
  body: toJsonSchema(bulkUpdateLabelsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkLabelResultSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `DELETE /labels/bulk`. */
export const bulkDeleteLabelsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Delete several Labels, all or nothing (atomic) or item by item (partial) (manager)',
  headers,
  body: toJsonSchema(bulkIdsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkDeletionResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /labels/bulk/restore`. */
export const bulkRestoreLabelsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Restore several deleted Labels, all or nothing (atomic) or item by item (partial) (manager)',
  headers,
  body: toJsonSchema(bulkIdsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkDeletionResultSchema), ...errorResponses(400, 401, 403, 404, 409) },
};
