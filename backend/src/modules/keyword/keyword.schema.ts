import type { FastifySchema } from 'fastify';

import {
  addKeywordsBodySchema,
  addKeywordsResultSchema,
  idParamSchema,
  keywordPageSchema,
  keywordRemovalSchema,
  keywordSchema,
  listKeywordsQuerySchema,
  organizationHeadersSchema,
  updateKeywordBodySchema,
} from '@src/types';
import { errorResponses, toJsonSchema } from '@utils';

/** Tag grouping the keyword routes in Swagger. */
const TAGS: string[] = ['Keywords'];

/** Headers of every keyword route: they all act on one Organization. */
const headers: object = toJsonSchema(organizationHeadersSchema, 'input');

/** Params of a route naming one resource, the TargetingGroup of a nested route included. */
const params: object = toJsonSchema(idParamSchema, 'input');

/** Fastify schema for `GET /targeting-groups/:id/keywords`. */
export const listKeywordsSchema: FastifySchema = {
  tags: TAGS,
  description: 'List the keywords of a TargetingGroup, the positive ones or the negative ones (viewer)',
  headers,
  params,
  querystring: toJsonSchema(listKeywordsQuerySchema, 'input'),
  response: { 200: toJsonSchema(keywordPageSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /targeting-groups/:id/keywords`. */
export const addKeywordsSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Post keywords on a TargetingGroup; one it already carries is answered as it stands, and a text ' +
    'the platforms refuse is reported (manager)',
  headers,
  params,
  body: toJsonSchema(addKeywordsBodySchema, 'input'),
  response: { 200: toJsonSchema(addKeywordsResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PATCH /keywords/:id`. */
export const updateKeywordSchema: FastifySchema = {
  tags: TAGS,
  description: 'Change the match type or the polarity of one keyword (manager)',
  headers,
  params,
  body: toJsonSchema(updateKeywordBodySchema, 'input'),
  response: { 200: toJsonSchema(keywordSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `DELETE /keywords/:id`. */
export const deleteKeywordSchema: FastifySchema = {
  tags: TAGS,
  description: 'Remove one keyword, for good: a keyword carries no history, so there is nothing to restore (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(keywordRemovalSchema), ...errorResponses(400, 401, 403, 404) },
};
