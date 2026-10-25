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

  /** Soft-delete marker: a deleted Advertiser is hidden but kept for history (D19). */
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
