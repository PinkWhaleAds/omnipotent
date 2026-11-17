import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import Fastify, { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

/**
 * The fake `SecretStorePlugin` the access plugin declares as a dependency, since the omnipass client
 * reads its secret from the store.
 *
 * @param secrets - The double the instance is decorated with
 * @returns The plugin, under the name Fastify resolves the dependency by
 */
function fakeSecretStorePlugin(secrets: { get: jest.Mock }): FastifyPluginAsync {
  return fastifyPlugin(
    async (instance: FastifyInstance): Promise<void> => {
      instance.decorate('secretStore', secrets as never);
    },
    { name: 'SecretStorePlugin' }
  );
}

describe('Unit::Services::AccessServicePlugin', () => {
  let app: FastifyInstance;
  let secrets: { get: jest.Mock };

  beforeEach((): void => {
    jest.clearAllMocks();
    secrets = { get: jest.fn().mockResolvedValue('the-machine-account-secret') };
  });

  afterEach(async (): Promise<void> => {
    await app?.close();
    jest.resetModules();
    jest.dontMock('@configs');
  });

  it('should decorate the instance with the omnipass client, reading its secret from the store', async (): Promise<void> => {
    await jest.isolateModulesAsync(async (): Promise<void> => {
      const actual: typeof import('@configs') = jest.requireActual('@configs');
      jest.doMock('@configs', () => ({
        ...actual,
        authConfig: { ...actual.authConfig, domain: 'tenant.eu.auth0.com' },
        omnipassConfig: { ...actual.omnipassConfig, clientId: 'the-machine-account' },
      }));
      const plugin: FastifyPluginAsync = (await import('@src/services/access.service')).default;

      app = Fastify();
      await app.register(fakeSecretStorePlugin(secrets));
      await app.register(plugin);
      await app.ready();

      // The class has to come from **this** registry: an isolated import loads its own copy of the
      // package, and `toBeInstanceOf` against one imported at the top of the file would compare two
      // distinct constructors of the same name — a confusing failure for a correct wiring.
      const { OmnipassClient: Isolated } = await import('@pinkwhaleads/omnipass-client');
      expect(app.accessService).toBeInstanceOf(Isolated);
    });

    expect(secrets.get).toHaveBeenCalledWith('omnipass/client-secret');
    // Nothing is warned at startup: there is one implementation, and it is the real tenancy.
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it('should refuse to start without a machine account', async (): Promise<void> => {
    await jest.isolateModulesAsync(async (): Promise<void> => {
      const actual: typeof import('@configs') = jest.requireActual('@configs');
      jest.doMock('@configs', () => ({
        ...actual,
        authConfig: { ...actual.authConfig, domain: 'tenant.eu.auth0.com' },
      }));
      const plugin: FastifyPluginAsync = (await import('@src/services/access.service')).default;

      // The whole boot is the subject, not `ready()` alone: awaiting a `register` already starts
      // loading the plugins, so the refusal may come from either call. What matters is that the
      // application does not come up — a deployment that forgot the account is told in seconds,
      // not by its first user.
      await expect(
        (async (): Promise<void> => {
          const instance: FastifyInstance = Fastify();
          await instance.register(fakeSecretStorePlugin(secrets));
          await instance.register(plugin);
          await instance.ready();
        })()
      ).rejects.toThrow(/omnipass client is not configured: clientId is missing/);
    });
  });
});
