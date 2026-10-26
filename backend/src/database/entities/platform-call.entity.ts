import { Column, Entity, Index } from 'typeorm';

import type { Platform } from '@src/types/platform.types';
import { BaseEntity } from './base.entity';

/**
 * One HTTP call to a platform: the journal a failed sync is debugged with, and the source of the
 * platform incidents and of the quota consumption later phases report
 * (`../../CADRAGE.md` § 14, « une ligne de journal par appel »).
 *
 * It keeps the **path, never the payload**: a request body carries targeting, creatives and
 * sometimes a token, and a journal is read by far more people than the secret store is.
 */
@Entity({ name: 'platform_calls' })
@Index(['createdAt'])
@Index(['platform', 'createdAt'])
export class PlatformCallEntity extends BaseEntity {
  /** The platform. */
  @Column({ type: 'varchar', length: 32 })
  platform!: Platform;

  /** The account the call used, `null` for a call that used none. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  adAccountId!: string | null;

  /** HTTP method. */
  @Column({ type: 'varchar', length: 8 })
  method!: string;

  /** Path, without the query string. */
  @Column({ type: 'varchar', length: 512 })
  path!: string;

  /** HTTP status, `null` when no response came back. */
  @Column({ type: 'integer', nullable: true })
  statusCode!: number | null;

  /** How long it took, in milliseconds. */
  @Column({ type: 'integer' })
  durationMs!: number;

  /** Request id the platform gave, for its own support. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  requestId!: string | null;

  /** What went wrong, when the call failed. */
  @Column({ type: 'text', nullable: true })
  error!: string | null;

  /**
   * What the call cost against the platform's quota: each operation of a batched mutation, 1 for any
   * other call. The quotas are the whole project's, not one client's (D45), so they are counted from
   * the first call.
   */
  @Column({ type: 'integer', default: 1 })
  operations!: number;
}
