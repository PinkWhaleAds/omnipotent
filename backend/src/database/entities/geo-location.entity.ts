import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import type { GeoLevel } from '@src/types/geo.types';

/**
 * A place of Google's catalog (`geotargets-*.csv`), the referential of the places a TargetingGroup
 * targets and the pivot of every platform's own ids (D57, `docs/phase-10.md` § 8.9). Loaded by the job
 * `geo.import`, reloaded at each new file; never deleted, so a place a TargetingGroup holds is always
 * found again.
 *
 * It belongs to no Organization: the referential is the same for everyone, like Google's.
 */
@Entity({ name: 'geo_locations' })
@Index(['countryCode', 'level'])
export class GeoLocationEntity {
  /** Google's Criteria ID (`1006094` for Paris). */
  @PrimaryColumn({ type: 'varchar', length: 12 })
  id!: string;

  /** Its name (« Paris », « 75001 »). */
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /** Its full name (« Paris,Ile-de-France,France »). */
  @Column({ type: 'varchar', length: 500 })
  canonicalName!: string;

  /**
   * Lower-cased, accent-free name, then `' | '`, then the full name (plus the French names of French
   * regions), searched with a trigram index; see `src/geo/google-geo-targets.ts`. The index is the
   * migration's: TypeORM cannot express its operator class.
   */
  @Index('IDX_geo_locations_search_trgm', { synchronize: false })
  @Column({ type: 'varchar', length: 800 })
  searchText!: string;

  /** Id of its parent place, if any. */
  @Column({ type: 'varchar', length: 12, nullable: true })
  parentId!: string | null;

  /** ISO 3166-1 alpha-2 country it belongs to. */
  @Column({ type: 'char', length: 2, nullable: true })
  countryCode!: string | null;

  /** Google's target type (`City`, `Postal Code`, `Department`…). */
  @Column({ type: 'varchar', length: 40 })
  targetType!: string;

  /** The level it is offered at, `country` for a country, `null` for a type that is not offered. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  level!: GeoLevel | 'country' | null;

  /** `Active`, or `Removal Planned` (no longer offered). */
  @Column({ type: 'varchar', length: 20 })
  status!: string;

  /** When the last import wrote it: what tells apart the places a newer catalog no longer holds. */
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
