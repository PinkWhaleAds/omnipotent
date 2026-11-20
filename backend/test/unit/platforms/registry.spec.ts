import Fastify, { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { GoogleAdsConfig, googleAdsConfig, MicrosoftAdsConfig, microsoftAdsConfig } from '@configs';
import { GoogleAdsAdapter } from '@src/platforms/google/google.adapter';
import { MicrosoftAdsAdapter } from '@src/platforms/microsoft/microsoft.adapter';
import { ADAPTERS, PlatformAdapter } from '@src/platforms/platform-adapter';
import PlatformAdaptersPlugin, {
  advisoryLock,
  googleAdsSetup,
  microsoftAdsSetup,
  registerPlatformAdapters,
} from '@src/platforms/registry';
import { Platform } from '@src/types';

/** Our Google Ads settings, configured. */
const GOOGLE: GoogleAdsConfig = {
  managerId: '771-934-5054',
  serviceAccountSecret: 'google-ads/service-account',
  inviterSecret: 'google-ads/inviter',
};

/** Our Microsoft Advertising settings, configured. */
const MICROSOFT: MicrosoftAdsConfig = {
  customerId: '255113635',
  appSecret: 'microsoft-ads/app',
  oauthSecret: 'microsoft-ads/oauth',
  redirectUri: 'http://localhost:4102/microsoft/callback',
};

describe('Unit::Platforms::Registry', () => {
  /** The registry, writable, so that each spec starts from none. */
  const registry: Partial<Record<Platform, PlatformAdapter>> = ADAPTERS as Partial<Record<Platform, PlatformAdapter>>;
  let secrets: { get: jest.Mock; put: jest.Mock };
  let journal: { record: jest.Mock };
  let withLock: jest.Mock;

  beforeEach((): void => {
    for (const platform of Object.keys(registry)) Reflect.deleteProperty(registry, platform);
    secrets = { get: jest.fn().mockResolvedValue('{}'), put: jest.fn().mockResolvedValue(undefined) };
    journal = { record: jest.fn() };
    withLock = jest.fn(async <T>(_key: string, work: () => Promise<T>): Promise<T> => work());
  });

  afterEach((): void => {
    for (const platform of Object.keys(registry)) Reflect.deleteProperty(registry, platform);
  });

  it('should give Google Ads its adapter when our manager account is configured', (): void => {
    const registered: string[] = registerPlatformAdapters(secrets as never, journal, withLock, GOOGLE, {
      ...MICROSOFT,
      customerId: '',
    });

    expect(registered).toEqual(['google_ads']);
    expect(registry.google_ads).toBeInstanceOf(GoogleAdsAdapter);
    expect(registry.microsoft).toBeUndefined();
    // The key is read at the first token exchange, never at startup.
    expect(secrets.get).not.toHaveBeenCalled();
  });

  it('should read the key from the secret store when a token is needed', async (): Promise<void> => {
    registerPlatformAdapters(
      secrets as never,
      journal,
      withLock,
      { ...GOOGLE, managerId: '7719345054' },
      {
        ...MICROSOFT,
        customerId: '',
      }
    );

    // The key read is not one, so the exchange stops there, on our own credentials.
    await expect(registry.google_ads?.readLinkedAccount?.('9725630707')).rejects.toMatchObject({
      options: { ownCredentials: true, code: 'service_account_key' },
    });
    expect(secrets.get).toHaveBeenCalledWith('google-ads/service-account');
  });

  it("should read the inviter's consent fresh, so that a new one is picked up at once", async (): Promise<void> => {
    const setup = googleAdsSetup(secrets as never, GOOGLE);

    await setup.loadInviterSecret();
    await setup.loadServiceAccountKey();

    expect(secrets.get).toHaveBeenNthCalledWith(1, 'google-ads/inviter', { fresh: true });
    expect(secrets.get).toHaveBeenNthCalledWith(2, 'google-ads/service-account');
  });

  it('should give Microsoft Advertising its adapter when our manager account is configured', (): void => {
    const registered: string[] = registerPlatformAdapters(
      secrets as never,
      journal,
      withLock,
      { ...GOOGLE, managerId: '' },
      MICROSOFT
    );

    expect(registered).toEqual(['microsoft']);
    expect(registry.microsoft).toBeInstanceOf(MicrosoftAdsAdapter);
    expect(registry.google_ads).toBeUndefined();
    // The tokens are read at the first call, never at startup.
    expect(secrets.get).not.toHaveBeenCalled();
  });

  it('should register both when both are configured', (): void => {
    expect(registerPlatformAdapters(secrets as never, journal, withLock, GOOGLE, MICROSOFT)).toEqual([
      'google_ads',
      'microsoft',
    ]);
  });

  it("should read the service user's tokens fresh, write the renewed ones back, and share the lock", async (): Promise<void> => {
    const setup = microsoftAdsSetup(secrets as never, MICROSOFT, withLock);

    await setup.credentials.readApp();
    await setup.credentials.readOAuth();
    await setup.credentials.writeOAuth('{"refreshToken":"r-2"}');

    expect(setup.customerId).toBe('255113635');
    expect(setup.withLock).toBe(withLock);
    expect(secrets.get).toHaveBeenNthCalledWith(1, 'microsoft-ads/app');
    expect(secrets.get).toHaveBeenNthCalledWith(2, 'microsoft-ads/oauth', { fresh: true });
    expect(secrets.put).toHaveBeenCalledWith('microsoft-ads/oauth', '{"refreshToken":"r-2"}');
  });

  it('should leave every platform without an adapter when none is configured', (): void => {
    expect(
      registerPlatformAdapters(
        secrets as never,
        journal,
        withLock,
        { ...GOOGLE, managerId: '' },
        {
          ...MICROSOFT,
          customerId: '',
        }
      )
    ).toEqual([]);
    expect(registry).toEqual({});
  });

  describe('advisoryLock', () => {
    it('should run the work in a transaction holding a PostgreSQL advisory lock', async (): Promise<void> => {
      const manager = { query: jest.fn().mockResolvedValue([]) };
      const dataSource = {
        transaction: jest.fn(async (work: (m: typeof manager) => Promise<unknown>) => work(manager)),
      };
      const work: jest.Mock = jest.fn(async (): Promise<string> => {
        // The lock is held before the work starts.
        expect(manager.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', [
          'microsoft-ads-oauth',
        ]);
        return 'done';
      });

      await expect(advisoryLock(dataSource as never)('microsoft-ads-oauth', work)).resolves.toBe('done');
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(work).toHaveBeenCalledTimes(1);
    });
  });

  it('should register them from the database, the secret store and the journal of the instance', async (): Promise<void> => {
    const app: FastifyInstance = Fastify();
    await app.register(
      fastifyPlugin(
        async (instance: FastifyInstance): Promise<void> => {
          instance.decorate('db', { transaction: jest.fn() } as never);
        },
        { name: 'DatabasePlugin' }
      )
    );
    await app.register(
      fastifyPlugin(
        async (instance: FastifyInstance): Promise<void> => {
          instance.decorate('secretStore', secrets as never);
        },
        { name: 'SecretStorePlugin' }
      )
    );
    await app.register(
      fastifyPlugin(
        async (instance: FastifyInstance): Promise<void> => {
          instance.decorate('platformCallJournal', journal);
        },
        { name: 'PlatformCallJournalPlugin' }
      )
    );

    await app.register(PlatformAdaptersPlugin);
    await app.ready();

    // Whatever the configuration of the run says, the plugin follows it.
    expect(registry.google_ads !== undefined).toBe(googleAdsConfig.managerId !== '');
    expect(registry.microsoft !== undefined).toBe(microsoftAdsConfig.customerId !== '');
    await app.close();
  });
});
