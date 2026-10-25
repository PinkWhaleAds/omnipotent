import type { FastifySchema } from 'fastify';

import { targetingObjectSchema } from '@src/targeting/dimensions';
import {
  dimensionParamSchema,
  idParamSchema,
  leverSchema,
  organizationHeadersSchema,
  setTargetingDimensionBodySchema,
  targetingCatalogSchema,
  targetingDimensionSchema,
} from '@src/types';
import { errorResponses, toJsonSchema } from '@utils';
import { z } from 'zod';

/** Tag grouping the targeting routes in Swagger. */
const TAGS: string[] = ['Targeting'];

/** Headers of every targeting route of a node: they all act on one Organization. */
const headers: object = toJsonSchema(organizationHeadersSchema, 'input');

/** Params of a route naming one TargetingGroup. */
const params: object = toJsonSchema(idParamSchema, 'input');

/** Params of a route naming one TargetingGroup and one dimension. */
const dimensionParams: object = toJsonSchema(idParamSchema.extend(dimensionParamSchema.shape), 'input');

/**
 * Zod schema of what a read or a write of a targeting answers.
 *
 * Composed from the registry, so Swagger documents the shape of **every** dimension and a front holds
 * no copy of any of them (`docs/phase-5.md` § 2).
 */
const targetingResponseSchema = z.object({
  targetingGroupId: z.uuid(),
  lever: leverSchema,
  permittedDimensions: z.array(targetingDimensionSchema),
  targeting: targetingObjectSchema,
});

/** Zod schema of the body replacing a whole targeting. */
export const setTargetingBodySchema = z.strictObject({ targeting: targetingObjectSchema });

/** Fastify schema for `GET /targeting-dimensions`. */
export const getTargetingDimensionsSchema: FastifySchema = {
  tags: TAGS,
  description:
    'The targeting dimensions this API knows, with the JSON schema of each one’s criteria: what a ' +
    'TargetingGroup can be targeted on, whatever its lever',
  response: { 200: toJsonSchema(targetingCatalogSchema), ...errorResponses(401) },
};

/** Fastify schema for `GET /targeting-groups/:id/targeting`. */
export const getTargetingSchema: FastifySchema = {
  tags: TAGS,
  description: 'Get the targeting of a TargetingGroup, with the dimensions its lever permits (viewer)',
  headers,
  params,
  response: { 200: toJsonSchema(targetingResponseSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PUT /targeting-groups/:id/targeting`. */
export const setTargetingSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Replace the whole targeting of a TargetingGroup: what is sent is what it targets afterwards, ' +
    'an empty object restricting nothing (manager)',
  headers,
  params,
  body: toJsonSchema(setTargetingBodySchema, 'input'),
  response: { 200: toJsonSchema(targetingResponseSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PUT /targeting-groups/:id/targeting/:dimension`. */
export const setTargetingDimensionSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Post the criteria of one dimension, replacing what it carried; their shape is the one ' +
    'GET /targeting-dimensions gives for that dimension (manager)',
  headers,
  params: dimensionParams,
  body: toJsonSchema(setTargetingDimensionBodySchema, 'input'),
  response: { 200: toJsonSchema(targetingResponseSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `DELETE /targeting-groups/:id/targeting/:dimension`. */
export const removeTargetingDimensionSchema: FastifySchema = {
  tags: TAGS,
  description: 'Drop one dimension from the targeting; dropping one it does not carry changes nothing (manager)',
  headers,
  params: dimensionParams,
  response: { 200: toJsonSchema(targetingResponseSchema), ...errorResponses(400, 401, 403, 404) },
};
