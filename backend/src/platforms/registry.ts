/**
 * @module platforms/registry
 *
 * Which platforms have an adapter in this process, decided **at startup** from the configuration
 * (`docs/phase-10.md` § 5): an adapter whose credentials are ours is built with what reads them, so a
 * platform whose settings are missing simply gets none, and the application starts without it.
 */
import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { DataSource, EntityManager } from 'typeorm';

import { googleAdsConfig, GoogleAdsConfig, microsoftAdsConfig, MicrosoftAdsConfig } from '@configs';
import type { CallJournal } from '@src/services/platform-call.service';
import type { SecretStore } from '@src/services/secret-store.service';
import { Logger, LoggerBuilder } from '@utils';
import { createGoogleAdsAdapter, GoogleAdsSetup } from './google/google.adapter';
import type { WithLock } from './microsoft/microsoft.auth';
import { createMicrosoftAdsAdapter, MicrosoftAdsSetup } from './microsoft/microsoft.adapter';
import { registerAdapter } from './platform-adapter';

/** Says at startup which platforms this process talks to. */
const logger: Logger = LoggerBuilder.getChildLogger('PlatformAdapters');

/**
 * What the Google Ads adapter is built with: our MCC, and the reading of our two credentials.
 *
 * @param secrets - Where our credentials live
 * @param google - The Google Ads settings
 * @returns The setup
 */
export function googleAdsSetup(secrets: SecretStore, google: GoogleAdsConfig): GoogleAdsSetup {
  return {
    managerId: google.managerId,
    loadServiceAccountKey: (): Promise<string> => secrets.get(google.serviceAccountSecret),
    loadInviterSecret: (): Promise<string> => secrets.get(google.inviterSecret, { fresh: true }),
  };
}

/**
 * A lock every process shares: a PostgreSQL advisory lock, held for one transaction — released when
 * the work ends, even when the process dies.
 *
 * @param dataSource - The application database
 * @returns The lock
 */
export function advisoryLock(dataSource: DataSource): WithLock {
  return async <T>(key: string, work: () => Promise<T>): Promise<T> =>
    dataSource.transaction(async (manager: EntityManager): Promise<T> => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
      return work();
    });
}

/**
 * What the Microsoft adapter is built with: our manager account, the reading of our application, the
 * reading **fresh** and the writing of our service user's tokens — renewed by any process — and the
 * lock they renew under (`docs/phase-11.md` § 2).
 *
 * @param secrets - Where our credentials live
 * @param microsoft - The Microsoft Advertising settings
 * @param withLock - The lock every process shares
 * @returns The setup
 */
export function microsoftAdsSetup(
  secrets: SecretStore,
  microsoft: MicrosoftAdsConfig,
  withLock: WithLock
): MicrosoftAdsSetup {
  return {
    customerId: microsoft.customerId,
    credentials: {
      readApp: (): Promise<string> => secrets.get(microsoft.appSecret),
      readOAuth: (): Promise<string> => secrets.get(microsoft.oauthSecret, { fresh: true }),
      writeOAuth: (value: string): Promise<void> => secrets.put(microsoft.oauthSecret, value),
    },
    withLock,
  };
}

/**
 * Register the adapter of every platform whose settings are there.
 *
 * Google Ads joins when our manager account is configured; its two credentials are read from the
 * secret store **at each token exchange**, never at startup, so a missing one fails its first call
 * with our own credentials named rather than the boot. The inviter's is read **fresh**: a consent
 * given by `pnpm google:connect` is picked up at once, not after the store's cache expires.
 *
 * Microsoft Advertising joins when our manager account's customer id is configured, the same way.
 *
 * @param secrets - Where our credentials live
 * @param journal - Where every call is recorded
 * @param withLock - The lock every process shares, for the Microsoft tokens
 * @param google - The Google Ads settings
 * @param microsoft - The Microsoft Advertising settings
 * @returns The platforms that got an adapter
 */
export function registerPlatformAdapters(
  secrets: SecretStore,
  journal: CallJournal,
  withLock: WithLock,
  google: GoogleAdsConfig = googleAdsConfig,
  microsoft: MicrosoftAdsConfig = microsoftAdsConfig
): string[] {
  const registered: string[] = [];
  if (google.managerId) {
    registerAdapter(createGoogleAdsAdapter(googleAdsSetup(secrets, google), journal));
    registered.push('google_ads');
  }
  if (microsoft.customerId) {
    registerAdapter(createMicrosoftAdsAdapter(microsoftAdsSetup(secrets, microsoft, withLock), journal));
    registered.push('microsoft');
  }
  logger.info('Platform adapters registered', { platforms: registered });
  return registered;
}

/**
 * Fastify plugin that registers the platform adapters.
 *
 * Depends on `DatabasePlugin`, for the lock, `SecretStorePlugin` and `PlatformCallJournalPlugin`.
 *
 * @param fastify - The Fastify instance
 * @returns A promise that resolves once registered
 */
async function platformAdaptersPlugin(fastify: FastifyInstance): Promise<void> {
  registerPlatformAdapters(fastify.secretStore, fastify.platformCallJournal, advisoryLock(fastify.db));
}

export default fastifyPlugin(platformAdaptersPlugin, {
  name: 'PlatformAdaptersPlugin',
  dependencies: ['DatabasePlugin', 'SecretStorePlugin', 'PlatformCallJournalPlugin'],
});
