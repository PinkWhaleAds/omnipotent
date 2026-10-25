import { Column, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import type { Capping, Lever, VolumeUnit } from '@src/types/lever.types';
import type { NodeStatus } from '@src/types/tree.types';
import { centsTransformer } from '../transformers';
import { AdGroupEntity } from './ad-group.entity';
import { BaseEntity } from './base.entity';
import { CampaignEntity } from './campaign.entity';

/**
 * The level that carries **all the targeting** (D14), and the real bidding object of the platforms —
 * a Google ad group, a DV360 line item, an Amazon ad group, a Meta ad set
 * (`../../CADRAGE.md` § 7, § 8).
 *
 * It has **no dates**: it is a targeting applied, not a period of delivery. The targeting dimensions
 * themselves arrive with the phase of the targeting; what is here is the node and its money.
 */
@Entity({ name: 'targeting_groups' })
export class TargetingGroupEntity extends BaseEntity {
  /** Organization owning it, denormalized so every read is scoped. */
  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  /** Campaign it belongs to, denormalized. */
  @Index()
  @Column({ type: 'uuid' })
  campaignId!: string;

  /** AdGroup it belongs to. */
  @Index()
  @Column({ type: 'uuid' })
  adGroupId!: string;

  /**
   * Channel of its lever, denormalized.
   *
   * Every write consults the lever profile and every budget read asks it whether this level carries
   * a budget: without the channel on the row, each of those would walk up the tree to find it. A
   * node never changes lever — that would be a restructuring — so the value cannot drift.
   */
  @Column({ type: 'varchar', length: 16 })
  lever!: Lever;

  /** Relation to the AdGroup; never loaded implicitly. */
  @ManyToOne(() => AdGroupEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ad_group_id' })
  adGroup?: AdGroupEntity;

  /** Relation to the Campaign; never loaded implicitly. */
  @ManyToOne(() => CampaignEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'campaign_id' })
  campaign?: CampaignEntity;

  /** Name of the TargetingGroup. */
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /** Whether it delivers. */
  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: NodeStatus;

  /**
   * Override of the bid amount of its AdGroup, in integer cents, `null` to keep it (L3). Only the
   * amount is overridable: the strategy stays the AdGroup's, since it is the object that holds the
   * budget on the platforms.
   */
  @Column({ type: 'bigint', nullable: true, transformer: centsTransformer })
  bidAmountCents!: number | null;

  /** Budget in integer cents, `null` to inherit its share by division. */
  @Column({ type: 'bigint', nullable: true, transformer: centsTransformer })
  budgetCents!: number | null;

  /** The volume entry that produced the amount, when the user entered one (L25). */
  @Column({ type: 'bigint', nullable: true, transformer: centsTransformer })
  budgetVolume!: number | null;

  /** Unit of that entry. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  budgetVolumeUnit!: VolumeUnit | null;

  /** The stack of caps: `null` inherits its parent's, `[]` is explicitly none (L5, D10). */
  @Column({ type: 'jsonb', nullable: true })
  capping!: Capping | null;

  /** Soft-delete marker. */
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
