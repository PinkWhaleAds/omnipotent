import type { FastifySchema } from 'fastify';

import { statusResultSchema } from '@src/types';
import { toJsonSchema } from '@utils';

/**
 * Fastify schema for the `GET /status` route.
 *
 * The 200 response JSON Schema is derived from {@link statusResultSchema}
 * via {@link toJsonSchema}, ensuring a single source of truth.
 */
export const getStatusSchema: FastifySchema = {
  tags: ['Status'],
  description: 'Returns status and version of the application',
  security: [],
  response: {
    200: toJsonSchema(statusResultSchema),
  },
};
