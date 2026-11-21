import config from 'config';

/** Map styles Amazon Location draws static maps in. */
export type GeoMapStyle = 'Standard' | 'Satellite';

/**
 * Configuration of the places finer than countries (`docs/phase-10.md` § 8.9), transcribed from
 * multi-search.
 *
 * @property enabled - Whether Amazon Location Service answers the geocoding and the static maps. Off by
 *   default — local development reaches no AWS service unless asked to —: the routes then answer 503
 *   `geo_service_unavailable`, and a circle is placed by its coordinates
 * @property region - AWS region of Amazon Location Service (Places and Maps v2, called with the
 *   task's IAM role)
 * @property googleTargetsUrl - Where Google's catalog of places is read: the page of Google's
 *   documentation that links every version of the file (the latest one is taken), or the URL of one
 *   file (`.csv` or `.csv.zip`). Configured, never sent by a client
 * @property hourlyLimitPerOrganization - Addresses, positions and maps an Organization may ask Amazon
 *   Location for in one clock hour, counted by each API process separately: an in-memory guard of
 *   the bill, not a quota
 * @property mapStyle - Style of the static maps
 */
export type GeoConfig = {
  enabled: boolean;
  region: string;
  googleTargetsUrl: string;
  hourlyLimitPerOrganization: number;
  mapStyle: GeoMapStyle;
};

/** The configuration key used to look up the geo settings in the config store. */
const CONFIG_KEY = 'Geo';

/** Google's page listing the versions of its catalog of places. */
export const GOOGLE_GEO_TARGETS_PAGE_URL = 'https://developers.google.com/google-ads/api/data/geotargets';

/**
 * Read an optional key, falling back to a default when it is absent.
 *
 * @param key - Key under {@link CONFIG_KEY}
 * @param fallback - Value returned when the key is not configured
 * @returns The configured value or the fallback
 */
function optional<T>(key: string, fallback: T): T {
  return config.has(`${CONFIG_KEY}.${key}`) ? config.get<T>(`${CONFIG_KEY}.${key}`) : fallback;
}

/**
 * Resolved geo configuration loaded from the application config store.
 *
 * @example
 * ```typescript
 * import { geoConfig } from '@configs';
 *
 * if (!geoConfig.enabled) throw httpError(503, 'Geocoding is not available', { code: 'geo_service_unavailable' });
 * ```
 */
export const geoConfig: GeoConfig = {
  enabled: optional('enabled', false),
  region: optional('region', 'eu-north-1'),
  googleTargetsUrl: optional('googleTargetsUrl', GOOGLE_GEO_TARGETS_PAGE_URL),
  hourlyLimitPerOrganization: optional('hourlyLimitPerOrganization', 1000),
  mapStyle: optional<string>('mapStyle', 'Standard') === 'Satellite' ? 'Satellite' : 'Standard',
};
