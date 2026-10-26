import { Column, Entity, Index } from 'typeorm';

import type { MessageParams } from '@src/types/error.types';
import type { Lever } from '@src/types/lever.types';
import type { Platform } from '@src/types/platform.types';
import type { SyncState } from '@src/types/sync.types';
import { numericTransformer } from '../transformers';
import { BaseEntity } from './base.entity';

/**
 * One AdGroup on one platform: what the engine makes exist over there, and how it keeps it in step.
 *
 * The grain is the couple **(AdGroup, platform)** — the grain multi-search proves, generalized. It is
 * what a platform treats as a whole (one root object, one budget, its children) and what a single
 * call of an adapter applies. The delivery unit of `../../CADRAGE.md` is the Line, and a Line's id
 * over there lives in {@link refs}: a unit per Line would either re-resolve its ancestors on every
 * sync — an API call, which breaks « nothing changed, no call » — or repeat their ids on every row.
 *
 * The partial index holds the units with something left to apply, a few among many: the sweep of D34
 * reads **only** them, so the periodic cost is proportional to the backlog and not to the size of the
 * database.
 */
@Entity({ name: 'platform_units' })
@Index(['adGroupId', 'platform'], { unique: true })
@Index(['nextAttemptAt'], { where: `"sync_state" IN ('pending', 'error')` })
export class PlatformUnitEntity extends BaseEntity {
  /** Organization owning it; an opaque uuid from omnipass. */
  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  /** Our campaign, denormalized so a sync reads its units in one query. */
  @Index()
  @Column({ type: 'uuid' })
  campaignId!: string;

  /** Our Lever. */
  @Column({ type: 'uuid' })
  leverId!: string;

  /** Our AdGroup. */
  @Column({ type: 'uuid' })
  adGroupId!: string;

  /** The lever its AdGroup buys on, denormalized: the registry is keyed by the couple with it. */
  @Column({ type: 'varchar', length: 16 })
  lever!: Lever;

  /** The platform. */
  @Column({ type: 'varchar', length: 32 })
  platform!: Platform;

  /** The account the brand buys on there. */
  @Index()
  @Column({ type: 'uuid' })
  adAccountId!: string;

  /**
   * Units of the account currency for one unit of the campaign currency, frozen when the platform
   * joined the campaign (1 in the same currency, D22). Budgets sent and costs read convert with it,
   * so a total never moves retroactively.
   */
  @Column({ type: 'numeric', precision: 18, scale: 8, default: 1, transformer: numericTransformer })
  fxRate!: number;

  /**
   * Id of each object the platform holds for us, by key: `<level>:<nodeId>` for an object of the
   * tree, `keyword:<id>` for a keyword.
   *
   * This map is what generalizes the `cards` and `keywords` of multi-search to the five levels, and
   * what makes an adapter idempotent: before creating anything it finds here what an interrupted sync
   * already created. The split of `../../CADRAGE.md` § 7 needs nothing more — several keys name
   * several objects of the same platform level.
   */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  refs!: Record<string, string>;

  /** Status last applied over there, `null` before the first successful sync. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  appliedStatus!: string | null;

  /** `pending` until the desired state is applied, `error` after a failed attempt. */
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  syncState!: SyncState;

  /** Fingerprint of the last desired state applied: equal means no call at all. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  syncedHash!: string | null;

  /** Why the last attempt failed, as it was worded. */
  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  /** Stable code of {@link lastError} when we worded it, for its translation. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  lastErrorCode!: string | null;

  /** Values of {@link lastError}, for its translation. */
  @Column({ type: 'jsonb', nullable: true })
  lastErrorParams!: MessageParams | null;

  /** Failed attempts in a row; the backoff doubles with it. */
  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  /**
   * When a failed sync may be tried again, `null` when there is nothing to wait for.
   *
   * A **definitive** failure leaves it `null`: trying again cannot help, so the unit waits for a
   * modification — which writes the dirty bit — or for an explicit retry (`docs/phase-9.md` § 5).
   */
  @Column({ type: 'timestamptz', nullable: true })
  nextAttemptAt!: Date | null;

  /** When the last attempt was made, whatever its outcome. */
  @Column({ type: 'timestamptz', nullable: true })
  lastAttemptAt!: Date | null;

  /** When it was last applied successfully. */
  @Column({ type: 'timestamptz', nullable: true })
  lastSyncedAt!: Date | null;
}
