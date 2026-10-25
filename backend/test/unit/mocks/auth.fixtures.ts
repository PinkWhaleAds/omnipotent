import { AuthContext, OrganizationRole, SeatRole, Snapshot } from '@src/types';

/** Ids reused across tests. They are opaque uuids: omnipass owns what they designate (T4). */
export const IDS = {
  seat: 'b0000000-0000-4000-8000-000000000001',
  otherSeat: 'b0000000-0000-4000-8000-000000000002',
  organization: 'c0000000-0000-4000-8000-000000000001',
  otherOrganization: 'c0000000-0000-4000-8000-000000000002',
  advertiser: 'd0000000-0000-4000-8000-000000000001',
} as const;

/**
 * Build the snapshot omnipass answers for a caller, and the `AuthContext` the auth plugin puts on
 * the request from it.
 *
 * @param user - Our user, as omnipass knows them
 * @param tenancy - The Seats and Organizations they have a role in; none by default
 * @param tenancy.seats - Their Seats
 * @param tenancy.organizations - Their Organizations
 * @returns The caller
 *
 * @example
 * ```typescript
 * const jane: AuthContext = actor(
 *   { id: IDS.user, email: 'jane@brand.test', isSuperAdmin: false },
 *   { organizations: [{ id: IDS.organization, seatId: IDS.seat, role: 'manager' }] }
 * );
 * ```
 */
export function actor(
  user: Snapshot['user'],
  tenancy: {
    seats?: { id: string; name?: string; role: SeatRole }[];
    organizations?: { id: string; seatId: string; name?: string; timezone?: string; role: OrganizationRole }[];
  } = {}
): AuthContext {
  const snapshot: Snapshot = {
    user,
    seats: (tenancy.seats ?? []).map((seat) => ({ name: 'Seat', ...seat })),
    organizations: (tenancy.organizations ?? []).map((organization) => ({
      name: 'Organization',
      timezone: 'Europe/Paris',
      ...organization,
    })),
  };
  return { userId: user.id, email: user.email, isSuperAdmin: user.isSuperAdmin, tenancy: snapshot };
}

/** A platform administrator: a super-admin is `admin` of every Organization, listed or not. */
export const SUPER_ADMIN: AuthContext = actor({
  id: 'a0000000-0000-4000-8000-000000000001',
  email: 'root@omnipotent.test',
  isSuperAdmin: true,
});

/** A regular user, `manager` of one Organization and `member` of its Seat. */
export const JANE: AuthContext = actor(
  { id: 'a0000000-0000-4000-8000-000000000002', email: 'jane@brand.test', isSuperAdmin: false },
  {
    seats: [{ id: IDS.seat, role: 'member' }],
    organizations: [{ id: IDS.organization, seatId: IDS.seat, role: 'manager' }],
  }
);

/** Another regular user, with no Seat and no Organization. */
export const JOHN: AuthContext = actor({
  id: 'a0000000-0000-4000-8000-000000000003',
  email: 'john@brand.test',
  isSuperAdmin: false,
});

/** A fixed instant, for rows' timestamps. */
export const NOW: Date = new Date('2026-10-06T10:00:00.000Z');
