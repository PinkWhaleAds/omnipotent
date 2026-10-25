import { Column, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import type { Capping, Lever, VolumeUnit } from '@src/types/lever.types';
import type { PlatformShare } from '@src/types/platform.types';
import type { NodeStatus } from '@src/types/tree.types';
import { centsTransformer } from '../transformers';
import { BaseEntity } from './base.entity';
import { CampaignEntity } from './campaign.entity';

/**
 * One channel of a campaign — `search`, `dooh`, `audio`, `social`, `ctv_tvs` or `dac` — and the
 * level that chooses **the platforms and their shares**.
 *
 * A campaign carries at most one lever of each channel: the unique index is partial, so deleting a
 * lever frees its channel, exactly as deleting an Advertiser frees its name (phase 2).
 *
 * What the lever lets the model express is its profile, `src/levers/lever-profiles.ts`, keyed by
 * channel — never a condition on `lever` anywhere in the code.
 */
@Entity({ name: 'levers' })
@Index(['campaignId', 'lever'], { unique: true, where: '"deleted_at" IS NULL' })
export class LeverEntity extends BaseEntity {
  /** Organization owning it, denormalized so every read is scoped. */
  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  /** Campaign it belongs to. */
  @Index()
  @Column({ type: 'uuid' })
  campaignId!: string;

  /** Relation to the Campaign; never loaded implicitly. */
  @ManyToOne(() => CampaignEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'campaign_id' })
  campaign?: CampaignEntity;

  /** The channel. */
  @Column({ type: 'varchar', length: 16 })
  lever!: Lever;

  /** Whether it delivers. */
  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: NodeStatus;

  /** `true` for a Products lever, which only the Search permits (L13, L14). */
  @Column({ type: 'boolean', default: false })
  productsMode!: boolean;

  /**
   * The platforms of the lever and their shares — a **distribution key, not a budget**: it applies
   * multiplicatively to the leaf, and an AdGroup may override it (`../../CADRAGE.md` § 4).
   */
  @Column({ type: 'jsonb' })
  platformShares!: PlatformShare[];

  /** Budget in integer cents, `null` to inherit its share by division. */
  @Column({ type: 'bigint', nullable: true, transformer: centsTransformer })
  budgetCents!: number | null;

  /** The volume entry that produced the amount, when the user entered one (L25). */
  @Column({ type: 'bigint', nullable: true, transformer: centsTransformer })
  budgetVolume!: number | null;

  /** Unit of that entry. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  budgetVolumeUnit!: VolumeUnit | null;

  /** First day of delivery, `null` to follow the campaign's window. */
  @Column({ type: 'date', nullable: true })
  startsOn!: string | null;

  /** Last day of delivery, `null` to follow the campaign's window. */
  @Column({ type: 'date', nullable: true })
  endsOn!: string | null;

  /** The stack of caps: `null` inherits the campaign's, `[]` is explicitly none (L5, D10). */
  @Column({ type: 'jsonb', nullable: true })
  capping!: Capping | null;

  /** Soft-delete marker. */
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
