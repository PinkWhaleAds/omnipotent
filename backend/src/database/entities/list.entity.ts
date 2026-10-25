import { Column, DeleteDateColumn, Entity, Index } from 'typeorm';

import type { ListKind } from '@src/types/targeting.types';
import { BaseEntity } from './base.entity';

/**
 * One item of a list: what the platform receives, what a human reads, and what the adapters need.
 *
 * **One shape for every kind**, because the doctrine is the same whatever the list holds: the value
 * the platform knows, plus the denormalized values that make it usable without calling a referential
 * back (`docs/phase-5.md` § 3 and § 6). A screen carries its régie and its coordinates in
 * `metadata`, a negative keyword its match type, a postal code nothing at all.
 *
 * @property value - What travels to the platform: a domain, a bundle, a screen id, a keyword
 * @property label - What an interface shows, when the value is not readable on its own
 * @property metadata - The denormalized values the adapters need, flat and scalar
 */
export type ListItem = {
  value: string;
  label?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

/**
 * A reusable list of an Organization: sites, apps, devices, points of interest, screens, keywords…
 *
 * It lives at the **Organization** level and is referenced by the targeting of its TargetingGroups
 * (`../../CADRAGE.md` § 8), which is what makes it worth having: one blocklist of sites, posted once,
 * used by every campaign of the workspace.
 *
 * A `seat_admin` can duplicate it into another Organization of the Seat, and move it — a move being
 * refused while a targeting of the origin still references it, since it would leave that targeting
 * pointing at a list it can no longer see.
 */
@Entity({ name: 'lists' })
@Index(['organizationId', 'kind', 'name'], { unique: true, where: '"deleted_at" IS NULL' })
export class ListEntity extends BaseEntity {
  /** Organization owning the list; an opaque uuid from omnipass. */
  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  /** What the list holds, which decides the dimensions it plugs into. */
  @Column({ type: 'varchar', length: 32 })
  kind!: ListKind;

  /** Its name, unique among the live lists of the same kind in its Organization. */
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /** Its items, in the order they were posted. */
  @Column({ type: 'jsonb', default: '[]' })
  items!: ListItem[];

  /** Soft-delete marker: a deleted list is hidden but kept for history (D19). */
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
