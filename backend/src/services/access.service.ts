import { AccessService, OmnipassClient } from '@pinkwhaleads/omnipass-client';
import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { accessConfig, authConfig, omnipassConfig } from '@configs';
import { OrganizationAccess } from '@src/types/auth.types';
import { LoggerBuilder } from '@utils';

/**
 * The door to omnipass, and the single place answering "may this caller do that?".
 *
 * **The interface is the contract of the two projects**, and it is the package's own
 * (`@pinkwhaleads/omnipass-client`, `docs/consuming.md` of `PinkWhaleAds/omnipass`): it is re-exported
 * here so that every service keeps importing it from its neighbour, and so that a signature cannot
 * drift from the one omnipass implements. If one of them gets in the way, raise it instead of adapting
 * it here — a divergence found late is paid at the worst moment.
 *
 * Every service method calls one of the `assert*` methods first, so HTTP routes, MCP tools and job
 * handlers enforce the same rules — never a handler (`CLAUDE.md`).
 *
 * Effective roles, computed from the snapshot of the caller:
 * - a super-admin is a `seat_admin` of every Seat and an `admin` of every Organization;
 * - a `seat_admin` is an `admin` of every Organization of their Seat;
 * - anyone else has the role of their Organization membership, if any.
 *
 * A Seat or Organization the caller cannot see answers **404**, never 403, so its existence does not
 * leak; a role too low answers **403**. An Organization that disappeared in omnipass is therefore a
 * 404 as well, never a 500 (T4).
 *
 * The `assert*` and `get*` methods are **pure computation** on the snapshot: no network call on the
 * permission path. The only call to omnipass in a request is `resolve`, once, in the auth plugin.
 *
 * There is **one implementation**, and it is omnipass's. A development stub lived here until the
 * relayed path was verified against the real service (D43, amended on 2026-11-17): it granted `admin`
 * on every Organization, so it could only ever hide the refusals that matter.
 */
export type { AccessService, OrganizationAccess };

/**
 * Build the client: omnipass behind the interface above.
 *
 * The secret's **value** never travels through the configuration (`../../CADRAGE.md` § 12): the name
 * of its entry does, and the store is read here, once, when the client is built. A missing value
 * makes the package throw at startup rather than at the first sign-in, which is what we want — a
 * deployment mistake must be seen in the first seconds of a task, not by a user.
 *
 * @param fastify - The instance, for its secret store
 * @returns The client, which implements {@link AccessService} without an adapter
 *
 * @example
 * ```typescript
 * const access: AccessService = await buildOmnipassClient(fastify);
 * ```
 */
export async function buildOmnipassClient(fastify: FastifyInstance): Promise<AccessService> {
  return new OmnipassClient({
    url: omnipassConfig.url,
    audience: omnipassConfig.audience,
    clientId: omnipassConfig.clientId,
    clientSecret: await fastify.secretStore.get(omnipassConfig.secretName),
    auth0Domain: authConfig.domain,
    cacheTtl: accessConfig.cacheTtl,
    logger: LoggerBuilder.getChildLogger('Omnipass'),
  });
}

/**
 * Fastify plugin that decorates the instance with the {@link AccessService}.
 *
 * One call to omnipass per user per minute to resolve a caller, and nothing on the permission path.
 * Starting without a machine account, or without its secret in the store, **fails here** rather than
 * at the first sign-in.
 *
 * @param fastify - The Fastify instance to decorate
 * @returns A promise that resolves once the decorator is registered
 * @throws Error when the client is missing a value it cannot work without
 */
async function accessServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('accessService', await buildOmnipassClient(fastify));
}

export default fastifyPlugin(accessServicePlugin, {
  name: 'AccessServicePlugin',
  dependencies: ['SecretStorePlugin'],
});
