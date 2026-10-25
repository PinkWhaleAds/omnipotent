import type { FastifySchema } from 'fastify';

import {
  advertiserPageSchema,
  advertiserSchema,
  bulkAdvertiserResultSchema,
  bulkCreateAdvertisersBodySchema,
  bulkDeletionResultSchema,
  bulkIdsBodySchema,
  bulkUpdateAdvertisersBodySchema,
  createAdvertiserBodySchema,
  deletionResultSchema,
  idParamSchema,
  listAdvertisersQuerySchema,
  organizationHeadersSchema,
  setLabelsBodySchema,
  updateAdvertiserBodySchema,
} from '@src/types';
import { errorResponses, toJsonSchema } from '@utils';

/** Tag grouping the Advertiser routes in Swagger. */
const TAGS: string[] = ['Advertisers'];

/** Headers of every Advertiser route: they all act on one Organization. */
const headers: object = toJsonSchema(organizationHeadersSchema, 'input');

/** Params of every route naming one Advertiser. */
const params: object = toJsonSchema(idParamSchema, 'input');

/** Fastify schema for `GET /advertisers`. */
export const listAdvertisersSchema: FastifySchema = {
  tags: TAGS,
  description: 'List the Advertisers of the Organization, filtered by name and by Labels (viewer)',
  headers,
  querystring: toJsonSchema(listAdvertisersQuerySchema, 'input'),
  response: { 200: toJsonSchema(advertiserPageSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /advertisers`. */
export const createAdvertiserSchema: FastifySchema = {
  tags: TAGS,
  description: 'Create an Advertiser in the Organization, with its Labels (manager)',
  headers,
  body: toJsonSchema(createAdvertiserBodySchema, 'input'),
  response: { 201: toJsonSchema(advertiserSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `GET /advertisers/:id`. */
export const getAdvertiserSchema: FastifySchema = {
  tags: TAGS,
  description: 'Get an Advertiser of the Organization, deleted or not (viewer)',
  headers,
  params,
  response: { 200: toJsonSchema(advertiserSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PATCH /advertisers/:id`. */
export const updateAdvertiserSchema: FastifySchema = {
  tags: TAGS,
  description: 'Update an Advertiser of the Organization (manager); websiteUrl null clears it',
  headers,
  params,
  body: toJsonSchema(updateAdvertiserBodySchema, 'input'),
  response: { 200: toJsonSchema(advertiserSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `DELETE /advertisers/:id`. */
export const deleteAdvertiserSchema: FastifySchema = {
  tags: TAGS,
  description: 'Delete an Advertiser of the Organization, which frees its name (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /advertisers/:id/restore`. */
export const restoreAdvertiserSchema: FastifySchema = {
  tags: TAGS,
  description: 'Restore a deleted Advertiser of the Organization (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `PUT /advertisers/:id/labels`. */
export const setAdvertiserLabelsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Post the complete set of Labels an Advertiser carries, replacing what it had (manager)',
  headers,
  params,
  body: toJsonSchema(setLabelsBodySchema, 'input'),
  response: { 200: toJsonSchema(advertiserSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /advertisers/bulk`. */
export const bulkCreateAdvertisersSchema: FastifySchema = {
  tags: TAGS,
  description: 'Create several Advertisers, all or nothing (atomic) or item by item (partial) (manager)',
  headers,
  body: toJsonSchema(bulkCreateAdvertisersBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkAdvertiserResultSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `PATCH /advertisers/bulk`. */
export const bulkUpdateAdvertisersSchema: FastifySchema = {
  tags: TAGS,
  description: 'Update several Advertisers, all or nothing (atomic) or item by item (partial) (manager)',
  headers,
  body: toJsonSchema(bulkUpdateAdvertisersBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkAdvertiserResultSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `DELETE /advertisers/bulk`. */
export const bulkDeleteAdvertisersSchema: FastifySchema = {
  tags: TAGS,
  description: 'Delete several Advertisers, all or nothing (atomic) or item by item (partial) (manager)',
  headers,
  body: toJsonSchema(bulkIdsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkDeletionResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /advertisers/bulk/restore`. */
export const bulkRestoreAdvertisersSchema: FastifySchema = {
  tags: TAGS,
  description: 'Restore several deleted Advertisers, all or nothing (atomic) or item by item (partial) (manager)',
  headers,
  body: toJsonSchema(bulkIdsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkDeletionResultSchema), ...errorResponses(400, 401, 403, 404, 409) },
};
