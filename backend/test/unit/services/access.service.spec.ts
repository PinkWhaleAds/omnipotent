import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { OmnipassClient } from '@multisearchad/omnipass-client';
import Fastify, { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { AccessConfig } from '@configs';
import AccessServicePlugin, {
  AccessService,
  LocalAccessService,
  OrganizationAccess,
} from '@src/services/access.service';
import { Snapshot, snapshotSchema } from '@src/types';
import { IDS, JANE, SUPER_ADMIN } from '@test/unit/mocks/auth.fixtures';
import { errorCodeOf, statusCodeOf } from '@utils';

describe('Unit::Services::LocalAccessService', () => {
  /** The configuration of the stub, with what a test needs changed. */
  function config(overrides: Partial<AccessConfig> = {}): AccessConfig {
    return {
      provider: 'local',
      cacheTtl: 60_000,
      devActorUserId: 'a0000000-0000-4000-8000-0000000000ff',
      devActorEmail: 'dev@omnipotent.local',
      devActorSuperAdmin: true,
      ...overrides,
    };
  }

  describe('the interface the contract freezes', () => {
    // ~/OmniAd/omnipass/docs/message-socle-omnipotent.md § 2: omnipass publishes
    // @multisearchad/omnipass-client with exactly these signatures, so a missing one is a divergence that
    // would only surface when the package replaces this stub.
    it('should carry every method of the contract', (): void => {
      const service: AccessService = new LocalAccessService(config());

      for (const method of [
        'assertSuperAdmin',
        'getSeatRole',
        'assertSeatRole',
        'getOrganizationAccess',
        'assertOrganizationRole',
        'invalidateUser',
        'invalidateAll',
        'resolve',
      ] as const) {
        expect(typeof service[method]).toBe('function');
      }
    });
  });

  describe('resolve', () => {
    it('should answer the fixed development actor, whatever the subject', async (): Promise<void> => {
      const service = new LocalAccessService(config());

      const first: Snapshot = await service.resolve('auth0|abc', 'token');
      const second: Snapshot = await service.resolve('google-oauth2|999', 'another-token');

      expect(first).toEqual({
        user: {
          id: 'a0000000-0000-4000-8000-0000000000ff',
          email: 'dev@omnipotent.local',
          name: null,
          isSuperAdmin: true,
          language: null,
        },
        seats: [],
        organizations: [],
        invitations: [],
      });
      expect(second).toEqual(first);
    });

    it('should answer a snapshot its schema accepts', async (): Promise<void> => {
      const snapshot: Snapshot = await new LocalAccessService(config()).resolve('auth0|abc', 'token');

      expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
    });

    it('should honour DEV_ACTOR_SUPER_ADMIN', async (): Promise<void> => {
      const snapshot: Snapshot = await new LocalAccessService(config({ devActorSuperAdmin: false })).resolve(
        'auth0|abc',
        'token'
      );

      expect(snapshot.user.isSuperAdmin).toBe(false);
    });

    it('should read the application configuration by default', async (): Promise<void> => {
      const snapshot: Snapshot = await new LocalAccessService().resolve('auth0|abc', 'token');

      // config/default.json
      expect(snapshot.user).toEqual({
        id: '00000000-0000-4000-8000-000000000002',
        email: 'dev@omnipotent.local',
        name: null,
        isSuperAdmin: true,
        language: null,
      });
    });
  });

  describe('assertSuperAdmin', () => {
    it('should let a super-admin through', (): void => {
      expect(() => new LocalAccessService(config()).assertSuperAdmin(SUPER_ADMIN)).not.toThrow();
    });

    it('should refuse anyone else with 403 super_admin_required', (): void => {
      let error: unknown;
      try {
        new LocalAccessService(config()).assertSuperAdmin(JANE);
      } catch (thrown: unknown) {
        error = thrown;
      }

      expect(statusCodeOf(error)).toBe(403);
      expect(errorCodeOf(error)).toEqual({ code: 'super_admin_required', params: {} });
    });
  });

  describe('getSeatRole / assertSeatRole', () => {
    it('should grant seat_admin on any Seat, listed in the snapshot or not', async (): Promise<void> => {
      const service = new LocalAccessService(config());

      await expect(service.getSeatRole(JANE, IDS.otherSeat)).resolves.toBe('seat_admin');
      await expect(service.assertSeatRole(JANE, IDS.otherSeat, 'seat_admin')).resolves.toBe('seat_admin');
      await expect(service.assertSeatRole(JANE, IDS.seat, 'member')).resolves.toBe('seat_admin');
    });
  });

  describe('getOrganizationAccess / assertOrganizationRole', () => {
    it('should grant admin on any Organization, listed in the snapshot or not', async (): Promise<void> => {
      const service = new LocalAccessService(config());

      const access: OrganizationAccess | null = await service.getOrganizationAccess(JANE, IDS.otherOrganization);

      expect(access).toEqual({
        organizationId: IDS.otherOrganization,
        seatId: '00000000-0000-4000-8000-000000000001',
        role: 'admin',
      });
      await expect(service.assertOrganizationRole(JANE, IDS.otherOrganization, 'admin')).resolves.toEqual(access);
    });

    it('should satisfy every minimum, since it grants admin', async (): Promise<void> => {
      // The stub never refuses on a role: 404 organization_not_found and 403 role_required are the
      // omnipass client's, which is why they are not exercised here.
      const service = new LocalAccessService(config());

      for (const minimum of ['viewer', 'manager', 'admin'] as const) {
        await expect(service.assertOrganizationRole(JANE, IDS.organization, minimum)).resolves.toMatchObject({
          role: 'admin',
        });
      }
      await expect(service.assertSeatRole(JANE, IDS.seat, 'seat_admin')).resolves.toBe('seat_admin');
    });
  });

  describe('invalidateUser / invalidateAll', () => {
    it('should do nothing: the stub caches nothing', (): void => {
      const service = new LocalAccessService(config());

      expect(() => service.invalidateUser(JANE.userId)).not.toThrow();
      expect(() => service.invalidateAll()).not.toThrow();
    });
  });
});

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

  it('should decorate the instance and warn that the tenancy is a stub', async (): Promise<void> => {
    app = Fastify();
    await app.register(fakeSecretStorePlugin(secrets));
    await app.register(AccessServicePlugin);
    await app.ready();

    expect(app.accessService).toBeInstanceOf(LocalAccessService);
    expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining('development stub'), {
      code: 'ACCESS::LOCAL_STUB',
    });
    // The stub needs no secret: the store is there for the other provider, and stays untouched.
    expect(secrets.get).not.toHaveBeenCalled();
  });

  it('should build the omnipass client when that provider is configured, reading its secret from the store', async (): Promise<void> => {
    await jest.isolateModulesAsync(async (): Promise<void> => {
      const actual: typeof import('@configs') = jest.requireActual('@configs');
      jest.doMock('@configs', () => ({
        ...actual,
        accessConfig: { ...actual.accessConfig, provider: 'omnipass' },
        authConfig: { ...actual.authConfig, domain: 'tenant.eu.auth0.com' },
        omnipassConfig: { ...actual.omnipassConfig, clientId: 'the-machine-account' },
      }));
      const plugin: FastifyPluginAsync = (await import('@src/services/access.service')).default;

      app = Fastify();
      await app.register(fakeSecretStorePlugin(secrets));
      await app.register(plugin);
      await app.ready();
    });

    expect(secrets.get).toHaveBeenCalledWith('omnipass/client-secret');
    expect(app.accessService).toBeInstanceOf(OmnipassClient);
    // Nothing is warned: the tenancy is the real one, and a loud line about a stub would be a lie.
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it('should refuse to start when the omnipass provider has no machine account', async (): Promise<void> => {
    await jest.isolateModulesAsync(async (): Promise<void> => {
      const actual: typeof import('@configs') = jest.requireActual('@configs');
      jest.doMock('@configs', () => ({
        ...actual,
        accessConfig: { ...actual.accessConfig, provider: 'omnipass' },
        authConfig: { ...actual.authConfig, domain: 'tenant.eu.auth0.com' },
      }));
      const plugin: FastifyPluginAsync = (await import('@src/services/access.service')).default;

      const instance: FastifyInstance = Fastify();
      await instance.register(fakeSecretStorePlugin(secrets));
      await instance.register(plugin);

      await expect(instance.ready()).rejects.toThrow(/omnipass client is not configured: clientId is missing/);
      await instance.close();
    });
  });
});
