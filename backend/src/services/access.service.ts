import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { accessConfig, AccessConfig } from '@configs';
import { AuthContext, OrganizationRole, SeatRole, Snapshot } from '@src/types/auth.types';
import { httpError, LoggerBuilder } from '@utils';
import { assertTenancyProviderAllowed } from './tenancy-provider';

/**
 * What a caller may do in one Organization.
 *
 * @property organizationId - The Organization
 * @property seatId - Its Seat
 * @property role - The caller's effective role (a Seat admin or a super-admin is `admin`)
 */
export type OrganizationAccess = {
  organizationId: string;
  seatId: string;
  role: OrganizationRole;
};

/**
 * Single place answering "may this caller do that?", and the only door to omnipass.
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
 * **The signatures of this interface are the contract between the two projects**
 * (`~/OmniAd/omnipass/docs/message-socle-omnipotent.md` § 2): omnipass publishes
 * `@multisearchad/omnipass-client` with exactly these, so replacing the local stub is one line in
 * {@link accessServicePlugin} and nothing in the domain. If one of them gets in the way, raise it
 * instead of adapting it here — a divergence found late is paid at the worst moment.
 *
 * The `assert*` and `get*` methods are **pure computation** on the snapshot: no network call on the
 * permission path. The only call to omnipass in a request is {@link AccessService.resolve}, once, in
 * the auth plugin.
 */
export interface AccessService {
  /**
   * Refuse anyone but a super-admin.
   *
   * @param actor - The caller
   * @returns Nothing
   * @throws Error with status 403 for any other caller
   */
  assertSuperAdmin(actor: AuthContext): void;

  /**
   * Effective role of the caller in a Seat.
   *
   * @param actor - The caller
   * @param seatId - The Seat
   * @returns The role, or `null` when the caller cannot see the Seat
   */
  getSeatRole(actor: AuthContext, seatId: string): Promise<SeatRole | null>;

  /**
   * Require a minimum role in a Seat.
   *
   * @param actor - The caller
   * @param seatId - The Seat
   * @param minimum - `member` to read, `seat_admin` to manage
   * @returns The caller's role
   * @throws Error with status 404 when the caller cannot see the Seat, 403 when the role is too low
   */
  assertSeatRole(actor: AuthContext, seatId: string, minimum: SeatRole): Promise<SeatRole>;

  /**
   * Effective access of the caller to an Organization.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @returns The access, or `null` when the caller cannot see the Organization
   */
  getOrganizationAccess(actor: AuthContext, organizationId: string): Promise<OrganizationAccess | null>;

  /**
   * Require a minimum role in an Organization.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param minimum - Lowest acceptable role
   * @returns The caller's access
   * @throws Error with status 404 when the caller cannot see the Organization, 403 when the role is too low
   *
   * @example
   * ```typescript
   * await accessService.assertOrganizationRole(actor, organizationId, 'manager');
   * ```
   */
  assertOrganizationRole(
    actor: AuthContext,
    organizationId: string,
    minimum: OrganizationRole
  ): Promise<OrganizationAccess>;

  /**
   * Forget what is cached about one user, after a membership of theirs changed.
   *
   * Call it after relaying any membership write to omnipass, so the change applies at once on this
   * process instead of at the end of the cache's TTL.
   *
   * @param userId - The user whose memberships changed
   * @returns Nothing
   */
  invalidateUser(userId: string): void;

  /**
   * Forget every cached snapshot, after a Seat or an Organization was deleted.
   *
   * @returns Nothing
   */
  invalidateAll(): void;

  /**
   * Resolve the caller of a request: our user, their Seats, Organizations and effective roles.
   *
   * The only call to omnipass on the request path, made once by the auth plugin and **never from a
   * service**; the client caches it for `Access.cacheTtl`.
   *
   * @param sub - Auth0 subject of the verified token
   * @param endUserToken - The raw token, relayed to omnipass so it acts as the user, never as the application
   * @returns The snapshot the permission checks are computed from; it never answers `null`
   * @throws `OmnipassError` with status 403 when the identity may not sign in (`user_not_invited`,
   *   `email_not_verified`, `sign_in_method_unverified`, `email_linked_elsewhere`), 401 when the relayed token
   *   is refused (`invalid_token`), 503 when omnipass cannot be reached (`authentication_unavailable`)
   */
  resolve(sub: string, endUserToken: string): Promise<Snapshot>;
}

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
 * Fastify plugin that decorates the instance with the {@link AccessService} of the configured
 * provider.
 *
 * Refuses to start when production is configured with a provider other than omnipass (D43), and
 * warns loudly otherwise, because the stub grants every Organization.
 *
 * The day `@multisearchad/omnipass-client` ships (phase 7 of omnipass), only the line building the
 * service changes; nothing in the domain does.
 *
 * @param fastify - The Fastify instance to decorate
 * @returns A promise that resolves once the decorator is registered
 * @throws Error when the configured provider may not run in this environment
 */
async function accessServicePlugin(fastify: FastifyInstance): Promise<void> {
  assertTenancyProviderAllowed(accessConfig.provider);
  LoggerBuilder.getChildLogger('AccessService').warn(
    'The tenancy is a development stub: every caller is a fixed actor, admin of every Organization ' +
      'and seat_admin of every Seat, and no membership is read. Never in production (D43).',
    { code: 'ACCESS::LOCAL_STUB' }
  );
  fastify.decorate('accessService', new LocalAccessService(accessConfig));
}

export default fastifyPlugin(accessServicePlugin, {
  name: 'AccessServicePlugin',
});
