import { z } from 'zod';

/**
 * Role of a user inside a Seat.
 *
 * - `seat_admin` — manages the Seat's Organizations and users, and acts as an
 *   `admin` in every Organization of the Seat.
 * - `member` — belongs to the Seat; what they can do depends on their
 *   Organization roles.
 *
 * The memberships themselves live in omnipass, their only writer (T5); this application only reads
 * them, in the snapshot its `AccessService` resolves once per request.
 */
export const seatRoleSchema = z.enum(['seat_admin', 'member']);

/** TypeScript type inferred from {@link seatRoleSchema}. */
export type SeatRole = z.infer<typeof seatRoleSchema>;

/**
 * Role of a user inside an Organization, from the least to the most privileged.
 *
 * - `viewer` — reads what the Organization holds.
 * - `manager` — also creates and changes it.
 * - `admin` — also connects the Organization's accounts and manages its users.
 *
 * Three coarse roles, nothing finer: "what may this role do here" stays in our services, the role
 * itself comes from omnipass.
 */
export const organizationRoleSchema = z.enum(['viewer', 'manager', 'admin']);

/** TypeScript type inferred from {@link organizationRoleSchema}. */
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

/**
 * Rank of each {@link OrganizationRole}: a role grants everything a lower rank grants.
 *
 * @example
 * ```typescript
 * ORGANIZATION_ROLE_RANK.admin >= ORGANIZATION_ROLE_RANK.manager; // true
 * ```
 */
export const ORGANIZATION_ROLE_RANK: Record<OrganizationRole, number> = {
  viewer: 1,
  manager: 2,
  admin: 3,
};

/**
 * One Seat of the caller, as omnipass gives it.
 *
 * @property id - Opaque uuid of the Seat in omnipass
 * @property name - Its name, denormalized so a listing needs no second call
 * @property role - The caller's role in it
 */
export const snapshotSeatSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: seatRoleSchema,
});

/** TypeScript type inferred from {@link snapshotSeatSchema}. */
export type SnapshotSeat = z.infer<typeof snapshotSeatSchema>;

/**
 * One Organization of the caller, as omnipass gives it.
 *
 * @property id - Opaque uuid of the Organization in omnipass
 * @property seatId - The Seat it belongs to
 * @property name - Its name, denormalized
 * @property timezone - Its IANA time zone, which the budget of a day is prorated on
 * @property role - The caller's role in it
 */
export const snapshotOrganizationSchema = z.object({
  id: z.uuid(),
  seatId: z.uuid(),
  name: z.string(),
  timezone: z.string(),
  role: organizationRoleSchema,
});

/** TypeScript type inferred from {@link snapshotOrganizationSchema}. */
export type SnapshotOrganization = z.infer<typeof snapshotOrganizationSchema>;

/**
 * What omnipass answers about the caller of a request: our user, their Seats, their Organizations
 * and their effective roles.
 *
 * It is the whole reason the `assert*` methods of `AccessService` are **pure computation**: an
 * effective role is deduced entirely from `seats` and `organizations`, so a permission check costs
 * no network call. One `resolve` per request, in the auth plugin, and the client's cache removes
 * most of those.
 *
 * Every id here is an **opaque uuid** (T4): no table of this application has a foreign key to it,
 * and an Organization that disappeared in omnipass answers 404, never 500.
 *
 * @property user - Our user, as omnipass knows them
 * @property seats - The Seats the caller belongs to
 * @property organizations - The Organizations the caller has a role in
 */
export const snapshotSchema = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.email(),
    isSuperAdmin: z.boolean(),
  }),
  seats: z.array(snapshotSeatSchema),
  organizations: z.array(snapshotOrganizationSchema),
});

/**
 * TypeScript type inferred from {@link snapshotSchema}.
 *
 * Named as the contract names it (`~/OmniAd/omnipass/docs/message-socle-omnipotent.md` § 2), so the
 * day `@omnilor/omnipass-client` replaces our copy, only the import changes.
 */
export type Snapshot = z.infer<typeof snapshotSchema>;

/**
 * The authenticated caller, resolved once per request from the bearer token.
 *
 * Every service method that reads or changes tenant data takes it as its first argument, so HTTP
 * routes, MCP tools and job handlers go through the same permission checks.
 *
 * `userId` is an **opaque** uuid: omnipass owns the user, and no table here has a foreign key to
 * it (T4). The three flat fields repeat what `tenancy.user` holds, so a call site reads
 * `actor.userId` as it does in multi-search.
 *
 * @property userId - Id of the user in omnipass (not the Auth0 subject)
 * @property email - Verified email of the user
 * @property isSuperAdmin - Whether the user operates the platform itself
 * @property tenancy - The snapshot every permission check is computed from
 */
export type AuthContext = {
  userId: string;
  email: string;
  isSuperAdmin: boolean;
  tenancy: Snapshot;
};

/**
 * How a route authenticates its caller.
 *
 * - `api` (default) — a bearer token issued for the REST API audience.
 * - `mcp` — a bearer token issued for the MCP resource; failures answer with the
 *   `WWW-Authenticate` challenge MCP clients follow to sign in.
 * - `none` — public route (probes, status, OAuth metadata).
 */
export type AuthMode = 'api' | 'mcp' | 'none';

/**
 * The claims this application reads from a verified access token.
 *
 * Only `sub` is read: the email, the roles and the Seats come from omnipass, never from the token
 * (T3) — a revoked administrator would otherwise keep their rights until their JWT expired.
 *
 * @property sub - Auth0 subject, the stable identifier of the identity
 */
export type AccessTokenClaims = {
  sub: string;
  [claim: string]: unknown;
};
