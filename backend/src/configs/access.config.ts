import config from 'config';

/**
 * Where the identity and the permissions of a caller come from.
 *
 * - `local` — the development **stub** of `AccessService` (`src/services/access.service.ts`): a
 *   fixed actor read from the environment, admin of every Organization, no membership read.
 * - `omnipass` — `@pinkwhaleads/omnipass-client`, the single writer of the tenancy being omnipass itself
 *   (`~/OmniAd/omnipass`). The only provider production accepts (D43).
 */
export type AccessProvider = 'local' | 'omnipass';

/** Every accepted {@link AccessProvider}, used to validate the configured value. */
const ACCESS_PROVIDERS: readonly AccessProvider[] = ['local', 'omnipass'];

/** Provider used when none is configured. */
const DEFAULT_PROVIDER: AccessProvider = 'local';

/**
 * Configuration interface for the identity and permission provider.
 *
 * @property provider - Where identity and permissions come from, see {@link AccessProvider}
 * @property cacheTtl - Milliseconds a resolved snapshot is reused before omnipass is asked again. It bounds how
 *   long a changed role takes to apply on a replica that did not make the change (T3)
 * @property devActorUserId - The fixed actor the `local` stub resolves every caller to (`DEV_ACTOR_USER_ID`)
 * @property devActorEmail - Its email (`DEV_ACTOR_EMAIL`)
 * @property devActorSuperAdmin - Whether it operates the platform (`DEV_ACTOR_SUPER_ADMIN`)
 */
export type AccessConfig = {
  provider: AccessProvider;
  cacheTtl: number;
  devActorUserId: string;
  devActorEmail: string;
  devActorSuperAdmin: boolean;
};

/**
 * Default lifetime of a resolved snapshot: one minute, the TTL the contract fixes (T3). It bounds how long a
 * revoked right keeps working on a replica that did not revoke it.
 */
const DEFAULT_CACHE_TTL_IN_MS = 60000;

/** Id of the development actor when none is configured; a uuid, because omnipass's ids are uuids. */
const DEFAULT_DEV_ACTOR_USER_ID = '00000000-0000-4000-8000-000000000002';

/** Email of the development actor when none is configured. */
const DEFAULT_DEV_ACTOR_EMAIL = 'dev@omnipotent.local';

/** The configuration key used to look up the access settings in the config store. */
const CONFIG_KEY = 'Access';

/**
 * Read and validate the configured provider.
 *
 * An unknown value is a deployment mistake that would silently pick the local implementation, so it
 * fails loudly instead of falling back.
 *
 * @returns The configured provider, or {@link DEFAULT_PROVIDER} when none is set
 * @throws Error when the configured value is not a known provider
 *
 * @example
 * ```typescript
 * // ACCESS_PROVIDER=omnipass
 * readProvider(); // 'omnipass'
 * ```
 */
function readProvider(): AccessProvider {
  if (!config.has(`${CONFIG_KEY}.provider`)) return DEFAULT_PROVIDER;

  const provider: string = config.get(`${CONFIG_KEY}.provider`);
  if (!ACCESS_PROVIDERS.includes(provider as AccessProvider)) {
    throw new Error(`Unknown Access.provider '${provider}': expected one of ${ACCESS_PROVIDERS.join(', ')}`);
  }
  return provider as AccessProvider;
}

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
 * if (accessConfig.provider === 'local') logger.warn('Permissions are not really checked');
 * ```
 */
export const accessConfig: AccessConfig = {
  provider: readProvider(),
  cacheTtl: optional('cacheTtl', DEFAULT_CACHE_TTL_IN_MS),
  devActorUserId: optional('devActorUserId', DEFAULT_DEV_ACTOR_USER_ID),
  devActorEmail: optional('devActorEmail', DEFAULT_DEV_ACTOR_EMAIL),
  devActorSuperAdmin: optional('devActorSuperAdmin', true) === true,
};
