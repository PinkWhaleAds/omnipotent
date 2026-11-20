import config from 'config';

/**
 * Configuration of Microsoft Advertising.
 *
 * @property customerId - Our manager account's customer id (`cid`). **Empty, Microsoft has no
 *   adapter**: the application starts without it, and a Microsoft account can only be declared, never
 *   pushed to (`docs/phase-11.md` § 3). Not a secret: every call names it in a header
 * @property appSecret - Where our Entra application and developer token live in the secret store,
 *   relative to its prefix
 * @property oauthSecret - Where the tokens of our service user live: written by
 *   `pnpm microsoft:connect`, then by the API at every renewal
 * @property redirectUri - Where the consent comes back: the address declared in the Entra application
 *   (`docs/runbook-acces.md` C2)
 */
export type MicrosoftAdsConfig = {
  customerId: string;
  appSecret: string;
  oauthSecret: string;
  redirectUri: string;
};

/** The configuration key used to look up the Microsoft Advertising settings in the config store. */
const CONFIG_KEY = 'MicrosoftAds';

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
 * Resolved Microsoft Advertising configuration loaded from the application config store.
 *
 * @example
 * ```typescript
 * import { microsoftAdsConfig } from '@configs';
 *
 * if (microsoftAdsConfig.customerId) registerAdapter(createMicrosoftAdsAdapter(setup, journal));
 * ```
 */
export const microsoftAdsConfig: MicrosoftAdsConfig = {
  customerId: optional('customerId', ''),
  appSecret: optional('appSecret', 'microsoft-ads/app'),
  oauthSecret: optional('oauthSecret', 'microsoft-ads/oauth'),
  redirectUri: optional('redirectUri', 'http://localhost:4102/microsoft/callback'),
};
