/**
 * @module services/tenancy-provider
 *
 * The guard of decision **D43**: Omnipotent is built in parallel with omnipass, behind the
 * `AccessService` interface, with a development **stub** — a fixed actor, admin of every
 * Organization, no membership read. Production must never run with it, and that must not rest on the
 * vigilance of whoever deploys.
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
 * `omnipass` is not implemented yet: it is refused everywhere, which keeps a configuration naming it
 * from silently running the local implementation instead. Production refuses anything else, so a
 * production deployment fails fast and loudly rather than serving every Organization to every
 * caller.
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
  if (provider === PRODUCTION_PROVIDER) {
    throw new Error(
      `Access.provider is "${PRODUCTION_PROVIDER}", which is not implemented yet: build omnipass and its client ` +
        '(see ~/OmniAd/omnipass/HANDOVER.md), then wire it here'
    );
  }
  if (ENV === PROD) {
    throw new Error(
      `Access.provider is "${provider}": production requires "${PRODUCTION_PROVIDER}" (D43). The local ` +
        'implementation grants every Organization to every caller and reads no membership, so it must never serve ' +
        'real data. Deploy omnipass first.'
    );
  }
}
