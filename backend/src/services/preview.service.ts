import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';

import { previewConfig, PreviewConfig } from '@configs';
import {
  AdAccountEntity,
  AdGroupEntity,
  AdvertiserAdAccountEntity,
  CampaignEntity,
  CreativeEntity,
  KeywordEntity,
  LeverEntity,
  LineEntity,
  TargetingGroupEntity,
} from '@src/database/entities';
import {
  hasAdapter,
  PlatformProjection,
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

/** The whole tree of a campaign, read once. */
type Tree = {
  campaign: CampaignEntity;
  levers: LeverEntity[];
  adGroups: AdGroupEntity[];
  targetingGroups: TargetingGroupEntity[];
  lines: LineEntity[];
  creatives: Map<string, CreativeEntity>;
  keywordsByTargetingGroup: Map<string, number>;
  linksByPlatform: Map<string, AdvertiserAdAccountEntity>;
  accountsById: Map<string, AdAccountEntity>;
};

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
   * @param config - Preview configuration, which caps the split
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: AccessService,
    private readonly campaigns: CampaignService,
    private readonly config: PreviewConfig = previewConfig
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
    const tree: Tree = await this.readTree(organizationId, campaignId);

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
   * Launch a campaign, if the preview finds no error.
   *
   * The **only** way out of `draft`: the transition table does not carry it, so a campaign cannot be
   * launched by writing a field (`docs/phase-8.md` § 4).
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
    const preview: Preview = await this.preview(actor, organizationId, campaignId);
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
    await this.dataSource.manager.update(CampaignEntity, { id: campaignId }, { status: 'active' });
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
    await this.dataSource.manager.update(CampaignEntity, { id: campaign.id }, { status: body.status });
    return this.campaigns.get(actor, organizationId, campaignId);
  }

  /**
   * Read the whole tree of a campaign, one query per table.
   *
   * Every level denormalizes its campaign (phase 3), so nothing here walks the tree node by node:
   * five reads bring the nodes, and three more the creatives, the keyword counts and the accounts.
   *
   * @param organizationId - The Organization
   * @param campaignId - The campaign
   * @returns Its tree
   * @throws Error with status 404 coded `campaign_not_found`
   */
  private async readTree(organizationId: string, campaignId: string): Promise<Tree> {
    const manager: EntityManager = this.dataSource.manager;
    const campaign: CampaignEntity = await this.campaignOrFail(organizationId, campaignId);
    const alive = { campaignId, organizationId, deletedAt: IsNull() };

    const [levers, adGroups, targetingGroups, lines]: [
      LeverEntity[],
      AdGroupEntity[],
      TargetingGroupEntity[],
      LineEntity[],
    ] = await Promise.all([
      manager.find(LeverEntity, { where: alive }),
      manager.find(AdGroupEntity, { where: alive }),
      manager.find(TargetingGroupEntity, { where: alive }),
      manager.find(LineEntity, { where: alive }),
    ]);

    const creativeIds: string[] = [
      ...new Set(
        lines.map((line: LineEntity): string | null => line.creativeId).filter((id): id is string => id !== null)
      ),
    ];
    const creatives: CreativeEntity[] = creativeIds.length
      ? await manager.find(CreativeEntity, { where: { organizationId, id: In(creativeIds), deletedAt: IsNull() } })
      : [];

    // Only the column that says which node a keyword belongs to: counting happens here rather than in
    // SQL, so the read stays one query per table and the engine needs no query builder.
    const keywords: KeywordEntity[] = targetingGroups.length
      ? await manager.find(KeywordEntity, {
          where: {
            organizationId,
            targetingGroupId: In(targetingGroups.map((node: TargetingGroupEntity): string => node.id)),
            negative: false,
          },
          select: { targetingGroupId: true },
        })
      : [];
    const keywordsByTargetingGroup = new Map<string, number>();
    for (const keyword of keywords) {
      keywordsByTargetingGroup.set(
        keyword.targetingGroupId,
        (keywordsByTargetingGroup.get(keyword.targetingGroupId) ?? 0) + 1
      );
    }

    const links: AdvertiserAdAccountEntity[] = await manager.find(AdvertiserAdAccountEntity, {
      where: {
        organizationId,
        advertiserId: campaign.advertiserId,
        currency: campaign.currency,
        deletedAt: IsNull(),
      },
    });
    const accounts: AdAccountEntity[] = links.length
      ? await manager.find(AdAccountEntity, {
          where: { organizationId, id: In(links.map((link: AdvertiserAdAccountEntity): string => link.adAccountId)) },
          withDeleted: true,
        })
      : [];

    return {
      campaign,
      levers,
      adGroups,
      targetingGroups,
      lines,
      creatives: new Map(
        creatives.map((creative: CreativeEntity): [string, CreativeEntity] => [creative.id, creative])
      ),
      keywordsByTargetingGroup,
      linksByPlatform: new Map(
        links.map((link: AdvertiserAdAccountEntity): [string, AdvertiserAdAccountEntity] => [link.platform, link])
      ),
      accountsById: new Map(
        accounts.map((account: AdAccountEntity): [string, AdAccountEntity] => [account.id, account])
      ),
    };
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
  private checkStructure(tree: Tree, errors: PreviewFinding[], warnings: PreviewFinding[]): void {
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
      if (node.lever === 'search' && (tree.keywordsByTargetingGroup.get(node.id) ?? 0) === 0) {
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
    tree: Tree,
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
   * A node **below** the budget-holding level that carries an explicit budget becomes its own object
   * of that level (`../../CADRAGE.md` § 7): that is the split, and it is deduced here rather than
   * written per platform.
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
    tree: Tree,
    lever: LeverEntity,
    projection: PlatformProjection,
    platform: Platform,
    errors: PreviewFinding[],
    warnings: PreviewFinding[]
  ): Partial<Record<PlatformObject, number>> {
    const groups: AdGroupEntity[] = tree.adGroups.filter((group: AdGroupEntity): boolean => group.leverId === lever.id);
    const counts = new Map<PlatformObject, number>();
    const add = (object: PlatformObject | null, howMany: number): void => {
      if (object === null || howMany === 0) return;
      counts.set(object, (counts.get(object) ?? 0) + howMany);
    };

    add(projection.levels.campaign, 1);
    add(projection.levels.lever, 1);
    for (const group of groups) {
      const nodes: TargetingGroupEntity[] = tree.targetingGroups.filter(
        (node: TargetingGroupEntity): boolean => node.adGroupId === group.id
      );
      const lines: LineEntity[] = tree.lines.filter((line: LineEntity): boolean =>
        nodes.some((node: TargetingGroupEntity): boolean => node.id === line.targetingGroupId)
      );
      // The split: a TargetingGroup with a budget of its own needs an object of the budget level.
      const split: number =
        projection.budgetLevel === 'ad_group'
          ? nodes.filter((node: TargetingGroupEntity): boolean => node.budgetCents !== null).length
          : 0;
      const budgetObjects: number = 1 + split;

      add(projection.levels.ad_group, budgetObjects);
      add(projection.levels.targeting_group, nodes.length);
      add(projection.levels.line, lines.length);
      add(
        'keyword',
        nodes.reduce(
          (total: number, node: TargetingGroupEntity): number =>
            total + (tree.keywordsByTargetingGroup.get(node.id) ?? 0),
          0
        )
      );

      if (split > 0) {
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
    return Object.fromEntries(counts) as Partial<Record<PlatformObject, number>>;
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
    tree: Tree,
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
      if (rules.requiresClickThroughUrl && creative.clickThroughUrl === null) {
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
    tree: Tree,
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
   * Refuse a platform the brand cannot buy on: no account, an access that ended, no credentials.
   *
   * Three findings rather than one, because the three are fixed differently.
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
    if (account.secretName === null) {
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
 * Fastify plugin that decorates the instance with a {@link PreviewService}.
 *
 * Depends on `DatabasePlugin`, `AccessServicePlugin` and `CampaignServicePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function previewServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('previewService', new PreviewService(fastify.db, fastify.accessService, fastify.campaignService));
}

export default fastifyPlugin(previewServicePlugin, {
  name: 'PreviewServicePlugin',
  dependencies: ['DatabasePlugin', 'AccessServicePlugin', 'CampaignServicePlugin'],
});
