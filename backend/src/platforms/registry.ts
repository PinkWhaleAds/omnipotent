/**
 * @module platforms/registry
 *
 * Which platforms have an adapter in this process, decided **at startup** from the configuration
 * (`docs/phase-10.md` § 5): an adapter whose credentials are ours is built with what reads them, so a
 * platform whose settings are missing simply gets none, and the application starts without it.
 */
import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { googleAdsConfig, GoogleAdsConfig } from '@configs';
import type { CallJournal } from '@src/services/platform-call.service';
import type { SecretStore } from '@src/services/secret-store.service';
import { Logger, LoggerBuilder } from '@utils';
import { createGoogleAdsAdapter, GoogleAdsSetup } from './google/google.adapter';
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
 * Register the adapter of every platform whose settings are there.
 *
 * Google Ads joins when our manager account is configured; its two credentials are read from the
 * secret store **at each token exchange**, never at startup, so a missing one fails its first call
 * with our own credentials named rather than the boot. The inviter's is read **fresh**: a consent
 * given by `pnpm google:connect` is picked up at once, not after the store's cache expires.
 *
 * @param secrets - Where our credentials live
 * @param journal - Where every call is recorded
 * @param google - The Google Ads settings
 * @returns The platforms that got an adapter
 */
export function registerPlatformAdapters(
  secrets: SecretStore,
  journal: CallJournal,
  google: GoogleAdsConfig = googleAdsConfig
): string[] {
  const registered: string[] = [];
  if (google.managerId) {
    registerAdapter(createGoogleAdsAdapter(googleAdsSetup(secrets, google), journal));
    registered.push('google_ads');
  }
  logger.info('Platform adapters registered', { platforms: registered });
  return registered;
}

/**
 * Fastify plugin that registers the platform adapters.
 *
 * Depends on `SecretStorePlugin` and `PlatformCallJournalPlugin`.
 *
 * @param fastify - The Fastify instance
 * @returns A promise that resolves once registered
 */
async function platformAdaptersPlugin(fastify: FastifyInstance): Promise<void> {
  registerPlatformAdapters(fastify.secretStore, fastify.platformCallJournal);
}

export default fastifyPlugin(platformAdaptersPlugin, {
  name: 'PlatformAdaptersPlugin',
  dependencies: ['SecretStorePlugin', 'PlatformCallJournalPlugin'],
});
