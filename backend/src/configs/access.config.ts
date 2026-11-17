import config from 'config';

/**
 * Configuration of the caller's identity and permissions, which omnipass owns.
 *
 * There is nothing to choose here: `@pinkwhaleads/omnipass-client` is the only implementation, and
 * where to reach omnipass lives in {@link omnipassConfig}. What remains is how long a resolved
 * snapshot may be reused.
 *
 * @property cacheTtl - Milliseconds a resolved snapshot is reused before omnipass is asked again. It bounds how
 *   long a changed role takes to apply on a replica that did not make the change (T3)
 */
export type AccessConfig = {
  cacheTtl: number;
};

/**
 * Default lifetime of a resolved snapshot: one minute, the TTL the contract fixes (T3). It bounds how long a
 * revoked right keeps working on a replica that did not revoke it.
 */
const DEFAULT_CACHE_TTL_IN_MS = 60000;

/** The configuration key used to look up the access settings in the config store. */
const CONFIG_KEY = 'Access';

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
 * Resolved access configuration loaded from the application config store.
 *
 * @example
 * ```typescript
 * import { accessConfig } from '@configs';
 *
 * new OmnipassClient({ cacheTtl: accessConfig.cacheTtl, ... });
 * ```
 */
export const accessConfig: AccessConfig = {
  cacheTtl: optional('cacheTtl', DEFAULT_CACHE_TTL_IN_MS),
};
