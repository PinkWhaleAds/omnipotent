import { Column, Entity, Index } from 'typeorm';

import type { MessageParams } from '@src/types/error.types';
import type { Platform } from '@src/types/platform.types';
import type { TrackingRefStatus } from '@src/types/conversion.types';
import { BaseEntity } from './base.entity';

/**
 * One conversion goal on one ad account: where it stands there, and the ids of what represents it
 * (`docs/phase-10.md` § 8.10). Google: `{ conversionAction, sendTo, customGoal }`.
 */
@Entity({ name: 'conversion_goal_refs' })
@Index(['goalId', 'adAccountId'], { unique: true })
export class ConversionGoalRefEntity extends BaseEntity {
  /** The goal. */
  @Column({ type: 'uuid' })
  goalId!: string;

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

  /** Whether a campaign can bid on it there. */
  @Column({ type: 'boolean', default: false })
  biddable!: boolean;

  /** Why it is not ready, or what to do, in English. */
  @Column({ type: 'text', nullable: true })
  message!: string | null;

  /** Stable code of {@link message} when we worded it, for its translation. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  messageCode!: string | null;

  /** Values of {@link message}, for its translation. */
  @Column({ type: 'jsonb', nullable: true })
  messageParams!: MessageParams | null;

  /** Fingerprint of the goal and the tracking last set up: an unchanged goal, once settled, is left alone. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  syncedHash!: string | null;
}
