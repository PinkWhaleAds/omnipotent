import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import type { AssetRole } from '@src/types/creative.types';
import { AssetEntity } from './asset.entity';
import { BaseEntity } from './base.entity';
import { CreativeVersionEntity } from './creative-version.entity';

/**
 * Which asset plays which role in which version (`../../CADRAGE.md` § 9).
 *
 * The N-N link is between an asset and a **version**, not a creative: what is frozen are the bytes of
 * a version. « The assets of a creative » is the union of those of its versions, which is what the
 * API answers.
 *
 * The role is what the registry of couples asks for, so requiring the poster of a redirected VAST
 * (G5) costs no test on a platform name.
 */
@Entity({ name: 'creative_version_assets' })
@Index(['versionId', 'role', 'assetId'], { unique: true })
@Index(['assetId'])
export class CreativeVersionAssetEntity extends BaseEntity {
  /** The version. */
  @Column({ type: 'uuid' })
  versionId!: string;

  /** Relation to the version; never loaded implicitly. Deleting a version takes its links. */
  @ManyToOne(() => CreativeVersionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'version_id' })
  version?: CreativeVersionEntity;

  /** The asset, of the same Advertiser as the creative. */
  @Column({ type: 'uuid' })
  assetId!: string;

  /** Relation to the asset; `RESTRICT`, an asset in use never being deleted outright. */
  @ManyToOne(() => AssetEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'asset_id' })
  asset?: AssetEntity;

  /** What the asset does in that version. */
  @Column({ type: 'varchar', length: 16 })
  role!: AssetRole;
}
