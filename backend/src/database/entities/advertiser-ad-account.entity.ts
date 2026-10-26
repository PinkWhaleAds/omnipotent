import { Column, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import type { Platform } from '@src/types/platform.types';
import { AdAccountEntity } from './ad-account.entity';
import { AdvertiserEntity } from './advertiser.entity';
import { BaseEntity } from './base.entity';

/**
 * The sub-advertiser: under which identity a brand buys on a platform account
 * (`../../CADRAGE.md` § 12).
 *
 * Unique per `(advertiser, platform, currency)`: a brand buys on **one** account per currency and
 * per platform, which is the question the synchronization asks at every push. The currency is the
 * account's, not a choice of the link.
 */
@Entity({ name: 'advertiser_ad_accounts' })
@Index(['advertiserId', 'platform', 'currency'], { unique: true, where: '"deleted_at" IS NULL' })
export class AdvertiserAdAccountEntity extends BaseEntity {
  /** Organization owning it, denormalized so every read is scoped. */
  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  /** The brand. */
  @Index()
  @Column({ type: 'uuid' })
  advertiserId!: string;

  /** Relation to the Advertiser; never loaded implicitly. `RESTRICT`, since deleting is soft (D19). */
  @ManyToOne(() => AdvertiserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'advertiser_id' })
  advertiser?: AdvertiserEntity;

  /** The platform, denormalized from the account so the uniqueness can be an index. */
  @Column({ type: 'varchar', length: 32 })
  platform!: Platform;

  /** The currency this link is for, denormalized from the account for the same reason. */
  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  /** The account the brand buys on. */
  @Index()
  @Column({ type: 'uuid' })
  adAccountId!: string;

  /** Relation to the account; never loaded implicitly. */
  @ManyToOne(() => AdAccountEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ad_account_id' })
  adAccount?: AdAccountEntity;

  /** Its identity on the platform: the DV360 advertiser, the Amazon advertiser, the Meta ad account. */
  @Column({ type: 'varchar', length: 128 })
  externalAdvertiserId!: string;

  /** Soft-delete marker: an undone link is hidden but kept for history (D19). */
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
