/**
 * @module database/entities
 *
 * Barrel file that re-exports every TypeORM entity, plus the list the data source registers.
 *
 * The tenancy entities (`User`, `Seat`, `Organization`, memberships, invitations) belong to omnipass
 * and never live here — a table here holds `organizationId` and `userId` as opaque uuids, with no
 * foreign key across the two databases (T4).
 */
import { AdvertiserEntity } from './advertiser.entity';
import { LabelAssignmentEntity } from './label-assignment.entity';
import { LabelEntity } from './label.entity';

export * from './advertiser.entity';
export * from './base.entity';
export * from './label-assignment.entity';
export * from './label.entity';

/** Every entity registered on the data source. Add new entities here. */
export const ENTITIES: (new () => unknown)[] = [AdvertiserEntity, LabelEntity, LabelAssignmentEntity];
