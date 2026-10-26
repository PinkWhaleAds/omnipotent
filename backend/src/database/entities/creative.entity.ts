import { Column, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import type { CreativeFormat, CreativeSubtype } from '@src/types/creative.types';
import { AdvertiserEntity } from './advertiser.entity';
import { BaseEntity } from './base.entity';

/**
 * A creative of an Advertiser's library: **never the bytes**, which live in assets.
 *
 * Two discriminants (`../../CADRAGE.md` § 9): the **format**, the inventory it aims at, and the
 * **subtype**, how it reaches the platform. Neither ever changes — every version's payload was
 * written against them, so changing one would invalidate the whole history. That is a new creative.
 *
 * What it carries is what stays true across versions: its name, its labels, its IAB categories and
 * its click URL (L19). What a version carries is what is frozen: a payload, assets and trackers.
 */
@Entity({ name: 'creatives' })
export class CreativeEntity extends BaseEntity {
  /** Organization owning it, denormalized so every read is scoped. */
  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  /** Advertiser whose library it belongs to. */
  @Index()
  @Column({ type: 'uuid' })
  advertiserId!: string;

  /** Relation to the Advertiser; never loaded implicitly. `RESTRICT`, since deleting is soft (D19). */
  @ManyToOne(() => AdvertiserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'advertiser_id' })
  advertiser?: AdvertiserEntity;

  /** Its name. */
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /** The inventory it aims at. */
  @Column({ type: 'varchar', length: 16 })
  format!: CreativeFormat;

  /** How it reaches the platform. */
  @Column({ type: 'varchar', length: 16 })
  subtype!: CreativeSubtype;

  /** Content taxonomy ids (L19); some platforms require them, the model does not. */
  @Column({ type: 'jsonb', default: '[]' })
  iabCategories!: string[];

  /** Which taxonomy those ids come from. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  iabTaxonomyVersion!: string | null;

  /** Where a click goes; Hawk requires one on every creative, audio included (G5). */
  @Column({ type: 'varchar', length: 2048, nullable: true })
  clickThroughUrl!: string | null;

  /**
   * The version that delivers.
   *
   * No foreign key: a version points at its creative, so the reverse would close a cycle that every
   * insert would then have to break. The service keeps it on a version of this creative, and the
   * refusal `creative_version_foreign` is what guards it.
   */
  @Column({ type: 'uuid', nullable: true })
  activeVersionId!: string | null;

  /** Soft-delete marker: deleting a creative hides its versions with it (D19). */
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
