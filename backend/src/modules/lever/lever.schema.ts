import type { FastifySchema } from 'fastify';

import {
  campaignLeverPageSchema,
  campaignLeverSchema,
  createLeverBodySchema,
  deletionResultSchema,
  idParamSchema,
  listLeversQuerySchema,
  organizationHeadersSchema,
  setLabelsBodySchema,
  updateLeverBodySchema,
} from '@src/types';
import { errorResponses, toJsonSchema } from '@utils';

/** Tag grouping the Lever routes in Swagger. */
const TAGS: string[] = ['Levers'];

/** Headers of every Lever route: they all act on one Organization. */
const headers: object = toJsonSchema(organizationHeadersSchema, 'input');

/** Params of a route naming one resource, the Campaign of a nested route included. */
const params: object = toJsonSchema(idParamSchema, 'input');

/** Fastify schema for `GET /campaigns/:id/levers`. */
export const listLeversSchema: FastifySchema = {
  tags: TAGS,
  description: 'List the Levers of a Campaign, filtered by name and by Labels (viewer)',
  headers,
  params,
  querystring: toJsonSchema(listLeversQuerySchema, 'input'),
  response: { 200: toJsonSchema(campaignLeverPageSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /campaigns/:id/levers`. */
export const createLeverSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Create a Lever under a Campaign: its channel and its distribution key come together; a campaign carries at most one lever of each channel (manager)',
  headers,
  params,
  body: toJsonSchema(createLeverBodySchema, 'input'),
  response: { 201: toJsonSchema(campaignLeverSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `GET /levers/:id`. */
export const getLeverSchema: FastifySchema = {
  tags: TAGS,
  description: 'Get a Lever, deleted or not, with its budget resolved (viewer)',
  headers,
  params,
  response: { 200: toJsonSchema(campaignLeverSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PATCH /levers/:id`. */
export const updateLeverSchema: FastifySchema = {
  tags: TAGS,
  description: 'Update a Lever (manager); its status moves with the lifecycle, not here',
  headers,
  params,
  body: toJsonSchema(updateLeverBodySchema, 'input'),
  response: { 200: toJsonSchema(campaignLeverSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `DELETE /levers/:id`. */
export const deleteLeverSchema: FastifySchema = {
  tags: TAGS,
  description: 'Delete a Lever and its whole subtree (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /levers/:id/restore`. */
export const restoreLeverSchema: FastifySchema = {
  tags: TAGS,
  description: 'Restore a Lever and the subtree its deletion took with it (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `PUT /levers/:id/labels`. */
export const setLeverLabelsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Post the complete set of Labels a Lever carries, replacing what it had (manager)',
  headers,
  params,
  body: toJsonSchema(setLabelsBodySchema, 'input'),
  response: { 200: toJsonSchema(campaignLeverSchema), ...errorResponses(400, 401, 403, 404) },
};
