import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource, EntityManager, IsNull } from 'typeorm';

import { previewConfig, PreviewConfig } from '@configs';
import {
  AdAccountEntity,
  AdGroupEntity,
  AdvertiserAdAccountEntity,
  CampaignEntity,
  CreativeEntity,
  LeverEntity,
  LineEntity,
  TargetingGroupEntity,
} from '@src/database/entities';
import {
  hasAdapter,
  PlatformProjection,
  PlatformRules,
  projectionOf,
  rulesOf,
  unsupportedDimensions,
} from '@src/platforms/platform-rules';
import {
  AuthContext,
  Campaign,
  CampaignStatus,
  Lever,
  Platform,
  PlatformObject,
  PlatformShare,
  PlatformPreview,
  Preview,
  PreviewFinding,
  SetCampaignStatusBody,
  TargetingDimension,
  TreeLevel,
} from '@src/types';
import { httpError } from '@utils';
import { AccessService } from './access.service';
import { CampaignService } from './campaign.service';
import { adapterOf, hasAdapterFor } from '@src/platforms/platform-adapter';
import { countByObject, ProjectedObject, projectObjects } from '@src/platforms/projection';
import { adGroupStructure, CampaignTree, leverStructure, readCampaignTree } from './campaign-tree.helpers';
import { nextLocalMidnight, resolveCampaignTimezone } from './pacing.helpers';
import { SyncScheduler, SyncService } from './sync.service';
import { markCampaignDirty } from './sync.helpers';
import { effectiveBudgetOf, resolvePlatformShares } from './tree.helpers';

/**
 * The transitions the lifecycle of a campaign allows (`docs/phase-8.md` § 4).
 *
 * `draft → active` is **absent on purpose**: a campaign is not launched by changing a field, it is
 * launched by passing the preview.
 */
const TRANSITIONS: Readonly<Record<CampaignStatus, readonly CampaignStatus[]>> = {
  draft: [],
  active: ['paused', 'ended'],
  paused: ['active', 'ended'],
  ended: ['archived'],
  archived: [],
};

/** How basis points divide: ten thousand of them make the whole. */
const SHARE_TOTAL = 10_000;

/**
 * Says what will be created on each platform, and what is wrong.
 *
 * The rigour of this API is **at publication, not at entry** (`../../CADRAGE.md` § 13): a draft saves
 * permissively, and this is what looks at the whole before anything is sent. So the preview is
 * read-only, callable at any time, and separates what **blocks** a launch from what will simply be
 * **delivered short** — each with a stable code, its values, and the node it concerns.
 *
 * The count of objects is **computed**, not asked of an adapter: the projection of
 * `../../CADRAGE.md` § 7 is a declaration of the platform registry, and the split — a TargetingGroup
 * carrying its own budget becoming its own platform campaign — follows from the level that holds the
 * budget. An adapter therefore implements nothing for the preview to work.
 */
