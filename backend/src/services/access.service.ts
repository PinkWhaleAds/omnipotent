import { AccessService, OmnipassClient } from '@multisearchad/omnipass-client';
import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { accessConfig, AccessConfig, authConfig, omnipassConfig } from '@configs';
import { AuthContext, OrganizationAccess, OrganizationRole, SeatRole, Snapshot } from '@src/types/auth.types';
import { httpError, LoggerBuilder } from '@utils';
import { assertTenancyProviderAllowed } from './tenancy-provider';

/**
 * The door to omnipass, and the single place answering "may this caller do that?".
 *
 * **The interface is the contract of the two projects**, and it is now the package's own
 * (`@multisearchad/omnipass-client`, `~/OmniAd/omnipass/docs/message-socle-omnipotent.md` § 2): it is
 * re-exported here so that every service keeps importing it from its neighbour, and so that a
 * signature cannot drift from the one omnipass implements. If one of them gets in the way, raise it
 * instead of adapting it here — a divergence found late is paid at the worst moment.
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
 */
export type { AccessService, OrganizationAccess };

/**
 * The Seat the stub pretends every Organization belongs to. A fixed value rather than a setting: the
 * contract names three development variables, and a fourth would suggest the stub models something.
 */
const STUB_SEAT_ID = '00000000-0000-4000-8000-000000000001';

/**
 * The {@link AccessService} of development: a **stub**, not a tenancy.
 *
 * `CADRAGE.md` § 8 said "a local implementation (the same tables)", but the socle may not carry the
 * tenancy at all — that is the T1/T5 boundary. The two do not hold together, so omnipass settled it
 * (`message-socle-omnipotent.md` § 3): without tables, the local implementation is a stub whose only
 * job is to let the domain compile and the application run by hand.
 *
 * - a fixed development actor, read from the environment (`DEV_ACTOR_USER_ID`, `DEV_ACTOR_EMAIL`,
 *   `DEV_ACTOR_SUPER_ADMIN`);
 * - `admin` on any Organization, `seat_admin` on any Seat — **nothing is hidden and no membership is
 *   read**, so there is no 404 either;
 * - a loud `logger.warn` at startup, so nobody believes the tenancy works;
 * - and the guard of D43: with `NODE_ENV=production` the application refuses to start.
 *
 * It does not degrade the tests: a service spec mocks `AccessService`, as multi-search's do.
 *
 * @example
 * ```typescript
 * const access: AccessService = new LocalAccessService(accessConfig);
 * await access.assertOrganizationRole(actor, organizationId, 'manager'); // always granted
 * ```
 */
export class LocalAccessService implements AccessService {
  /**
   * Create the stub.
   *
   * @param config - The access configuration, which names the development actor
   */
  constructor(private readonly config: AccessConfig = accessConfig) {}

  /** @inheritdoc */
  public assertSuperAdmin(actor: AuthContext): void {
    if (!actor.isSuperAdmin) {
      throw httpError(403, 'This action is reserved to platform administrators', { code: 'super_admin_required' });
    }
  }

  /** @inheritdoc */
  public async getSeatRole(_actor: AuthContext, _seatId: string): Promise<SeatRole | null> {
    return 'seat_admin';
  }

  /**
   * @inheritdoc
   *
   * The stub grants `seat_admin`, which satisfies every minimum: it never answers 404 `seat_not_found`
   * nor 403 `role_required`. Those refusals are the omnipass client's, and `docs/error-codes.md`
   * documents them as such.
   */
  public async assertSeatRole(actor: AuthContext, seatId: string, _minimum: SeatRole): Promise<SeatRole> {
    return (await this.getSeatRole(actor, seatId)) as SeatRole;
  }

  /** @inheritdoc */
  public async getOrganizationAccess(_actor: AuthContext, organizationId: string): Promise<OrganizationAccess | null> {
    return { organizationId, seatId: STUB_SEAT_ID, role: 'admin' };
  }

  /**
   * @inheritdoc
   *
   * The stub grants `admin`, which satisfies every minimum: it never answers 404
   * `organization_not_found` nor 403 `role_required`. Those refusals are the omnipass client's.
   */
  public async assertOrganizationRole(
    actor: AuthContext,
    organizationId: string,
    _minimum: OrganizationRole
  ): Promise<OrganizationAccess> {
    return (await this.getOrganizationAccess(actor, organizationId)) as OrganizationAccess;
  }

  /** @inheritdoc */
  public invalidateUser(_userId: string): void {
    // Nothing is cached: every answer is computed from the configuration.
  }

  /** @inheritdoc */
  public invalidateAll(): void {
    // Nothing is cached.
  }

  /** @inheritdoc */
  public async resolve(_sub: string, _endUserToken: string): Promise<Snapshot> {
    return {
      user: {
        id: this.config.devActorUserId,
        email: this.config.devActorEmail,
        name: null,
        isSuperAdmin: this.config.devActorSuperAdmin,
        language: null,
      },
      // No Seat, Organization or invitation is listed: the stub grants them all without reading any,
      // so a caller never needs the snapshot to hold one. A listing route therefore answers nothing
      // here, which is the clearest sign that the tenancy is not wired yet.
      seats: [],
      organizations: [],
      invitations: [],
    };
  }
}

/**
 * Build the real client: omnipass behind the same interface.
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
 * Fastify plugin that decorates the instance with the {@link AccessService} of the configured
 * provider.
 *
 * With `omnipass`, the client of the package: one call per user per minute to resolve a caller, and
 * nothing on the permission path. With `local`, the stub — which is why it warns loudly, and why
 * D43's guard refuses it in production.
 *
 * @param fastify - The Fastify instance to decorate
 * @returns A promise that resolves once the decorator is registered
 * @throws Error when the configured provider may not run in this environment, or when the client is
 *   missing a value it cannot work without
 */
async function accessServicePlugin(fastify: FastifyInstance): Promise<void> {
  assertTenancyProviderAllowed(accessConfig.provider);

  if (accessConfig.provider === 'omnipass') {
    fastify.decorate('accessService', await buildOmnipassClient(fastify));
    return;
  }

  LoggerBuilder.getChildLogger('AccessService').warn(
    'The tenancy is a development stub: every caller is a fixed actor, admin of every Organization ' +
      'and seat_admin of every Seat, and no membership is read. Never in production (D43).',
    { code: 'ACCESS::LOCAL_STUB' }
  );
  fastify.decorate('accessService', new LocalAccessService(accessConfig));
}

export default fastifyPlugin(accessServicePlugin, {
  name: 'AccessServicePlugin',
  dependencies: ['SecretStorePlugin'],
});
