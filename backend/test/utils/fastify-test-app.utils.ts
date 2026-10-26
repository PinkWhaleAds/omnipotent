import FastifyMultipart from '@fastify/multipart';
import Fastify, { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';

import ErrorHandlerPlugin from '@src/plugins/error-handler.plugin';
import ValidationPlugin from '@src/plugins/validation.plugin';
import type { AuthContext } from '@src/types';

/**
 * Set up a Fastify application for testing purposes.
 * It registers the provided plugin and any additional plugins.
 * The application is then awaited until it is ready.
 *
 * @param plugin - The primary Fastify plugin to register.
 * @param additionalPlugins - An optional array of additional Fastify plugins to register. Defaults to an empty array.
 * @returns A Promise that resolves to the fully initialized Fastify instance.
 *
 * @example
 * ```typescript
 * const app = await setupFastifyAppForTest(myPlugin, [authPlugin]);
 * const response = await app.inject({ method: 'GET', url: '/health' });
 * ```
 */
export async function setupFastifyAppForTest(
  plugin: FastifyPluginAsync,
  additionalPlugins: FastifyPluginAsync[] = []
): Promise<FastifyInstance> {
  const app: FastifyInstance = await createFastifyAppWithRegistration(plugin, additionalPlugins);
  await app.ready();
  return app;
}

/**
 * Create a new Fastify application instance and register the given plugin(s).
 *
 * @remark You need to manually call `Fastify.ready` or `Fastify.listen`.
 *
 * @param plugin - The primary Fastify plugin to register.
 * @param additionalPlugins - An optional array of additional Fastify plugins to register. Defaults to an empty array.
 * @returns A Promise that resolves to the Fastify instance after plugin registration.
 *
 * @example
 * ```typescript
 * const app = await createFastifyAppWithRegistration(myPlugin);
 * await app.ready();
 * ```
 */
export async function createFastifyAppWithRegistration(
  plugin: FastifyPluginAsync,
  additionalPlugins: FastifyPluginAsync[] = []
): Promise<FastifyInstance> {
  const app: FastifyInstance = Fastify();
  await app.register(plugin);
  for (const additionalPlugin of additionalPlugins) {
    await app.register(additionalPlugin);
  }
  return app;
}

/**
 * Gracefully close a Fastify test application.
 *
 * @param app - The Fastify instance to close.
 * @returns A Promise that resolves when the application has been closed.
 *
 * @example
 * ```typescript
 * afterAll(async () => {
 *   await closeTestApp(app);
 * });
 * ```
 */
export async function closeTestApp(app: FastifyInstance): Promise<void> {
  await app.close();
}

/**
 * Set up an application serving one HTTP controller, with its services mocked and the authentication
 * stood in for by a hook putting the given caller on every request.
 *
 * The error handler and the validator compiler are registered, so a spec sees the real answer of a
 * route: its status code, its validation refusals and the single error shape.
 *
 * Uploads are served too: the multipart plugin is registered as the real server registers it, so a
 * spec can post a file and read what the route answered.
 *
 * @param controller - The controller under test
 * @param services - What to decorate the instance with, by decorator name (`advertiserService`…)
 * @param actor - The caller every request is authenticated as
 * @returns The ready instance
 *
 * @example
 * ```typescript
 * const app = await setupRouteAppForTest(AdvertiserController, { advertiserService: service }, JANE);
 * await app.inject({ method: 'GET', url: '/advertisers', headers: { 'x-organization-id': IDS.organization } });
 * ```
 */
export async function setupRouteAppForTest(
  controller: FastifyPluginAsync,
  services: Record<string, unknown>,
  actor: AuthContext
): Promise<FastifyInstance> {
  const app: FastifyInstance = Fastify();
  app.decorateRequest('auth', undefined);
  app.addHook('onRequest', async (request: FastifyRequest): Promise<void> => {
    request.auth = actor;
  });
  for (const [name, service] of Object.entries(services)) app.decorate(name, service);
  await app.register(ErrorHandlerPlugin);
  await app.register(ValidationPlugin);
  await app.register(FastifyMultipart, { limits: { fileSize: 1_048_576, files: 1, fields: 5 } });
  await app.register(controller);
  await app.ready();
  return app;
}
