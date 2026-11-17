/**
 * @module types/auth.types
 *
 * The vocabulary of a caller: what **the contract** defines, re-exported from
 * `@pinkwhaleads/omnipass-client`, plus the two types that are ours alone.
 *
 * Until phase 1 installed the package, this module held a hand-written copy of the snapshot and of
 * its roles, with a note saying the copy would go away. It has: the package is the single source of
 * truth for them (`~/OmniAd/omnipass/docs/message-socle-omnipotent.md` § 1), and a copy that drifts
 * from it is the kind of bug nobody sees until a sign-in fails in production. Re-exporting rather
 * than importing the package everywhere keeps every call site on `@src/types`, as the conventions
 * ask, and leaves one line to change if the contract ever moves.
 *
 * Every id in a snapshot is an **opaque uuid** (T4): no table here has a foreign key to it, and an
 * Organization that disappeared in omnipass answers 404, never 500.
 */
export {
  ORGANIZATION_ROLE_RANK,
  organizationRoleSchema,
  seatRoleSchema,
  snapshotInvitationSchema,
  snapshotSchema,
  userLanguageSchema,
  type AnsweredInvitation,
  type AuthContext,
  type OrganizationAccess,
  type OrganizationRole,
  type SeatRole,
  type Snapshot,
  type SnapshotInvitation,
  type UserLanguage,
} from '@pinkwhaleads/omnipass-client';

import type { Snapshot } from '@pinkwhaleads/omnipass-client';

/**
 * One Organization of a snapshot, with the caller's effective role in it.
 *
 * **Derived** from the contract rather than written again, so it cannot drift: the package inlines
 * this shape in its snapshot schema instead of naming it, and the pacing reads an Organization's
 * timezone from it.
 */
export type SnapshotOrganization = Snapshot['organizations'][number];

/**
 * One Seat of a snapshot, with the caller's role in it. Derived, like {@link SnapshotOrganization}.
 */
export type SnapshotSeat = Snapshot['seats'][number];

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
