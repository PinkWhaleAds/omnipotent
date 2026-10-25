import fastifyCors from '@fastify/cors';
import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { httpServerConfig } from '@configs';
import { ORGANIZATION_HEADER } from '@src/types/api.types';

/** How long a browser may keep the answer to a preflight request, in seconds. */
const PREFLIGHT_MAX_AGE = 600;

/** Response headers the front may read: how long to wait after a 429 (`rate_limited`), and the rate limit left. */
const EXPOSED_HEADERS: string[] = ['Retry-After', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'];

/**
 * Lets the web front ends listed in `APP_CORS_ORIGINS` call the API from a browser.
 *
 * Only those origins get the CORS headers; without any, the plugin does nothing and
 * browsers on other origins stay refused. Requests carry a bearer token, never cookies,
 * so credentials are not allowed. The front may read `Retry-After` and the rate limit headers.
 *
 * @param fastify - The Fastify instance
 * @param options - The allowed origins (the configured ones by default)
 * @returns A promise that resolves once the plugin is registered
 *
 * @example
 * ```typescript
 * await fastify.register(CorsPlugin, { origins: ['http://localhost:5173'] });
 * ```
 */
async function CorsPlugin(fastify: FastifyInstance, options: { origins?: string[] }): Promise<void> {
  const origins: string[] = options.origins ?? httpServerConfig.corsOrigins;
  if (origins.length === 0) return;
  await fastify.register(fastifyCors, {
    origin: origins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', ORGANIZATION_HEADER],
    exposedHeaders: EXPOSED_HEADERS,
    credentials: false,
    maxAge: PREFLIGHT_MAX_AGE,
  });
}

export default fastifyPlugin(CorsPlugin, { name: 'CorsPlugin' });
