import { Column, Entity, Index } from 'typeorm';

import type { MessageParams } from '@src/types/error.types';
import type { Platform } from '@src/types/platform.types';
import type { TrackingRefStatus } from '@src/types/conversion.types';
import { BaseEntity } from './base.entity';

/**
 * The tracking code of an Advertiser on one ad account: the tag its script loads for that account, and
 * where it stands (`docs/phase-10.md` § 8.10). Google: `{ tagId: 'AW-…' }`.
 */
@Entity({ name: 'advertiser_trackings' })
@Index(['advertiserId', 'adAccountId'], { unique: true })
export class AdvertiserTrackingEntity extends BaseEntity {
  /** The Advertiser. */
  @Column({ type: 'uuid' })
  advertiserId!: string;

  /** The ad account. */
  @Index()
  @Column({ type: 'uuid' })
  adAccountId!: string;

  /** Its platform. */
  @Column({ type: 'varchar', length: 32 })
  platform!: Platform;

  /** Where it stands there. */
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: TrackingRefStatus;

  /** Its ids at the platform, as the adapter returned them. */
  @Column({ type: 'jsonb', default: '{}' })
  refs!: Record<string, string | null>;

  /** Why it is not ready, or what to do, in English. */
  @Column({ type: 'text', nullable: true })
  message!: string | null;

  /** Stable code of {@link message} when we worded it, for its translation. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  messageCode!: string | null;

  /** Values of {@link message}, for its translation. */
  @Column({ type: 'jsonb', nullable: true })
  messageParams!: MessageParams | null;
}
