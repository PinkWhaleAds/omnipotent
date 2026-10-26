import type { FastifySchema } from 'fastify';

import {
  campaignPlatformStatusSchema,
  idParamSchema,
  organizationHeadersSchema,
  platformUnitParamsSchema,
  platformUnitSchema,
  syncRequestedSchema,
} from '@src/types';
import { errorResponses, toJsonSchema } from '@utils';

/** Tag grouping the synchronization routes in Swagger. */
const TAGS: string[] = ['Synchronization'];

/** Headers of every route: they all act on one Organization. */
const headers: object = toJsonSchema(organizationHeadersSchema, 'input');

/** Fastify schema for `GET /campaigns/:id/platform-status`. */
export const getPlatformStatusSchema: FastifySchema = {
  tags: TAGS,
  description: [
    'Where a campaign stands on each of its platforms (viewer).',
    '',
    'One entry per couple (AdGroup, platform), with the id of everything that exists over there and',
    '`externalId: null` for what is still to be created. A unit in `error` carries a stable code and',
    'its values; `nextAttemptAt` is set when the failure was temporary, and `null` when trying again',
    'cannot help — that one waits for a change or for the retry route.',
  ].join('\n'),
  headers,
  params: toJsonSchema(idParamSchema, 'input'),
  response: { 200: toJsonSchema(campaignPlatformStatusSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /campaigns/:id/sync`. */
export const requestSyncSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Ask for a campaign to be applied to its platforms now. It queues the work and answers at once, ' +
    'so the platform status route is where the result shows. Changing anything already asks for this ' +
    'on its own: the route is for when something was touched by hand over there (manager)',
  headers,
  params: toJsonSchema(idParamSchema, 'input'),
  response: { 200: toJsonSchema(syncRequestedSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /campaigns/:id/platform-units/:unitId/retry`. */
export const retryPlatformUnitSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Try one unit again without waiting for its backoff. The way back for a failure that is not ' +
    'rescheduled on its own, once what caused it is fixed (manager)',
  headers,
  params: toJsonSchema(platformUnitParamsSchema, 'input'),
  response: { 200: toJsonSchema(platformUnitSchema), ...errorResponses(400, 401, 403, 404) },
};
