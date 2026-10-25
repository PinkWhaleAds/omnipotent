/**
 * @module database/entities
 *
 * Barrel file that re-exports every TypeORM entity, plus the list the data source registers.
 *
 * The tenancy entities (`User`, `Seat`, `Organization`, memberships, invitations) belong to omnipass
 * and never live here — a table here holds `organizationId` and `userId` as opaque uuids, with no
 * foreign key across the two databases (T4).
 */
import { AdGroupEntity } from './ad-group.entity';
import { AdvertiserEntity } from './advertiser.entity';
import { BudgetDayEntity } from './budget-day.entity';
import { CampaignEntity } from './campaign.entity';
import { LabelAssignmentEntity } from './label-assignment.entity';
import { LabelEntity } from './label.entity';
import { LeverEntity } from './lever.entity';
import { LineEntity } from './line.entity';
import { TargetingGroupEntity } from './targeting-group.entity';

export * from './ad-group.entity';
export * from './advertiser.entity';
export * from './base.entity';
export * from './budget-day.entity';
export * from './campaign.entity';
export * from './label-assignment.entity';
export * from './label.entity';
export * from './lever.entity';
export * from './line.entity';
export * from './targeting-group.entity';

/** Every entity registered on the data source. Add new entities here. */
export const ENTITIES: (new () => unknown)[] = [
  AdvertiserEntity,
  LabelEntity,
  LabelAssignmentEntity,
  CampaignEntity,
  LeverEntity,
  AdGroupEntity,
  TargetingGroupEntity,
  LineEntity,
  BudgetDayEntity,
];
