/**
 * @module services/tenancy-provider
 *
 * The guard of decision **D43**: Omnipotent was built in parallel with omnipass, behind the
 * `AccessService` interface, with a development **stub** — a fixed actor, admin of every
 * Organization, no membership read. Production must never run with it, and that must not rest on the
 * vigilance of whoever deploys.
 *
 * omnipass is now installed (`@multisearchad/omnipass-client`), so naming it is no longer refused:
 * what is refused is **production with anything else**. The day the stub is deleted — once every
 * environment resolves its callers through omnipass — this guard has nothing left to guard, and goes
 * with it.
 *
 * The check lives here, once, and `AccessServicePlugin` calls it. It **throws**, which is how a
 * plugin fails to register: `App.start` then ends the process through `killProcess`
 * (`APP::START_FAILED`, exit code 1), the refusal the contract asks for
 * (`~/OmniAd/omnipass/docs/message-socle-omnipotent.md` § 3). Do not call `killProcess` from here:
 * the guard stays a pure function, and a spec can exercise it.
 */
import { AccessProvider } from '@configs/access.config';
import { ENV, PROD } from '@constants';

/**
 * The only provider production accepts.
 */
export const PRODUCTION_PROVIDER: AccessProvider = 'omnipass';

/**
 * Refuse to start when the environment may not run the configured tenancy provider.
 *
 * Production refuses anything but omnipass, so a production deployment fails fast and loudly rather
 * than serving every Organization to every caller. Elsewhere, both providers may run: the stub for a
 * developer with no omnipass at hand, omnipass itself to exercise the real thing.
 *
 * @param provider - The configured provider (`Access.provider`, `ACCESS_PROVIDER`)
 * @returns Nothing when the provider may run here
 * @throws Error naming what to fix
 *
 * @example
 * ```typescript
 * assertTenancyProviderAllowed('local'); // fine in dev and tests, throws with NODE_ENV=prod
 * ```
 */
export function assertTenancyProviderAllowed(provider: AccessProvider): void {
  if (provider === PRODUCTION_PROVIDER) return;

  if (ENV === PROD) {
    throw new Error(
      `Access.provider is "${provider}": production requires "${PRODUCTION_PROVIDER}" (D43). The local ` +
        'implementation grants every Organization to every caller and reads no membership, so it must never serve ' +
        'real data. Set ACCESS_PROVIDER=omnipass, with OMNIPASS_CLIENT_ID and its secret in the store.'
    );
  }
}
