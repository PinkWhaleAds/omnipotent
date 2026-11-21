import type { FastifySchema } from 'fastify';

import {
  conversionGoalPageSchema,
  conversionGoalSchema,
  createConversionGoalBodySchema,
  idParamSchema,
  listConversionGoalsQuerySchema,
  organizationHeadersSchema,
  updateConversionGoalBodySchema,
} from '@src/types';
import { errorResponses, toJsonSchema } from '@utils';

/** Tag grouping the conversion goal routes in Swagger. */
const TAGS: string[] = ['Conversions'];

/** Headers of every conversion goal route: they all act on one Organization. */
const headers: object = toJsonSchema(organizationHeadersSchema, 'input');

/** Params of a route naming one resource, the Advertiser of a nested route included. */
const params: object = toJsonSchema(idParamSchema, 'input');

/** Fastify schema for `GET /advertisers/:id/conversion-goals`. */
export const listConversionGoalsSchema: FastifySchema = {
  tags: TAGS,
  description:
    'List the conversion goals of an Advertiser, oldest first, archived ones included unless filtered (viewer)',
  headers,
  params,
  querystring: toJsonSchema(listConversionGoalsQuerySchema, 'input'),
  response: { 200: toJsonSchema(conversionGoalPageSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /advertisers/:id/conversion-goals`. */
export const createConversionGoalSchema: FastifySchema = {
  tags: TAGS,
  description: [
    'Give an Advertiser a conversion goal (manager): what its site sends with',
    "`msq('conversion', { goal: '<key>' })`. Its key and its category never change.",
    '',
    'A value (`fixed`, or `dynamic` with a fallback) needs a currency, and a fixed one an amount in cents.',
    'The goal is then set up on every account of the Advertiser: `GET /advertisers/:id/tracking` says',
    'where it stands on each.',
  ].join('\n'),
  headers,
  params,
  body: toJsonSchema(createConversionGoalBodySchema, 'input'),
  response: { 201: toJsonSchema(conversionGoalSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `GET /conversion-goals/:id`. */
export const getConversionGoalSchema: FastifySchema = {
  tags: TAGS,
  description: 'Get a conversion goal of the Organization (viewer)',
  headers,
  params,
  response: { 200: toJsonSchema(conversionGoalSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PATCH /conversion-goals/:id`. */
export const updateConversionGoalSchema: FastifySchema = {
  tags: TAGS,
  description: [
    'Change a conversion goal (manager): its name, its value, its counting, its status. Its key and its',
    'category never change. `status: archived` stops measuring it — nothing is deleted at the platforms —,',
    'and is refused while an AdGroup of a launched campaign optimizes it.',
  ].join('\n'),
  headers,
  params,
  body: toJsonSchema(updateConversionGoalBodySchema, 'input'),
  response: { 200: toJsonSchema(conversionGoalSchema), ...errorResponses(400, 401, 403, 404, 409) },
};
