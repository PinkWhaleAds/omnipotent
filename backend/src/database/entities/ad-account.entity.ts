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
 *
 * An account linked to **our** manager account (`linkRef` set) belongs to **one** Organization among
 * the living rows, whichever it is: our credentials reach every account so linked, so a second
 * Organization holding it would buy on a client's account that granted it nothing
 * (`docs/phase-10.md` § 4.5).
 */
@Entity({ name: 'ad_accounts' })
@Index(['organizationId', 'platform', 'externalId'], { unique: true, where: '"deleted_at" IS NULL' })
@Index(['platform', 'linkRef'], { unique: true, where: '"deleted_at" IS NULL AND "link_ref" IS NOT NULL' })
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

  /** What an interface shows; `null` until the platform gives it, for a linked account. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  name!: string | null;

  /**
   * ISO 4217 currency the account buys in.
   *
   * It **never changes**: the amounts already pushed are expressed in it, and an account in another
   * currency is another account. `null` while a linked account waits for its client: it is read at
   * the acceptance, never declared, since a currency guessed wrong would be paid in real money.
   */
  @Column({ type: 'varchar', length: 3, nullable: true })
  currency!: string | null;

  /** IANA timezone the platform counts its days in; the pacing reads it. `null` like the currency. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  timezone!: string | null;

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

  /**
   * The account as its client reads it in the platform's interface, for an account linked to our
   * manager account; `null` for one that brings its own secret, or was declared by hand. The link's
   * statuses are keyed by it, and it may differ from {@link AdAccountEntity.externalId} (the
   * Microsoft account number is not its id).
   */
  @Column({ type: 'varchar', length: 128, nullable: true })
  linkRef!: string | null;

  /** When the last invitation left, which an unanswered one expires from. */
  @Column({ type: 'timestamptz', nullable: true })
  linkRequestedAt!: Date | null;

  /** Soft-delete marker: a disconnected account is hidden but kept for history (D19). */
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
