import { Column, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import type { AssetKind, AssetProvenance } from '@src/types/asset.types';
import { AdvertiserEntity } from './advertiser.entity';
import { BaseEntity } from './base.entity';

/**
 * The bytes of a creative, and a **resource of its own** (`../../CADRAGE.md` § 9).
 *
 * Not an attachment: an asset has its CRUD, its labels and its search, and it exists **before** any
 * creative — which is what makes generation by AI possible in both directions, the model producing
 * raw assets to assemble later, and the client posting assets to feed a generation.
 *
 * Its **fingerprint is unique per Advertiser** among the living ones: posting the same file twice
 * answers the asset already there, so an upload is repeatable, while two brands that happen to use
 * the same image each keep their own — deleting one never breaks the other's creatives
 * (`docs/phase-6.md` § 10).
 *
 * An asset a living version uses **cannot be deleted**: the refusal says how many creatives hold it,
 * and there is never a broken creative.
 */
@Entity({ name: 'assets' })
@Index(['advertiserId', 'fingerprint'], { unique: true, where: '"deleted_at" IS NULL' })
export class AssetEntity extends BaseEntity {
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

  /** Name it was uploaded under. */
  @Column({ type: 'varchar', length: 255 })
  fileName!: string;

  /** What it holds, derived from its MIME type: what a creative couple asks for by role. */
  @Column({ type: 'varchar', length: 16 })
  kind!: AssetKind;

  /** Its MIME type, read from the bytes for an image. */
  @Column({ type: 'varchar', length: 128 })
  mimeType!: string;

  /** Its weight, in bytes. */
  @Column({ type: 'bigint', transformer: { to: (value: number): number => value, from: Number } })
  sizeBytes!: number;

  /** Pixels, for an image; `null` otherwise. */
  @Column({ type: 'integer', nullable: true })
  width!: number | null;

  /** Pixels, for an image; `null` otherwise. */
  @Column({ type: 'integer', nullable: true })
  height!: number | null;

  /**
   * Milliseconds, for a video or an audio.
   *
   * **Declared** by the caller: measuring it would need `ffprobe`, which the image does not carry,
   * and no validation of ours replaces a platform's (`docs/phase-6.md` § 10).
   */
  @Column({ type: 'integer', nullable: true })
  durationMs!: number | null;

  /** SHA-256 of the bytes: the same file twice is the same asset. */
  @Column({ type: 'varchar', length: 64 })
  fingerprint!: string;

  /** Where the bytes come from. */
  @Column({ type: 'varchar', length: 16, default: 'uploaded' })
  provenance!: AssetProvenance;

  /** The generation that produced it, an opaque uuid until the phase that owns generations. */
  @Column({ type: 'uuid', nullable: true })
  aiGenerationId!: string | null;

  /** Its key in the object storage: `<organization>/<advertiser>/<asset>/<safe name>`. */
  @Column({ type: 'varchar', length: 1024 })
  storageKey!: string;

  /** Soft-delete marker: a deleted asset is hidden but kept for history (D19). */
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
