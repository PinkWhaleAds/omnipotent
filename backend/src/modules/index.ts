/**
 * @module modules
 *
 * Barrel file that registers the application controllers as Fastify plugins.
 * Register {@link Controllers} on an API process to mount every route, and
 * {@link ProbeControllers} on a worker process, which only answers probes.
 */
import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import HealthController from './health/health.controller';
import OAuthController from './oauth/oauth.controller';
import StatusController from './status/status.controller';

/**
 * Register the probe and status controllers, the only routes a worker serves.
 *
 * @param fastify - The Fastify instance to attach controllers to
 * @returns A promise that resolves once the controllers are registered
 */
async function registerProbeControllers(fastify: FastifyInstance): Promise<void> {
  await fastify.register(HealthController);
  await fastify.register(StatusController);
}

/**
 * Register all application controllers on the given Fastify instance.
 *
 * Each phase adds its resource here, in the order the API reads best; the socle only carries the
 * probes and the status.
 *
 * @param fastify - The Fastify instance to attach controllers to
 * @returns A promise that resolves once all controllers are registered
 *
 * @example
 * ```typescript
 * await fastify.register(Controllers);
 * ```
 */
async function registerControllers(fastify: FastifyInstance): Promise<void> {
  await registerProbeControllers(fastify);
  // The discovery document MCP clients read before signing in; the 401 of the MCP endpoint points at it.
  await fastify.register(OAuthController);
}

/**
 * Fastify plugin that encapsulates all application controllers.
 *
 * Wraps {@link registerControllers} with `fastify-plugin` so that
 * decorators and hooks are shared with the parent context.
 */
export const Controllers = fastifyPlugin(registerControllers);

/**
 * Fastify plugin that encapsulates the probe and status controllers only.
 */
export const ProbeControllers = fastifyPlugin(registerProbeControllers);
