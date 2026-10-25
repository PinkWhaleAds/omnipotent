/**
 * @module database/entities
 *
 * Barrel file that re-exports every TypeORM entity, plus the list the data source registers.
 *
 * The socle carries no entity: the domain ones arrive in their phases, and the tenancy ones
 * (`User`, `Seat`, `Organization`, memberships) belong to omnipass and never live here — a table
 * here holds `organizationId` and `userId` as opaque uuids, with no foreign key across the two
 * databases (T4).
 */
export * from './base.entity';

/** Every entity registered on the data source. Add new entities here. */
export const ENTITIES: (new () => unknown)[] = [];
