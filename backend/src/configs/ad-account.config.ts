import config from 'config';

/**
 * Configuration of the platform accounts.
 *
 * @property linkRequestLifetimeDays - How long an invitation to our manager account waits for the
 *   client's answer before we withdraw it. Google never ends one on its own, so without this an
 *   account would stay `pending` forever (`docs/phase-10.md` § 2). Thirty days, as multi-search
 */
export type AdAccountConfig = {
  linkRequestLifetimeDays: number;
};

/** The configuration key used to look up the account settings in the config store. */
const CONFIG_KEY = 'AdAccounts';

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
 * Resolved account configuration loaded from the application config store.
 *
 * @example
 * ```typescript
 * import { adAccountConfig } from '@configs';
 *
 * const expiresAt = requestedAt.getTime() + adAccountConfig.linkRequestLifetimeDays * DAY_IN_MS;
 * ```
 */
export const adAccountConfig: AdAccountConfig = {
  linkRequestLifetimeDays: optional('linkRequestLifetimeDays', 30),
};
