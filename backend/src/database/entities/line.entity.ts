import { Column, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import type { Tracker } from '@src/types/creative.types';
import type { Capping, Lever, VolumeUnit } from '@src/types/lever.types';
import type { NodeStatus } from '@src/types/tree.types';
import { centsTransformer } from '../transformers';
import { BaseEntity } from './base.entity';
import { CampaignEntity } from './campaign.entity';
import { CreativeEntity } from './creative.entity';
import { TargetingGroupEntity } from './targeting-group.entity';

/**
 * The leaf: what a TargetingGroup delivers — an RSA ad on Google, a chat card on OpenAI, a creative
 * on DV360, a Line on Hawk (`../../CADRAGE.md` § 7).
 *
 * It will link a TargetingGroup to a **Creative**, which the phase of the creatives adds along with
 * the uniqueness of the couple; what is here is the node, its money and its landing page.
 *
 * Its budget is `forbidden` on the `search` lever (D12): with no budget of their own, the N Lines of
 * a TargetingGroup become N RSA ads in a single Google ad group, which keeps Google's ad rotation.
 */
@Entity({ name: 'lines' })
@Index(['targetingGroupId', 'creativeId'], {
  unique: true,
  where: '"deleted_at" IS NULL AND "creative_id" IS NOT NULL',
})
export class LineEntity extends BaseEntity {
  /** Organization owning it, denormalized so every read is scoped. */
  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  /** Campaign it belongs to, denormalized. */
  @Index()
  @Column({ type: 'uuid' })
  campaignId!: string;

  /** TargetingGroup it belongs to. */
  @Index()
  @Column({ type: 'uuid' })
  targetingGroupId!: string;

  /**
   * Channel of its lever, denormalized.
   *
   * Every write consults the lever profile and every budget read asks it whether this level carries
   * a budget: without the channel on the row, each of those would walk up the tree to find it. A
   * node never changes lever — that would be a restructuring — so the value cannot drift.
   */
  @Column({ type: 'varchar', length: 16 })
  lever!: Lever;

  /** Relation to the TargetingGroup; never loaded implicitly. */
  @ManyToOne(() => TargetingGroupEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'targeting_group_id' })
  targetingGroup?: TargetingGroupEntity;

  /** Relation to the Campaign; never loaded implicitly. */
  @ManyToOne(() => CampaignEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'campaign_id' })
  campaign?: CampaignEntity;

  /** Name of the Line. */
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /** Whether it delivers. */
  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: NodeStatus;

  /**
   * The creative it serves.
   *
   * **Unique per `(TargetingGroup, Creative)`** among the living Lines (`../../CADRAGE.md` § 9): the
   * same creative does not deliver twice on the same targeting. It stays nullable — a Line without a
   * creative saves (§ 13: the incomplete is stored), and the preview refuses it at launch.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  creativeId!: string | null;

  /** Relation to the creative; never loaded implicitly. `RESTRICT`, since deleting is soft (D19). */
  @ManyToOne(() => CreativeEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'creative_id' })
  creative?: CreativeEntity;

  /**
   * Third-party trackers overriding those of the creative version (L18).
   *
   * `null` follows the version; `[]` says explicitly « none », the same distinction the capping makes
   * (D10). Each adapter puts them where its platform expects them.
   */
  @Column({ type: 'jsonb', nullable: true })
  trackers!: Tracker[] | null;

  /**
   * Landing page of this Line, overriding the creative's (L18).
   *
   * It is the agency's daily need — same creative, different page depending on the targeting — and
   * Hawk demands it on the Line itself rather than on the creative.
   */
  @Column({ type: 'varchar', length: 2048, nullable: true })
  landingPageUrl!: string | null;

  /** Budget in integer cents, `null` to inherit its share by division; forbidden on `search`. */
  @Column({ type: 'bigint', nullable: true, transformer: centsTransformer })
  budgetCents!: number | null;

  /** The volume entry that produced the amount, when the user entered one (L25). */
  @Column({ type: 'bigint', nullable: true, transformer: centsTransformer })
  budgetVolume!: number | null;

  /** Unit of that entry. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  budgetVolumeUnit!: VolumeUnit | null;

  /** First day of delivery, `null` to follow its parent's window. */
  @Column({ type: 'date', nullable: true })
  startsOn!: string | null;

  /** Last day of delivery, `null` to follow its parent's window. */
  @Column({ type: 'date', nullable: true })
  endsOn!: string | null;

  /** The stack of caps: `null` inherits its parent's, `[]` is explicitly none (L5, D10). */
  @Column({ type: 'jsonb', nullable: true })
  capping!: Capping | null;

  /** Soft-delete marker. */
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
