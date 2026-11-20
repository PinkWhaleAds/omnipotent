import Fastify, { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { googleAdsConfig } from '@configs';
import { GoogleAdsAdapter } from '@src/platforms/google/google.adapter';
import { ADAPTERS, PlatformAdapter } from '@src/platforms/platform-adapter';
import PlatformAdaptersPlugin, { googleAdsSetup, registerPlatformAdapters } from '@src/platforms/registry';
import { Platform } from '@src/types';

describe('Unit::Platforms::Registry', () => {
  /** The registry, writable, so that each spec starts from none. */
  const registry: Partial<Record<Platform, PlatformAdapter>> = ADAPTERS as Partial<Record<Platform, PlatformAdapter>>;
  let secrets: { get: jest.Mock };
  let journal: { record: jest.Mock };

  beforeEach((): void => {
    for (const platform of Object.keys(registry)) Reflect.deleteProperty(registry, platform);
    secrets = { get: jest.fn().mockResolvedValue('{}') };
    journal = { record: jest.fn() };
  });

  afterEach((): void => {
    for (const platform of Object.keys(registry)) Reflect.deleteProperty(registry, platform);
  });

  it('should give Google Ads its adapter when our manager account is configured', (): void => {
    const registered: string[] = registerPlatformAdapters(secrets as never, journal, {
      managerId: '771-934-5054',
      serviceAccountSecret: 'google-ads/service-account',
      inviterSecret: 'google-ads/inviter',
    });

    expect(registered).toEqual(['google_ads']);
    expect(registry.google_ads).toBeInstanceOf(GoogleAdsAdapter);
    // The key is read at the first token exchange, never at startup.
    expect(secrets.get).not.toHaveBeenCalled();
  });

  it('should read the key from the secret store when a token is needed', async (): Promise<void> => {
    registerPlatformAdapters(secrets as never, journal, {
      managerId: '7719345054',
      serviceAccountSecret: 'google-ads/service-account',
      inviterSecret: 'google-ads/inviter',
    });

    // The key read is not one, so the exchange stops there, on our own credentials.
    await expect(registry.google_ads?.readLinkedAccount?.('9725630707')).rejects.toMatchObject({
      options: { ownCredentials: true, code: 'service_account_key' },
    });
    expect(secrets.get).toHaveBeenCalledWith('google-ads/service-account');
  });

  it("should read the inviter's consent fresh, so that a new one is picked up at once", async (): Promise<void> => {
    const setup = googleAdsSetup(secrets as never, {
      managerId: '7719345054',
      serviceAccountSecret: 'google-ads/service-account',
      inviterSecret: 'google-ads/inviter',
    });

    await setup.loadInviterSecret();
    await setup.loadServiceAccountKey();

    expect(secrets.get).toHaveBeenNthCalledWith(1, 'google-ads/inviter', { fresh: true });
    expect(secrets.get).toHaveBeenNthCalledWith(2, 'google-ads/service-account');
  });

  it('should leave Google Ads without an adapter when no manager account is configured', (): void => {
    expect(
      registerPlatformAdapters(secrets as never, journal, {
        managerId: '',
        serviceAccountSecret: 'google-ads/service-account',
        inviterSecret: 'google-ads/inviter',
      })
    ).toEqual([]);
    expect(registry.google_ads).toBeUndefined();
  });

  it('should register them from the secret store and the journal of the instance', async (): Promise<void> => {
    const app: FastifyInstance = Fastify();
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
    await app.close();
  });
});
