import { Column, DeleteDateColumn, Entity, Index } from 'typeorm';

import { BaseEntity } from './base.entity';

/**
 * A Label is how a user finds their work again: flat, and several per resource.
 *
 * Deliberately **not** a folder tree — a resource does not have to live in one place (CADRAGE § 10).
 * A label is an organizing tool and **never** carries behaviour: nothing in the domain may decide
 * anything from a label, or it becomes a configuration in disguise that nobody can move.
 */
@Entity({ name: 'labels' })
@Index(['organizationId', 'name'], { unique: true, where: '"deleted_at" IS NULL' })
export class LabelEntity extends BaseEntity {
  /** Organization owning this Label; an opaque uuid from omnipass. */
  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  /** Name, unique among the live Labels of its Organization. */
  @Column({ type: 'varchar', length: 64 })
  name!: string;

  /** Colour the interface shows it in, `#rrggbb` in lower case. */
  @Column({ type: 'varchar', length: 7 })
  color!: string;

  /** Soft-delete marker: a deleted Label is hidden, and its assignments are kept (D19). */
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
