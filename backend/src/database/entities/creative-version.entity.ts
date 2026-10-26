import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import type { Tracker } from '@src/types/creative.types';
import { BaseEntity } from './base.entity';
import { CreativeEntity } from './creative.entity';

/**
 * One version of a creative, **immutable** (`../../CADRAGE.md` § 9, `docs/phase-6.md` § 4).
 *
 * A creative that delivers must be able to change **without interrupting delivery** while the
 * platforms revalidate: so a version is never updated and never deleted, a change being a new
 * version, and the creative points at the one that delivers. The old one serves until the new one
 * takes over.
 *
 * This is the assumed difference with multi-search, which mutates its creative in place and detects
 * changes by hash — enough in Search, where review is quick, not enough as soon as a creative runs on
 * several DSPs that each put it back through validation.
 */
@Entity({ name: 'creative_versions' })
@Index(['creativeId', 'version'], { unique: true })
export class CreativeVersionEntity extends BaseEntity {
  /** Organization owning it, denormalized so every read is scoped. */
  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  /** The creative it belongs to. */
  @Index()
  @Column({ type: 'uuid' })
  creativeId!: string;

  /** Relation to the creative; never loaded implicitly. Deleting a creative takes its versions. */
  @ManyToOne(() => CreativeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'creative_id' })
  creative?: CreativeEntity;

  /** Its number inside that creative, from 1. */
  @Column({ type: 'integer' })
  version!: number;

  /** What its couple carries, in the shape the registry declares. */
  @Column({ type: 'jsonb', default: '{}' })
  payload!: object;

  /** Its third-party trackers (L18); a `Line` may override the whole set. */
  @Column({ type: 'jsonb', default: '[]' })
  trackers!: Tracker[];
}
