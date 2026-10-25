import { Column, Entity, Index } from 'typeorm';

import type { TreeLevel } from '@src/types/lever.types';
import { centsTransformer } from '../transformers';
import { BaseEntity } from './base.entity';

/**
 * One day of a budget curve: a level, a node, a day, an amount.
 *
 * **One table for the five levels** (`../../CADRAGE.md` § 4), keyed on the triplet. Not one table per
 * level: the curve of an AdGroup and the curve of a campaign are the same thing, and the day a sixth
 * resource carries a budget it will have nothing to migrate. `level` is the same application
 * enumeration as the one the labels use, for the same reason.
 *
 * No foreign key to the node, since its level varies — the compromise of the polymorphic assignments
 * of D39, and the nodes being soft-deleted, an orphan curve is harmless.
 *
 * A curve is only stored once it has been **shaped**: a node whose budget is explicit and whose days
 * nobody touched answers a flat curve computed at read time, so it costs no row.
 */
@Entity({ name: 'budget_days' })
@Index(['level', 'nodeId', 'day'], { unique: true })
@Index(['level', 'nodeId'])
export class BudgetDayEntity extends BaseEntity {
  /** Level of the node this day belongs to. */
  @Column({ type: 'varchar', length: 32 })
  level!: TreeLevel;

  /** The node, an uuid of our own database — no foreign key, the level varying. */
  @Column({ type: 'uuid' })
  nodeId!: string;

  /** The day, in the timezone of the campaign. */
  @Column({ type: 'date' })
  day!: string;

  /** What the day may spend, in integer cents. **0 is a value**: it pauses delivery that day. */
  @Column({ type: 'bigint', transformer: centsTransformer })
  cents!: number;

  /** Whether the day keeps its amount when the others are recalculated. */
  @Column({ type: 'boolean', default: false })
  locked!: boolean;
}
