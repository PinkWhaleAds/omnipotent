import config from 'config';

/**
 * Configuration of the tracking script of the Advertisers (`docs/phase-10.md` § 8.10), transcribed
 * from multi-search.
 *
 * @property scriptBaseUrl - Where the sites load the tracking scripts from, without trailing slash: the
 *   API itself, which serves them at `/t/<key>.js`. In production, the public URL of the API
 */
export type TrackingConfig = {
  scriptBaseUrl: string;
};

/** The configuration key used to look up the tracking settings in the config store. */
const CONFIG_KEY = 'Tracking';

/** Where a local API serves the scripts. */
const DEFAULT_SCRIPT_BASE_URL = 'http://localhost:3002';

/**
 * Resolved tracking configuration loaded from the application config store.
 *
 * @example
 * ```typescript
 * import { trackingConfig } from '@configs';
 *
 * const scriptUrl = `${trackingConfig.scriptBaseUrl}/t/${key}.js`;
 * ```
 */
export const trackingConfig: TrackingConfig = {
  scriptBaseUrl: (config.has(`${CONFIG_KEY}.scriptBaseUrl`)
    ? config.get<string>(`${CONFIG_KEY}.scriptBaseUrl`)
    : DEFAULT_SCRIPT_BASE_URL
  ).replace(/\/+$/, ''),
};
