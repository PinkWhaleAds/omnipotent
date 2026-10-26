import { Column, Entity, Index } from 'typeorm';

import type { Platform } from '@src/types/platform.types';
import type { TreeLevel } from '@src/types/lever.types';
import { BaseEntity } from './base.entity';

/**
 * One **change** of a platform identifier, kept for ever (R5, `../../CADRAGE.md` § 7).
 *
 * **Append-only**: a row is never updated and never deleted. Our fact table is keyed on **our**
 * entities, not on platform ids, so a change of identifier breaks no aggregate — on condition that a
 * report about the previous days, which still carries the **old** id, can find the right node again.
 * That is this table, and it is the only reason it exists. MBP has exactly the same one, for exactly
 * the same reason.
 *
 * A **first materialisation** — no identifier, then an identifier — is not a change and writes no
 * row. What writes rows is the restructuring of phase 14: a TargetingGroup given its own budget turns
 * one platform campaign into several, and the old objects are paused and archived, never deleted.
 */
@Entity({ name: 'external_id_history' })
@Index(['platform', 'level', 'nodeId'])
@Index(['platform', 'previousExternalId'])
export class ExternalIdHistoryEntity extends BaseEntity {
  /** Organization owning the node; an opaque uuid from omnipass. */
  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  /** The unit the change happened under. */
  @Index()
  @Column({ type: 'uuid' })
  platformUnitId!: string;

  /** The platform. */
  @Column({ type: 'varchar', length: 32 })
  platform!: Platform;

  /** The level of ours whose object changed id. */
  @Column({ type: 'varchar', length: 16 })
  level!: TreeLevel;

  /** The node of ours, `null` for an object that is not one of them (a keyword). */
  @Column({ type: 'uuid', nullable: true })
  nodeId!: string | null;

  /** Its key in the unit's map of ids, so a keyword is found back too. */
  @Column({ type: 'varchar', length: 128 })
  refKey!: string;

  /** The id it had. */
  @Column({ type: 'varchar', length: 128 })
  previousExternalId!: string;

  /** The id it has now. */
  @Column({ type: 'varchar', length: 128 })
  externalId!: string;
}
