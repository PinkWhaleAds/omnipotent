import config from 'config';

/**
 * Configuration of Google Ads.
 *
 * @property managerId - Our manager account (the MCC), with or without its dashes. **Empty, Google
 *   has no adapter**: the application starts without it, and a Google account can only be declared,
 *   never pushed to (`docs/phase-10.md` § 5). Not a secret: every call names it in a header
 * @property serviceAccountSecret - Where the JSON key of our service account lives in the secret
 *   store, relative to its prefix
 */
export type GoogleAdsConfig = {
  managerId: string;
  serviceAccountSecret: string;
};

/** The configuration key used to look up the Google Ads settings in the config store. */
const CONFIG_KEY = 'GoogleAds';

/**
 * Read an optional key, falling back to a default when it is absent.
 *
 * @param key - Key under {@link CONFIG_KEY}
 * @param fallback - Value returned when the key is not configured
 * @returns The configured value or the fallback
 */
function optional<T>(key: string, fallback: T): T {
  return config.has(`${CONFIG_KEY}.${key}`) ? config.get(`${CONFIG_KEY}.${key}`) : fallback;
}

/**
 * Resolved Google Ads configuration loaded from the application config store.
 *
 * @example
 * ```typescript
 * import { googleAdsConfig } from '@configs';
 *
 * if (googleAdsConfig.managerId) registerAdapter(createGoogleAdsAdapter(setup, journal));
 * ```
 */
export const googleAdsConfig: GoogleAdsConfig = {
  managerId: optional('managerId', ''),
  serviceAccountSecret: optional('serviceAccountSecret', 'google-ads/service-account'),
};