export class PreviewService {
  /**
   * Create the service.
   *
   * @param dataSource - Application database
   * @param access - Permission checks
   * @param campaigns - Reading a campaign back in its API shape
   * @param sync - The engine, which the launch asks for the units of the campaign
   * @param scheduler - How a first synchronization is asked for
   * @param config - Preview configuration, which caps the split
   * @param now - Current time, injectable so a test owns the clock
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: AccessService,
    private readonly campaigns: CampaignService,
    private readonly sync: SyncService,
    private readonly scheduler: SyncScheduler,
    private readonly config: PreviewConfig = previewConfig,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Look at a campaign and say what would happen.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param campaignId - The campaign
   * @returns What each platform receives, and the findings
   * @throws Error with status 404 when the caller cannot see the campaign
   */
  public async preview(actor: AuthContext, organizationId: string, campaignId: string): Promise<Preview> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    return this.previewOf(await this.treeOf(organizationId, campaignId));
  }

  /**
   * Look at a tree already read, which is what the launch does.
   *
   * Separate from {@link preview} so a launch reads the tree **once**: it needs it for the findings
   * and again to create the units, and reading it twice would be two chances to disagree with itself.
   *
   * @param tree - The campaign's tree
   * @returns What each platform receives, and the findings
   */
  private async previewOf(tree: CampaignTree): Promise<Preview> {
    const errors: PreviewFinding[] = [];
    const warnings: PreviewFinding[] = [];
    this.checkStructure(tree, errors, warnings);
    const platforms: PlatformPreview[] = await this.projectPlatforms(tree, errors, warnings);

    return {
      campaignId: tree.campaign.id,
      status: tree.campaign.status,
      launchable: errors.length === 0,
      platforms,
      errors,
      warnings,
    };
  }

  /**
   * The whole tree of a campaign the caller can see.
   *
   * @param organizationId - The Organization
   * @param campaignId - The campaign
   * @returns Its tree
   * @throws Error with status 404 coded `campaign_not_found`
   */
  private async treeOf(organizationId: string, campaignId: string): Promise<CampaignTree> {
    return readCampaignTree(this.dataSource.manager, await this.campaignOrFail(organizationId, campaignId));
  }

  /**
   * Launch a campaign, if the preview finds no error.
   *
   * The **only** way out of `draft`: the transition table does not carry it, so a campaign cannot be
   * launched by writing a field (`docs/phase-8.md` § 4).
   *
   * What the launch **freezes**, in one transaction with the status:
   *
   * - the **timezone**: resolved from the Organization's snapshot if the campaign names none, and
   *   written on it. From then on the jobs read it without a caller, and a change of the
   *   Organization's timezone never retroactively moves the days of a campaign already delivering;
   * - the **units**, one per couple (AdGroup, platform), each `pending` so the first sync applies
   *   everything;
   * - the **pacing appointment**, at the campaign's own next local midnight (D34, D47).
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param campaignId - The campaign
   * @returns The campaign, now active
   * @throws Error with status 403 without the manager role, 404 when absent, 400 when it is not a
   *   draft or the preview found an error
   */
  public async launch(actor: AuthContext, organizationId: string, campaignId: string): Promise<Campaign> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    const tree: CampaignTree = await this.treeOf(organizationId, campaignId);
    const preview: Preview = await this.previewOf(tree);
    if (preview.status !== 'draft') {
      throw httpError(400, `A campaign is launched out of draft, not out of ${preview.status}`, {
        code: 'campaign_not_draft',
        params: { status: preview.status },
      });
    }
    if (!preview.launchable) {
      throw httpError(400, 'The preview of this campaign reports errors: fix them before launching', {
        code: 'campaign_preview_failed',
        params: { errors: preview.errors.length },
      });
    }
    const timezone: string = resolveCampaignTimezone(tree.campaign.timezone, actor, organizationId);
    await this.dataSource.transaction(async (manager: EntityManager): Promise<void> => {
      await manager.update(
        CampaignEntity,
        { id: campaignId },
        { status: 'active', timezone, nextPacingAt: nextLocalMidnight(this.now(), timezone) }
      );
      await this.sync.ensureUnits(manager, { ...tree, campaign: { ...tree.campaign, status: 'active', timezone } });
    });
    await this.scheduler.request(campaignId);
    return this.campaigns.get(actor, organizationId, campaignId);
  }

  /**
   * Apply a transition of the lifecycle.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param campaignId - The campaign
   * @param body - Where it goes
   * @returns The campaign in its new state
   * @throws Error with status 403 without the manager role, 404 when absent, 400 when the table does
   *   not name the passage
   */
  public async setStatus(
    actor: AuthContext,
    organizationId: string,
    campaignId: string,
    body: SetCampaignStatusBody
  ): Promise<Campaign> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    const campaign: CampaignEntity = await this.campaignOrFail(organizationId, campaignId);
    if (!TRANSITIONS[campaign.status].includes(body.status)) {
      throw httpError(400, `A campaign cannot go from ${campaign.status} to ${body.status}`, {
        code: 'campaign_transition_invalid',
        params: { from: campaign.status, to: body.status },
      });
    }
    await this.dataSource.transaction(async (manager: EntityManager): Promise<void> => {
      await manager.update(CampaignEntity, { id: campaign.id }, { status: body.status });
      // Pausing, ending or archiving is a change the platforms must hear about: everything over there
      // follows the campaign (`services/sync.helpers.ts`).
      await markCampaignDirty(manager, campaign.id);
    });
    await this.scheduler.request(campaignId);
    return this.campaigns.get(actor, organizationId, campaignId);
  }

  /**
   * What the model alone can tell: a level with no child, a Line with no creative, a paused node.
   *
   * None of it needs a platform, so none of it waits for an adapter — which is why a draft can be
   * fixed long before a connector exists.
   *
   * @param tree - The tree
   * @param errors - Collected errors
   * @param warnings - Collected warnings
   * @returns Nothing
   */
  private checkStructure(tree: CampaignTree, errors: PreviewFinding[], warnings: PreviewFinding[]): void {
    // What the user declared, not what we assumed (D53). The refusal is **not** per platform: no
    // platform of the scope accepts political advertising — Microsoft answers
    // `PoliticalCampaignsAreNotSupported`, Google and Hawk demand a block of sponsor declarations we
    // do not model — so a campaign that says yes cannot be launched anywhere. The day one accepts it,
    // the rule moves to `platform-rules.ts` and this check reads the registry instead.
    if (tree.campaign.containsPoliticalAdvertising) {
      errors.push(this.finding('preview_political_advertising_unsupported', {}, null, null));
    }
    if (tree.levers.length === 0) {
      errors.push(this.finding('preview_lever_missing', {}, null, null));
    }
    for (const lever of tree.levers) {
      if (!tree.adGroups.some((group: AdGroupEntity): boolean => group.leverId === lever.id)) {
        errors.push(this.finding('preview_ad_group_missing', { lever: lever.lever }, 'lever', lever.id));
      }
    }
    for (const group of tree.adGroups) {
      if (!tree.targetingGroups.some((node: TargetingGroupEntity): boolean => node.adGroupId === group.id)) {
        errors.push(this.finding('preview_targeting_group_missing', { name: group.name }, 'ad_group', group.id));
      }
    }
    for (const node of tree.targetingGroups) {
      const lines: LineEntity[] = tree.lines.filter((line: LineEntity): boolean => line.targetingGroupId === node.id);
      if (lines.length === 0) {
        errors.push(this.finding('preview_line_missing', { name: node.name }, 'targeting_group', node.id));
      }
      if (node.lever === 'search' && (tree.keywords.get(node.id) ?? []).length === 0) {
        errors.push(this.finding('preview_keywords_missing', { name: node.name }, 'targeting_group', node.id));
      }
    }
    for (const line of tree.lines) {
      if (line.creativeId === null) {
        errors.push(this.finding('preview_creative_missing', { name: line.name }, 'line', line.id));
        continue;
      }
      const creative: CreativeEntity | undefined = tree.creatives.get(line.creativeId);
      if (!creative) {
        errors.push(this.finding('preview_creative_missing', { name: line.name }, 'line', line.id));
      } else if (creative.activeVersionId === null) {
        errors.push(this.finding('preview_creative_version_missing', { creative: creative.name }, 'line', line.id));
      }
    }
    for (const [level, nodes] of [
      ['lever', tree.levers],
      ['ad_group', tree.adGroups],
      ['targeting_group', tree.targetingGroups],
      ['line', tree.lines],
    ] as [TreeLevel, { id: string; status: string }[]][]) {
      for (const node of nodes.filter((node: { status: string }): boolean => node.status === 'paused')) {
        warnings.push(this.finding('preview_node_paused', {}, level, node.id));
      }
    }
  }

  /**
   * What each platform of each lever receives, and what it will leave behind.
   *
   * @param tree - The tree
   * @param errors - Collected errors
   * @param warnings - Collected warnings
   * @returns One entry per couple, in the order of the levers
   */
  private async projectPlatforms(
    tree: CampaignTree,
    errors: PreviewFinding[],
    warnings: PreviewFinding[]
  ): Promise<PlatformPreview[]> {
    const previews: PlatformPreview[] = [];
    for (const lever of tree.levers) {
      const budgetCents: number = await effectiveBudgetOf(this.dataSource.manager, 'lever', lever.id);
      const shares: PlatformShare[] = await resolvePlatformShares(this.dataSource.manager, 'lever', lever);

      for (const { platform, shareBasisPoints } of shares) {
        const effectiveCents: number = Math.floor((budgetCents * shareBasisPoints) / SHARE_TOTAL);
        const link: AdvertiserAdAccountEntity | undefined = tree.linksByPlatform.get(platform);
        const account: AdAccountEntity | undefined = link ? tree.accountsById.get(link.adAccountId) : undefined;
        this.checkAccount(platform as Platform, tree.campaign.currency, account, errors);

        const projection: PlatformProjection | null = this.projectionOrFinding(
          platform as Platform,
          lever.lever,
          errors
        );
        previews.push({
          platform: platform as Platform,
          lever: lever.lever,
          adAccountId: account?.deletedAt === null ? account.id : null,
          accountCurrency: account?.deletedAt === null ? account.currency : null,
          // D22 freezes a rate at launch; no rate service exists yet, so the field says nothing.
          fxRate: null,
          effectiveCents,
          objects: projection ? this.countObjects(tree, lever, projection, platform as Platform, errors, warnings) : {},
        });
        if (projection) this.checkCreatives(tree, lever, platform as Platform, errors, warnings);
        if (projection) this.checkTargeting(tree, lever, platform as Platform, effectiveCents, warnings);
        if (projection) this.checkLimits(tree, lever, projection, platform as Platform, errors);
      }
    }
    return previews;
  }

  /**
   * Refuse to project a couple no adapter declares, and say so once per couple.
   *
   * Asked of the registry rather than caught from it: an exception is for something unexpected, and a
   * platform whose phase has not landed is expected (`docs/phase-8.md` § 7, point 3).
   *
   * @param platform - The platform
   * @param lever - The lever
   * @param errors - Collected errors
   * @returns Its projection, or `null` when it has no adapter
   */
  private projectionOrFinding(platform: Platform, lever: Lever, errors: PreviewFinding[]): PlatformProjection | null {
    if (!hasAdapter(platform, lever)) {
      errors.push(this.finding('preview_adapter_missing', { platform, lever }, null, null, platform));
      return null;
    }
    return projectionOf(platform, lever);
  }

  /**
   * Count what will be created on one platform, the split included.
   *
   * The counting is **deduced**, by the same pure projection the synchronization builds its desired
   * state from (`platforms/projection.ts`): what the preview promises and what the engine does cannot
   * drift apart, because there is one deduction and not two. In particular the split — a node below
   * the budget-holding level, carrying a budget of its own, becoming its own object of that level
   * (`../../CADRAGE.md` § 7) — is nowhere written per platform.
   *
   * @param tree - The tree
   * @param lever - The lever being projected
   * @param projection - What the platform makes of our levels
   * @param platform - The platform
   * @param errors - Collected errors
   * @param warnings - Collected warnings
   * @returns How many objects of each kind
   */
  private countObjects(
    tree: CampaignTree,
    lever: LeverEntity,
    projection: PlatformProjection,
    platform: Platform,
    errors: PreviewFinding[],
    warnings: PreviewFinding[]
  ): Partial<Record<PlatformObject, number>> {
    const counts: Partial<Record<PlatformObject, number>> = {};
    const add = (more: Partial<Record<PlatformObject, number>>): void => {
      for (const [object, howMany] of Object.entries(more) as [PlatformObject, number][]) {
        counts[object] = (counts[object] ?? 0) + howMany;
      }
    };

    // The campaign and its lever, which every AdGroup of that lever shares.
    add(countByObject(projectObjects(projection, leverStructure(tree, lever))));

    for (const group of tree.adGroups.filter((node: AdGroupEntity): boolean => node.leverId === lever.id)) {
      const branch: ProjectedObject[] = projectObjects(projection, adGroupStructure(tree, group));
      add(countByObject(branch));

      // One object of the budget level is shared with the AdGroup; each split adds one of its own.
      const splits: number = branch.filter((object: ProjectedObject): boolean => object.split).length;
      const budgetObjects: number = 1 + splits;
      if (splits > 0) {
        warnings.push(
          this.finding(
            'preview_campaign_split',
            { objects: budgetObjects, level: projection.budgetLevel },
            'ad_group',
            group.id,
            platform
          )
        );
      }
      if (budgetObjects > this.config.maxPlatformObjectsPerAdGroup) {
        errors.push(
          this.finding(
            'preview_platform_campaign_cap',
            { objects: budgetObjects, max: this.config.maxPlatformObjectsPerAdGroup },
            'ad_group',
            group.id,
            platform
          )
        );
      }
    }
    return counts;
  }

  /**
   * Refuse a creative no platform of the lever accepts, and warn about the ones that will drop it.
   *
   * A couple accepted by **none** of the lever's platforms fails the preview; accepted by some only,
   * it warns there (`../../CADRAGE.md` § 9).
   *
   * @param tree - The tree
   * @param lever - The lever being projected
   * @param platform - The platform
   * @param errors - Collected errors
   * @param warnings - Collected warnings
   * @returns Nothing
   */
  private checkCreatives(
    tree: CampaignTree,
    lever: LeverEntity,
    platform: Platform,
    errors: PreviewFinding[],
    warnings: PreviewFinding[]
  ): void {
    const rules: { creatives: readonly string[]; requiresClickThroughUrl: boolean; requiresIabCategories: boolean } =
      rulesOf(platform, lever.lever);
    for (const line of tree.lines) {
      const creative: CreativeEntity | undefined = line.creativeId ? tree.creatives.get(line.creativeId) : undefined;
      if (!creative) continue;
      if (!rules.creatives.includes(`${creative.format}:${creative.subtype}`)) {
        warnings.push(
          this.finding(
            'preview_creative_dropped',
            { format: creative.format, subtype: creative.subtype },
            'line',
            line.id,
            platform
          )
        );
        continue;
      }
      // A Line's own page overrides its creative's (L18): either one gives the click somewhere to go.
      if (rules.requiresClickThroughUrl && (line.landingPageUrl ?? creative.clickThroughUrl) === null) {
        errors.push(this.finding('preview_click_url_missing', { creative: creative.name }, 'line', line.id, platform));
      }
      if (rules.requiresIabCategories && creative.iabCategories.length === 0) {
        errors.push(
          this.finding('preview_iab_categories_missing', { creative: creative.name }, 'line', line.id, platform)
        );
      }
    }
  }

  /**
   * Name the targeting a platform will not apply, **and the money that will deliver without it**.
   *
   * This is the trap of § 8 of `../../CADRAGE.md`, and it is silent otherwise: the share bought on a
   * platform that cannot express a restriction delivers anyway, which is the opposite of what was
   * asked for.
   *
   * @param tree - The tree
   * @param lever - The lever being projected
   * @param platform - The platform
   * @param effectiveCents - What that platform receives
   * @param warnings - Collected warnings
   * @returns Nothing
   */
  private checkTargeting(
    tree: CampaignTree,
    lever: LeverEntity,
    platform: Platform,
    effectiveCents: number,
    warnings: PreviewFinding[]
  ): void {
    for (const node of tree.targetingGroups.filter(
      (node: TargetingGroupEntity): boolean => node.lever === lever.lever
    )) {
      const asked: TargetingDimension[] = Object.keys(node.targeting) as TargetingDimension[];
      if (asked.length === 0) continue;
      for (const dimension of unsupportedDimensions(platform, lever.lever, asked)) {
        warnings.push(
          this.finding(
            'preview_targeting_dropped',
            { dimension, cents: effectiveCents },
            'targeting_group',
            node.id,
            platform
          )
        );
      }
    }
  }

  /**
   * Refuse what a couple cannot hold, in the AdGroups that buy on it: a bid strategy it does not bid
   * with, more active ads than one of its objects holds, and a targeting it can only set above the
   * nodes that ask for it differently (`docs/phase-10.md` § 8.3).
   *
   * An AdGroup whose own distribution key leaves the platform out sends nothing there, so it is not
   * asked.
   *
   * @param tree - The tree
   * @param lever - The lever being projected
   * @param projection - What the platform makes of our levels
   * @param platform - The platform
   * @param errors - Collected errors
   * @returns Nothing
   */
  private checkLimits(
    tree: CampaignTree,
    lever: LeverEntity,
    projection: PlatformProjection,
    platform: Platform,
    errors: PreviewFinding[]
  ): void {
    const rules: PlatformRules = rulesOf(platform, lever.lever);
    for (const group of tree.adGroups.filter((node: AdGroupEntity): boolean => node.leverId === lever.id)) {
      const shares: PlatformShare[] = group.platformShares?.length ? group.platformShares : lever.platformShares;
      if (!shares.some((share: PlatformShare): boolean => share.platform === platform)) continue;
      if (!rules.bidStrategies.includes(group.bidStrategy)) {
        errors.push(
          this.finding(
            'preview_bid_strategy_unsupported',
            { platform, strategy: group.bidStrategy },
            'ad_group',
            group.id,
            platform
          )
        );
      }
      const branch: ProjectedObject[] = projectObjects(projection, adGroupStructure(tree, group));
      this.checkActiveAds(tree, branch, rules, platform, errors);
      this.checkSharedTargeting(tree, branch, rules, platform, errors);
    }
  }

  /**
   * Refuse more active ads under one object than the platform serves there.
   *
   * An ad is a Line, and it counts while its **own** status is active: a paused one is paused over
   * there too, and the adapter pauses it before it enables another, so the limit is never crossed
   * even for an instant (`docs/phase-10.md` § 8.4, point 8).
   *
   * @param tree - The tree
   * @param branch - What one AdGroup becomes there
   * @param rules - The couple's rules
   * @param platform - The platform
   * @param errors - Collected errors
   * @returns Nothing
   */
  private checkActiveAds(
    tree: CampaignTree,
    branch: readonly ProjectedObject[],
    rules: PlatformRules,
    platform: Platform,
    errors: PreviewFinding[]
  ): void {
    if (rules.maxActiveAds === null) return;
    const active = new Map<string, number>();
    for (const object of branch) {
      if (object.level !== 'line' || object.split || object.parentKey === null) continue;
      const line: LineEntity | undefined = tree.lines.find((node: LineEntity): boolean => node.id === object.nodeId);
      if (line?.status !== 'active') continue;
      active.set(object.parentKey, (active.get(object.parentKey) ?? 0) + 1);
    }
    for (const [key, count] of active) {
      if (count <= rules.maxActiveAds) continue;
      // Every key of the map is the parent of an object of this very branch, so the lookup is total.
      const holder: ProjectedObject = branch.find(
        (object: ProjectedObject): boolean => object.key === key
      ) as ProjectedObject;
      errors.push(
        this.finding('preview_too_many_ads', { count, max: rules.maxActiveAds }, holder.level, holder.nodeId, platform)
      );
    }
  }

  /**
   * Refuse a targeting the platform sets above the nodes that ask for it differently.
   *
   * Google Search sets its places and circles on the **campaign**, never on an ad group, and an
   * AdGroup becomes one campaign there with one ad group per TargetingGroup. Two TargetingGroups of
   * one AdGroup aiming at two different cities cannot both be honoured, and sending their union would
   * deliver wider than either asked — the trap of § 8 of `../../CADRAGE.md`. A TargetingGroup with a
   * budget of its own is split into its own campaign, so it asks alone.
   *
   * @param tree - The tree
   * @param branch - What one AdGroup becomes there
   * @param rules - The couple's rules
   * @param platform - The platform
   * @param errors - Collected errors
   * @returns Nothing
   */
  private checkSharedTargeting(
    tree: CampaignTree,
    branch: readonly ProjectedObject[],
    rules: PlatformRules,
    platform: Platform,
    errors: PreviewFinding[]
  ): void {
    if (rules.sharedTargeting.length === 0) return;
    const byKey = new Map<string, ProjectedObject>(branch.map((object: ProjectedObject) => [object.key, object]));
    const holderOf = (object: ProjectedObject): ProjectedObject => {
      let holder: ProjectedObject = object;
      while (holder.level !== rules.projection.budgetLevel && holder.parentKey !== null) {
        holder = byKey.get(holder.parentKey) as ProjectedObject;
      }
      return holder;
    };

    const sharing = new Map<string, { holder: ProjectedObject; nodes: TargetingGroupEntity[] }>();
    for (const object of branch) {
      if (object.level !== 'targeting_group' || object.split || object.keywordId !== null) continue;
      const node: TargetingGroupEntity = tree.targetingGroups.find(
        (candidate: TargetingGroupEntity): boolean => candidate.id === object.nodeId
      ) as TargetingGroupEntity;
      const holder: ProjectedObject = holderOf(object);
      const entry = sharing.get(holder.key) ?? { holder, nodes: [] };
      entry.nodes.push(node);
      sharing.set(holder.key, entry);
    }
    for (const { holder, nodes } of sharing.values()) {
      for (const dimension of rules.sharedTargeting) {
        const asked = new Set<string>(
          nodes.map((node: TargetingGroupEntity): string =>
            canonical((node.targeting as Record<string, unknown>)[dimension] ?? null)
          )
        );
        if (asked.size > 1) {
          errors.push(
            this.finding('preview_targeting_not_shared', { dimension }, holder.level, holder.nodeId, platform)
          );
        }
      }
    }
  }

  /**
   * Refuse a platform the brand cannot buy on: no account, an access that ended, no credentials.
   *
   * Three findings rather than one, because the three are fixed differently. A platform whose
   * credentials are ours asks no secret of the account.
   *
   * @param platform - The platform
   * @param currency - The currency of the campaign
   * @param account - The account the link named, if any
   * @param errors - Collected errors
   * @returns Nothing
   */
  private checkAccount(
    platform: Platform,
    currency: string,
    account: AdAccountEntity | undefined,
    errors: PreviewFinding[]
  ): void {
    if (!account || account.deletedAt !== null) {
      errors.push(this.finding('preview_account_missing', { platform, currency }, null, null, platform));
      return;
    }
    if (account.status !== 'active') {
      errors.push(
        this.finding(
          'preview_account_unusable',
          { platform, status: account.status, statusReason: account.statusReason },
          null,
          null,
          platform
        )
      );
    }
    // On a platform whose credentials are ours, no account carries a secret (`docs/phase-10.md` § 4.1).
    const ours: boolean = hasAdapterFor(platform) && adapterOf(platform).connection === 'manager_link';
    if (account.secretName === null && !ours) {
      errors.push(this.finding('preview_account_credentials_missing', { platform }, null, null, platform));
    }
  }

  /**
   * Load a campaign of an Organization.
   *
   * @param organizationId - The Organization it must belong to
   * @param id - The campaign
   * @returns The row
   * @throws Error with status 404 coded `campaign_not_found`
   */
  private async campaignOrFail(organizationId: string, id: string): Promise<CampaignEntity> {
    const campaign: CampaignEntity | null = await this.dataSource.manager.findOne(CampaignEntity, {
      where: { id, organizationId, deletedAt: IsNull() },
    });
    if (!campaign) throw httpError(404, 'Campaign not found', { code: 'campaign_not_found' });
    return campaign;
  }

  /**
   * Build one finding.
   *
   * @param code - Its stable code
   * @param params - The values of its message
   * @param level - The level of the node at fault, `null` for the campaign itself
   * @param nodeId - That node
   * @param platform - The platform it concerns, when it concerns one
   * @returns The finding
   */
  private finding(
    code: string,
    params: Record<string, string | number | boolean | null>,
    level: TreeLevel | null,
    nodeId: string | null,
    platform: Platform | null = null
  ): PreviewFinding {
    return { code, params, level, nodeId, platform };
  }
}

/**
 * A value written so that two equal values read the same, whatever the order of their keys and of
 * their lists: the targeting of two nodes is compared on it.
 *
 * @param value - Any JSON value
 * @returns Its canonical text
 *
 * @example
 * ```typescript
 * canonical({ include: ['FR', 'BE'] }) === canonical({ include: ['BE', 'FR'] }); // true
 * ```
 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries: string[] = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key: string): string => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Fastify plugin that decorates the instance with a {@link PreviewService}.
 *
 * Depends on `DatabasePlugin`, `AccessServicePlugin`, `CampaignServicePlugin` and
 * `SyncServicePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function previewServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate(
    'previewService',
    new PreviewService(
      fastify.db,
      fastify.accessService,
      fastify.campaignService,
      fastify.syncService,
      fastify.syncScheduler
    )
  );
}

export default fastifyPlugin(previewServicePlugin, {
  name: 'PreviewServicePlugin',
  dependencies: ['DatabasePlugin', 'AccessServicePlugin', 'CampaignServicePlugin', 'SyncServicePlugin'],
});
