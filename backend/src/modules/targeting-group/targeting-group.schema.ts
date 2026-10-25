import type { FastifySchema } from 'fastify';

import {
  bulkTargetingGroupResultSchema,
  bulkCreateTargetingGroupsBodySchema,
  bulkDeletionResultSchema,
  bulkIdsBodySchema,
  bulkUpdateTargetingGroupsBodySchema,
  targetingGroupPageSchema,
  targetingGroupSchema,
  createTargetingGroupBodySchema,
  deletionResultSchema,
  idParamSchema,
  listTargetingGroupsQuerySchema,
  organizationHeadersSchema,
  setLabelsBodySchema,
  updateTargetingGroupBodySchema,
} from '@src/types';
import { errorResponses, toJsonSchema } from '@utils';

/** Tag grouping the TargetingGroup routes in Swagger. */
const TAGS: string[] = ['TargetingGroups'];

/** Headers of every TargetingGroup route: they all act on one Organization. */
const headers: object = toJsonSchema(organizationHeadersSchema, 'input');

/** Params of a route naming one resource, the AdGroup of a nested route included. */
const params: object = toJsonSchema(idParamSchema, 'input');

/** Fastify schema for `GET /ad-groups/:id/targeting-groups`. */
export const listTargetingGroupsSchema: FastifySchema = {
  tags: TAGS,
  description: 'List the TargetingGroups of an AdGroup, filtered by name and by Labels (viewer)',
  headers,
  params,
  querystring: toJsonSchema(listTargetingGroupsQuerySchema, 'input'),
  response: { 200: toJsonSchema(targetingGroupPageSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /ad-groups/:id/targeting-groups`. */
export const createTargetingGroupSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Create a TargetingGroup under an AdGroup; it has no window of its own, being a targeting applied (manager)',
  headers,
  params,
  body: toJsonSchema(createTargetingGroupBodySchema, 'input'),
  response: { 201: toJsonSchema(targetingGroupSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `GET /targeting-groups/:id`. */
export const getTargetingGroupSchema: FastifySchema = {
  tags: TAGS,
  description: 'Get a TargetingGroup, deleted or not, with its budget resolved (viewer)',
  headers,
  params,
  response: { 200: toJsonSchema(targetingGroupSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PATCH /targeting-groups/:id`. */
export const updateTargetingGroupSchema: FastifySchema = {
  tags: TAGS,
  description: 'Update a TargetingGroup (manager); its status moves with the lifecycle, not here',
  headers,
  params,
  body: toJsonSchema(updateTargetingGroupBodySchema, 'input'),
  response: { 200: toJsonSchema(targetingGroupSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `DELETE /targeting-groups/:id`. */
export const deleteTargetingGroupSchema: FastifySchema = {
  tags: TAGS,
  description: 'Delete a TargetingGroup and its whole subtree (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /targeting-groups/:id/restore`. */
export const restoreTargetingGroupSchema: FastifySchema = {
  tags: TAGS,
  description: 'Restore a TargetingGroup and the subtree its deletion took with it (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `PUT /targeting-groups/:id/labels`. */
export const setTargetingGroupLabelsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Post the complete set of Labels a TargetingGroup carries, replacing what it had (manager)',
  headers,
  params,
  body: toJsonSchema(setLabelsBodySchema, 'input'),
  response: { 200: toJsonSchema(targetingGroupSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /ad-groups/:id/targeting-groups/bulk`. */
export const bulkCreateTargetingGroupsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Create several TargetingGroups, all or nothing (atomic) or item by item (partial) (manager)',
  headers,
  params,
  body: toJsonSchema(bulkCreateTargetingGroupsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkTargetingGroupResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PATCH /targeting-groups/bulk`. */
export const bulkUpdateTargetingGroupsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Update several TargetingGroups, all or nothing (atomic) or item by item (partial) (manager)',
  headers,
  body: toJsonSchema(bulkUpdateTargetingGroupsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkTargetingGroupResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `DELETE /targeting-groups/bulk`. */
export const bulkDeleteTargetingGroupsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Delete several TargetingGroups with their subtrees, atomically or item by item (manager)',
  headers,
  body: toJsonSchema(bulkIdsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkDeletionResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /targeting-groups/bulk/restore`. */
export const bulkRestoreTargetingGroupsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Restore several TargetingGroups with their subtrees, atomically or item by item (manager)',
  headers,
  body: toJsonSchema(bulkIdsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkDeletionResultSchema), ...errorResponses(400, 401, 403, 404, 409) },
};
