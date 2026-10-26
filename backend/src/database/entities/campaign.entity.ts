import { Column, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import type { Capping, VolumeUnit } from '@src/types/lever.types';
import type { CampaignStatus } from '@src/types/tree.types';
import { centsTransformer } from '../transformers';
import { AdvertiserEntity } from './advertiser.entity';
import { BaseEntity } from './base.entity';

/**
 * A campaign of an Advertiser: what the user designs once, before it is declined on every lever and
 * every platform.
 *
 * It is the only level where the budget and the dates are **mandatory**, and the only one with a
 * `draft` state: everything below inherits, and the whole tree is read in the currency and the
 * timezone fixed here (`../../CADRAGE.md` § 3, § 4).
 */
@Entity({ name: 'campaigns' })
export class CampaignEntity extends BaseEntity {
  /** Organization owning the campaign, denormalized from the Advertiser so every read is scoped. */
  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  /** Advertiser the campaign runs for. */
  @Index()
  @Column({ type: 'uuid' })
  advertiserId!: string;

  /** Relation to the Advertiser; never loaded implicitly. `RESTRICT`, since deleting is soft (D19). */
  @ManyToOne(() => AdvertiserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'advertiser_id' })
  advertiser?: AdvertiserEntity;

  /** Campaign name. Not unique: the same plan runs again next quarter under the same name. */
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /** Lifecycle status; a campaign is born a draft. */
  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status!: CampaignStatus;

  /** ISO 4217 currency of every amount of the tree, fixed at creation (D22). */
  @Column({ type: 'char', length: 3 })
  currency!: string;

  /** IANA timezone of the campaign's days; `null` follows the Organization's. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  timezone!: string | null;

  /** First day of delivery, included (`YYYY-MM-DD`). */
  @Column({ type: 'date' })
  startsOn!: string;

  /** Last day of delivery, included (`YYYY-MM-DD`). */
  @Column({ type: 'date' })
  endsOn!: string;

  /** Total budget, in integer cents of {@link CampaignEntity.currency}. */
  @Column({ type: 'bigint', transformer: centsTransformer })
  budgetCents!: number;

  /** The volume entry that produced the amount, when the user entered one (L25). */
  @Column({ type: 'bigint', nullable: true, transformer: centsTransformer })
  budgetVolume!: number | null;

  /** Unit of that entry. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  budgetVolumeUnit!: VolumeUnit | null;

  /**
   * The stack of frequency caps (L5). At the root of the tree there is nothing to inherit, so `null`
   * and an empty list mean the same thing here: no cap.
   */
  @Column({ type: 'jsonb', nullable: true })
  capping!: Capping | null;

  /** Commercial reference of the order; Hawk does not deliver without one (L24). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  insertionOrderNumber!: string | null;

  /**
   * When the day's budget must be recomputed next: **this campaign's local midnight**, with a jitter
   * (D34 rule 2, D47).
   *
   * Scheduled per campaign rather than swept: one pass a day and a campaign, naturally spread over
   * the time zones, instead of a herd of jobs at a single UTC hour. `null` while the campaign is a
   * draft — nothing is paced before the launch.
   */
  @Index({ where: '"next_pacing_at" IS NOT NULL' })
  @Column({ type: 'timestamptz', nullable: true })
  nextPacingAt!: Date | null;

  /** Soft-delete marker: deleting a campaign hides its whole subtree (D19). */
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
