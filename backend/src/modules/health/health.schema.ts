import type { FastifySchema } from 'fastify';

import { healthReportSchema } from '@src/types';
import { toJsonSchema } from '@utils';

/** @internal Response map shared by every probe route: same payload for healthy and unhealthy. */
const probeResponse: Record<number, object> = {
  200: toJsonSchema(healthReportSchema),
  503: toJsonSchema(healthReportSchema),
};

/**
 * Fastify schema for the `GET /livez` route.
 *
 * The response JSON Schema is derived from {@link healthReportSchema} via
 * {@link toJsonSchema}, ensuring a single source of truth.
 */
export const getLivezSchema: FastifySchema = {
  tags: ['Health'],
  description: 'Kubernetes liveness probe — 503 means the container should be restarted',
  security: [],
  response: probeResponse,
};

/**
 * Fastify schema for the `GET /readyz` route.
 */
export const getReadyzSchema: FastifySchema = {
  tags: ['Health'],
  description: 'Kubernetes readiness probe — 503 means the pod should not receive traffic',
  security: [],
  response: probeResponse,
};

/**
 * Fastify schema for the `GET /healthz` route.
 */
export const getHealthzSchema: FastifySchema = {
  tags: ['Health'],
  description: 'Aggregate health of every registered check (liveness and readiness)',
  security: [],
  response: probeResponse,
};
