import { Column, DeleteDateColumn, Entity, Index } from 'typeorm';

import type { AdAccountScope, AdAccountStatus, AdAccountStatusReason } from '@src/types/ad-account.types';
import type { Platform } from '@src/types/platform.types';
import { BaseEntity } from './base.entity';

/**
 * The scope that carries the credentials of a platform, at the **Organization** level
 * (`../../CADRAGE.md` § 12).
 *
 * The model of multi-search generalized to the DSPs, and **not** the `DspConnection` of MBP:
 * credentials in a jsonb column forbid a clean rotation and a clean audit, and its uniqueness per
 * `(organisation, DSP)` stops an Organization from using several accounts of one platform — several
 * advertisers, several currencies. MBP had to add that index in a hurry after a second connection
 * silently captured a platform's whole traffic.
 *
 * **Postgres only ever keeps the name of the secret.** Its value lives in AWS Secrets Manager, and
 * nothing reads it back: the API answers `hasCredentials`, a boolean (`docs/phase-7.md` § 2).
 */
@Entity({ name: 'ad_accounts' })
@Index(['organizationId', 'platform', 'externalId'], { unique: true, where: '"deleted_at" IS NULL' })
export class AdAccountEntity extends BaseEntity {
  /** Organization owning it; an opaque uuid from omnipass. */
  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  /** The platform it lives on. */
  @Column({ type: 'varchar', length: 32 })
  platform!: Platform;

  /** Its identifier there: a customer id, a partner id, an advertiser id. */
  @Column({ type: 'varchar', length: 128 })
  externalId!: string;

  /** What an interface shows. */
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /**
   * ISO 4217 currency the account buys in.
   *
   * It **never changes**: the amounts already pushed are expressed in it, and an account in another
   * currency is another account.
   */
  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  /** IANA timezone the platform counts its days in; the pacing reads it. */
  @Column({ type: 'varchar', length: 64 })
  timezone!: string;

  /** Where the access stands. */
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: AdAccountStatus;

  /** Why, when it is not `active`; a stable code the front translates. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  statusReason!: AdAccountStatusReason | null;

  /** What the platform requires above the account: a DV360 partner, an Amazon profile. */
  @Column({ type: 'jsonb', default: '{}' })
  scope!: AdAccountScope;

  /** The **name** of the Secrets Manager entry, never its value; `null` until a secret is posted. */
  @Column({ type: 'varchar', length: 512, nullable: true })
  secretName!: string | null;

  /** Soft-delete marker: a disconnected account is hidden but kept for history (D19). */
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
