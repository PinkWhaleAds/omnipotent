import Fastify, { FastifyInstance, FastifyPluginAsync } from 'fastify';

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
