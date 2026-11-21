import { Column, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import type { BidStrategy, Capping, Lever, Objective, VolumeUnit } from '@src/types/lever.types';
import type { LocationIntent } from '@src/types/extension.types';
import type { PlatformShare } from '@src/types/platform.types';
import type { NodeStatus } from '@src/types/tree.types';
import { centsTransformer } from '../transformers';
import { BaseEntity } from './base.entity';
import { CampaignEntity } from './campaign.entity';
import { LeverEntity } from './lever.entity';

/**
 * The level that becomes **the budget-carrying object of the platforms** — a Google campaign, a
 * DV360 insertion order, an Amazon campaign, a Hawk order (`../../CADRAGE.md` § 7).
 *
 * Because it is that object, it carries the bidding strategy and the objective (L3, L4), and it may
 * override the platform shares its lever chose.
 */
@Entity({ name: 'ad_groups' })
export class AdGroupEntity extends BaseEntity {
  /** Organization owning it, denormalized so every read is scoped. */
  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  /** Campaign it belongs to, denormalized: reading a whole tree is then one query per level. */
  @Index()
  @Column({ type: 'uuid' })
  campaignId!: string;

  /** Lever it belongs to. */
  @Index()
  @Column({ type: 'uuid' })
  leverId!: string;

  /**
   * Channel of its lever, denormalized.
   *
   * Every write consults the lever profile and every budget read asks it whether this level carries
   * a budget: without the channel on the row, each of those would walk up the tree to find it. A
   * node never changes lever — that would be a restructuring — so the value cannot drift.
   */
  @Column({ type: 'varchar', length: 16 })
  lever!: Lever;

  /**
   * Relation to the Lever; never loaded implicitly. Named `parentLever` because `lever` is the
   * channel this row denormalizes, which the profile is keyed by.
   */
  @ManyToOne(() => LeverEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'lever_id' })
  parentLever?: LeverEntity;

  /** Relation to the Campaign; never loaded implicitly. */
  @ManyToOne(() => CampaignEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'campaign_id' })
  campaign?: CampaignEntity;

  /** Name of the AdGroup. */
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /** Whether it delivers. */
  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: NodeStatus;

  /**
   * What it runs for (L4). The lever profile gives the permitted list and the default; it conditions
   * the bidding strategies, bidding on a conversion, and sometimes the capping — and it is
   * **immutable once launched**, a guard the phase of the lifecycle adds.
   */
  @Column({ type: 'varchar', length: 32 })
  objective!: Objective;

  /** How it bids (L3); the profile gives the permitted strategies and the default. */
  @Column({ type: 'varchar', length: 32 })
  bidStrategy!: BidStrategy;

  /**
   * The conversion goal `maximize_conversions` optimizes, an id of the Advertiser's goals; ignored by
   * the other strategies (D58, `docs/phase-10.md` § 8.10). Every platform campaign of its
   * TargetingGroups optimizes it.
   */
  @Column({ type: 'uuid', nullable: true })
  conversionGoalId!: string | null;

  /**
   * The bid amount in integer cents — a CPM, a CPC or a CPCV depending on the strategy — `null` when
   * the strategy names no amount. A TargetingGroup may override it, being the real bidding object.
   */
  @Column({ type: 'bigint', nullable: true, transformer: centsTransformer })
  bidAmountCents!: number | null;

  /** Override of the lever's distribution key, `null` to keep it (`../../CADRAGE.md` § 4). */
  @Column({ type: 'jsonb', nullable: true })
  platformShares!: PlatformShare[] | null;

  /** Budget in integer cents, `null` to inherit its share by division. */
  @Column({ type: 'bigint', nullable: true, transformer: centsTransformer })
  budgetCents!: number | null;

  /** The volume entry that produced the amount, when the user entered one (L25). */
  @Column({ type: 'bigint', nullable: true, transformer: centsTransformer })
  budgetVolume!: number | null;

  /** Unit of that entry. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  budgetVolumeUnit!: VolumeUnit | null;

  /** First day of delivery, `null` to follow its parent's window. */
  @Column({ type: 'date', nullable: true })
  startsOn!: string | null;

  /** Last day of delivery, `null` to follow its parent's window. */
  @Column({ type: 'date', nullable: true })
  endsOn!: string | null;

  /** The stack of caps: `null` inherits its parent's, `[]` is explicitly none (L5, D10). */
  @Column({ type: 'jsonb', nullable: true })
  capping!: Capping | null;

  /**
   * When it was first activated in a launched campaign, by the launch or by its own activation;
   * `null` until then, and an AdGroup never activated reaches no platform (`docs/phase-10.md` § 8.4).
   */
  @Column({ type: 'timestamptz', nullable: true })
  activatedAt!: Date | null;

  /** Who its places reach, on a lever that says it; `null` is the people in them. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  locationIntent!: LocationIntent | null;

  /** Soft-delete marker. */
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
