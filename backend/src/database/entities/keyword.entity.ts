import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import type { MatchType } from '@src/types/keyword.types';
import { BaseEntity } from './base.entity';
import { TargetingGroupEntity } from './targeting-group.entity';

/**
 * A keyword of a TargetingGroup: the words a Search campaign buys, and those it refuses.
 *
 * Transcribed from multi-search, where the limits are proven, with **one** difference: it hangs from
 * the TargetingGroup and not from the AdGroup, since all the targeting lives on the TargetingGroup
 * here (`../../CADRAGE.md` § 8, `docs/phase-5.md` § 4).
 *
 * It is a row rather than a dimension of the targeting object because an AdGroup carries thousands of
 * them, posted by the hundred and listed page by page — an object would be rewritten whole each time.
 *
 * A keyword is **deleted outright**, with no soft-delete: it carries no history worth keeping, and
 * multi-search never gave it one either.
 */
@Entity({ name: 'keywords' })
@Index(['targetingGroupId', 'text', 'matchType', 'negative'], { unique: true })
export class KeywordEntity extends BaseEntity {
  /** Organization owning it, denormalized so every read is scoped. */
  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  /** Campaign it belongs to, denormalized, so a report never walks the tree. */
  @Index()
  @Column({ type: 'uuid' })
  campaignId!: string;

  /** TargetingGroup it belongs to. */
  @Index()
  @Column({ type: 'uuid' })
  targetingGroupId!: string;

  /** Relation to the TargetingGroup; never loaded implicitly. */
  @ManyToOne(() => TargetingGroupEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'targeting_group_id' })
  targetingGroup?: TargetingGroupEntity;

  /** The keyword itself, lower-cased with single spaces. */
  @Column({ type: 'varchar', length: 80 })
  text!: string;

  /** How closely a query must match it. */
  @Column({ type: 'varchar', length: 8 })
  matchType!: MatchType;

  /** A negative keyword prevents delivery instead of triggering it. */
  @Column({ type: 'boolean', default: false })
  negative!: boolean;
}
