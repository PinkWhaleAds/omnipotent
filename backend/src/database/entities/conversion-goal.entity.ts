import { Column, Entity, Index } from 'typeorm';

import type {
  ConversionCategory,
  ConversionCounting,
  ConversionGoalStatus,
  ConversionValueMode,
} from '@src/types/conversion.types';
import { centsTransformer } from '../transformers';
import { BaseEntity } from './base.entity';

/**
 * A conversion goal of an Advertiser: what its site sends with `msq('conversion', { goal: '<key>' })`,
 * set up at each platform by the tracking service (D58, `docs/phase-10.md` § 8.10). Transcribed from
 * multi-search.
 *
 * Never deleted: an archived goal is no longer measured, and its objects at the platforms are left
 * where they are (R5).
 */
@Entity({ name: 'conversion_goals' })
@Index(['advertiserId', 'key'], { unique: true })
export class ConversionGoalEntity extends BaseEntity {
  /** Organization of its Advertiser; an opaque uuid from omnipass. */
  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  /** The Advertiser it belongs to. */
  @Column({ type: 'uuid' })
  advertiserId!: string;

  /** What the site sends; fixed once created. */
  @Column({ type: 'varchar', length: 40 })
  key!: string;

  /** Its name, the base of its name at the platforms. */
  @Column({ type: 'varchar', length: 80 })
  name!: string;

  /** What the conversion is; fixed once created. */
  @Column({ type: 'varchar', length: 24 })
  category!: ConversionCategory;

  /** How it is valued. */
  @Column({ type: 'varchar', length: 8, default: 'none' })
  valueMode!: ConversionValueMode;

  /** Fixed value, or fallback of a dynamic one, in integer cents of {@link currency}. */
  @Column({ type: 'bigint', nullable: true, transformer: centsTransformer })
  defaultValueCents!: number | null;

  /** ISO 4217 currency of the value, `null` without one. */
  @Column({ type: 'char', length: 3, nullable: true })
  currency!: string | null;

  /** Which conversions count: every one, or one per click. */
  @Column({ type: 'varchar', length: 8, default: 'every' })
  counting!: ConversionCounting;

  /** `active`, or `archived`. */
  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: ConversionGoalStatus;
}
