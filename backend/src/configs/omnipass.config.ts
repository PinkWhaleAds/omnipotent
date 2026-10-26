import config from 'config';

/**
 * How to reach omnipass, the identity and tenancy service (T1).
 *
 * The **value** of the client secret is not here: it lives in the secret store, under
 * {@link OmnipassConfig.secretName}, and the plugin reads it when it builds the client. A secret never
 * travels through a configuration file, an environment variable of the task definition, or a
 * conversation (`../../CADRAGE.md` § 12).
 *
 * @property url - Base URL of omnipass, without a trailing slash (`OMNIPASS_URL`)
 * @property audience - Identifier of omnipass's REST API, which our machine token is issued for
 *   (`OMNIPASS_AUDIENCE`)
 * @property clientId - Client id of **our** machine account, a `client_credentials` application of the
 *   shared Auth0 tenant (`OMNIPASS_CLIENT_ID`); not a secret, which is why it sits here
 * @property secretName - Name of the entry holding that account's secret, under the configured prefix
 *   (`OMNIPASS_SECRET_NAME`)
 */
export type OmnipassConfig = {
  url: string;
  audience: string;
  clientId: string;
  secretName: string;
};

/** The configuration key used to look up the omnipass settings in the config store. */
const CONFIG_KEY = 'Omnipass';

/** Where omnipass answers when nothing is configured: the local service of a developer. */
const DEFAULT_URL = 'http://localhost:3000';

/** Identifier of omnipass's REST API, fixed by omnipass and the same in every environment. */
const DEFAULT_AUDIENCE = 'https://api.omnipass.app';

/** Entry of the secret store holding our machine account's secret. */
const DEFAULT_SECRET_NAME = 'omnipass/client-secret';

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
 * Resolved omnipass configuration loaded from the application config store.
 *
 * `clientId` has **no default**: an empty one is how `assertOmnipassConfigured` tells a deployment that
 * chose the `omnipass` provider without giving it an account.
 *
 * @example
 * ```typescript
 * import { omnipassConfig } from '@configs';
 *
 * new OmnipassClient({ url: omnipassConfig.url, clientId: omnipassConfig.clientId, … });
 * ```
 */
export const omnipassConfig: OmnipassConfig = {
  url: optional('url', DEFAULT_URL),
  audience: optional('audience', DEFAULT_AUDIENCE),
  clientId: optional('clientId', ''),
  secretName: optional('secretName', DEFAULT_SECRET_NAME),
};
