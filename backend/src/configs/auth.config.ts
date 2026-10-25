import config from 'config';

/**
 * Configuration interface for authentication.
 *
 * Auth0 only proves *who* the caller is: tokens are verified locally against the tenant's public
 * keys (JWKS), and nothing of the caller's rights travels in them (T3). The user, their Seats, their
 * Organizations and their roles come from omnipass, which the `AccessService` asks once per request
 * — hence no email claim, no super-admin list and no verified-provider list here: those are
 * omnipass's business (`~/OmniAd/omnipass/docs/message-socle-omnipotent.md` § 1).
 *
 * @property domain - Auth0 tenant domain, e.g. `my-tenant.eu.auth0.com` — the issuer is `https://<domain>/`
 * @property audience - Identifier of the Auth0 API representing the REST API; REST tokens must carry it
 * @property jwksCacheTtl - Milliseconds the tenant's public keys are reused before being fetched again
 * @property swaggerClientId - Auth0 client id the Swagger UI uses for its "Authorize" button (empty to disable)
 */
export type AuthConfig = {
  domain: string;
  audience: string;
  jwksCacheTtl: number;
  swaggerClientId: string;
};

/** Default lifetime of the cached tenant public keys: 10 minutes. */
const DEFAULT_JWKS_CACHE_TTL_IN_MS = 600000;

/** The configuration key used to look up authentication settings in the config store. */
const CONFIG_KEY = 'Auth';

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
 * Resolved authentication configuration loaded from the application config store.
 *
 * `domain` and `audience` default to empty strings so the worker process, which
 * serves no authenticated route, can boot without them; the auth plugin refuses
 * to start the API when either is missing.
 *
 * @example
 * ```typescript
 * import { authConfig } from '@configs';
 *
 * const issuer: string = `https://${authConfig.domain}/`;
 * ```
 */
export const authConfig: AuthConfig = {
  domain: optional('domain', ''),
  audience: optional('audience', ''),
  jwksCacheTtl: optional('jwksCacheTtl', DEFAULT_JWKS_CACHE_TTL_IN_MS),
  swaggerClientId: optional('swaggerClientId', ''),
};
