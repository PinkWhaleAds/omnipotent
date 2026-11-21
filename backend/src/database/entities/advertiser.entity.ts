import { Column, DeleteDateColumn, Entity, Index } from 'typeorm';

import { BaseEntity } from './base.entity';

/**
 * An Advertiser is the brand campaigns are run for.
 *
 * It belongs to one Organization of omnipass, held as an **opaque uuid**: no foreign key leaves this
 * database (T4). Later phases attach its creative library and the ad accounts it uses on each
 * platform.
 */
@Entity({ name: 'advertisers' })
@Index(['organizationId', 'name'], { unique: true, where: '"deleted_at" IS NULL' })
@Index(['trackingKey'], { unique: true, where: '"tracking_key" IS NOT NULL' })
export class AdvertiserEntity extends BaseEntity {
  /** Organization owning this Advertiser; an opaque uuid from omnipass. */
  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  /**
   * Brand name, unique among the live Advertisers of its Organization.
   *
   * The uniqueness only looks at the living ones (the partial index above), so deleting a brand
   * frees its name and recreating it is not refused.
   */
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /** Website of the brand, which a later phase reads to write ad copy. */
  @Column({ type: 'varchar', length: 2048, nullable: true })
  websiteUrl!: string | null;

  /**
   * Public key of its tracking script (`/t/<key>.js`), 24 random URL-safe characters, given on the first
   * read of its tracking (`docs/phase-10.md` § 8.10). Public by nature: the sites load it.
   */
  @Column({ type: 'varchar', length: 32, nullable: true })
  trackingKey!: string | null;

  /** Last time a page of its site loaded the tracking script, recorded once an hour at most. */
  @Column({ type: 'timestamptz', nullable: true })
  scriptSeenAt!: Date | null;

  /** Soft-delete marker: a deleted Advertiser is hidden but kept for history (D19). */
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
