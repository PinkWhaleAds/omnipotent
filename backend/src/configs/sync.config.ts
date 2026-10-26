import config from 'config';

/**
 * Configuration of the synchronization engine.
 *
 * @property maxBackoffMinutes - Longest delay between two attempts on a unit whose failure was
 *   temporary. The delay doubles with each failure up to this ceiling, so a platform having a bad
 *   hour is retried rarely rather than hammered (`docs/phase-9.md` § 5)
 * @property sweepBatchSize - How many units one pass of the sweep looks at. It bounds the work of a
 *   minute, which is the point of D34: the periodic cost follows the backlog, and a backlog larger
 *   than this is simply spread over several passes
 * @property pacingJitterMinutes - How far the daily pacing of a campaign is spread past its own local
 *   midnight (D47). Without it, every campaign of a timezone would recompute in the same second
 */
export type SyncConfig = {
  maxBackoffMinutes: number;
  sweepBatchSize: number;
  pacingJitterMinutes: number;
};

/** The configuration key used to look up synchronization settings in the config store. */
const CONFIG_KEY = 'Sync';

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
 * Resolved synchronization configuration loaded from the application config store.
 *
 * @example
 * ```typescript
 * import { syncConfig } from '@configs';
 *
 * const minutes = Math.min(syncConfig.maxBackoffMinutes, 2 ** (attempts - 1));
 * ```
 */
export const syncConfig: SyncConfig = {
  maxBackoffMinutes: optional('maxBackoffMinutes', 60),
  sweepBatchSize: optional('sweepBatchSize', 500),
  pacingJitterMinutes: optional('pacingJitterMinutes', 30),
};
