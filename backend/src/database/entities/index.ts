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
import { AdAccountEntity } from './ad-account.entity';
import { AdvertiserAdAccountEntity } from './advertiser-ad-account.entity';
import { AdvertiserTrackingEntity } from './advertiser-tracking.entity';
import { AdvertiserEntity } from './advertiser.entity';
import { AssetEntity } from './asset.entity';
import { BudgetDayEntity } from './budget-day.entity';
import { CampaignEntity } from './campaign.entity';
import { ConversionGoalRefEntity } from './conversion-goal-ref.entity';
import { ConversionGoalEntity } from './conversion-goal.entity';
import { CreativeVersionAssetEntity } from './creative-version-asset.entity';
import { CreativeVersionEntity } from './creative-version.entity';
import { CreativeEntity } from './creative.entity';
import { ExternalIdHistoryEntity } from './external-id-history.entity';
import { GeoLocationEntity } from './geo-location.entity';
import { KeywordEntity } from './keyword.entity';
import { LabelAssignmentEntity } from './label-assignment.entity';
import { LabelEntity } from './label.entity';
import { LeverEntity } from './lever.entity';
import { LineEntity } from './line.entity';
import { ListEntity } from './list.entity';
import { PlatformCallEntity } from './platform-call.entity';
import { PlatformUnitEntity } from './platform-unit.entity';
import { TargetingGroupEntity } from './targeting-group.entity';

export * from './ad-group.entity';
export * from './ad-account.entity';
export * from './advertiser-ad-account.entity';
export * from './advertiser.entity';
export * from './advertiser-tracking.entity';
export * from './asset.entity';
export * from './base.entity';
export * from './budget-day.entity';
export * from './campaign.entity';
export * from './conversion-goal-ref.entity';
export * from './conversion-goal.entity';
export * from './creative-version-asset.entity';
export * from './creative-version.entity';
export * from './creative.entity';
export * from './external-id-history.entity';
export * from './geo-location.entity';
export * from './keyword.entity';
export * from './label-assignment.entity';
export * from './label.entity';
export * from './lever.entity';
export * from './line.entity';
export * from './list.entity';
export * from './platform-call.entity';
export * from './platform-unit.entity';
export * from './targeting-group.entity';

/** Every entity registered on the data source. Add new entities here. */
export const ENTITIES: (new () => unknown)[] = [
  AdvertiserEntity,
  AdAccountEntity,
  AdvertiserAdAccountEntity,
  LabelEntity,
  LabelAssignmentEntity,
  CampaignEntity,
  LeverEntity,
  AdGroupEntity,
  TargetingGroupEntity,
  LineEntity,
  BudgetDayEntity,
  ListEntity,
  KeywordEntity,
  AssetEntity,
  CreativeEntity,
  CreativeVersionEntity,
  CreativeVersionAssetEntity,
  PlatformUnitEntity,
  ExternalIdHistoryEntity,
  PlatformCallEntity,
  GeoLocationEntity,
  ConversionGoalEntity,
  ConversionGoalRefEntity,
  AdvertiserTrackingEntity,
];
