/**
 * @module services/campaign-tree.helpers
 *
 * Reading **the whole tree of one campaign at once**, which is what the preview and the
 * synchronization both start from.
 *
 * Shared rather than written twice: if the two read differently, they can disagree about what will be
 * created on a platform — and the preview exists precisely to promise what the synchronization will
 * do. It is also where the cost of a sync is decided: every level denormalizes its campaign
 * (`docs/phase-3.md`), so nothing walks the tree node by node — one query per table, and that is all.
 */
import { EntityManager, In, IsNull } from 'typeorm';

import {
  AdAccountEntity,
  AdGroupEntity,
  AdvertiserAdAccountEntity,
  CampaignEntity,
  CreativeEntity,
  CreativeVersionEntity,
  KeywordEntity,
  LeverEntity,
  LineEntity,
  TargetingGroupEntity,
} from '@src/database/entities';
import { ProjectionNode } from '@src/platforms/projection';

/**
 * The whole tree of a campaign, read once.
 *
 * @property campaign - The campaign itself
 * @property levers - Its levers
 * @property adGroups - Its AdGroups
 * @property targetingGroups - Its TargetingGroups
 * @property lines - Its Lines
 * @property creatives - The creatives its Lines deliver, by id
 * @property versions - The **delivering** version of each of those creatives, by creative id
 * @property keywords - Its positive keywords, by TargetingGroup
 * @property negativeKeywords - Its negative keywords, by TargetingGroup
 * @property linksByPlatform - Which account the brand buys on, per platform, in this currency
 * @property accountsById - Those accounts, deleted ones included so a broken link can be named
 */
export type CampaignTree = {
  campaign: CampaignEntity;
  levers: LeverEntity[];
  adGroups: AdGroupEntity[];
  targetingGroups: TargetingGroupEntity[];
  lines: LineEntity[];
  creatives: Map<string, CreativeEntity>;
  versions: Map<string, CreativeVersionEntity>;
  keywords: Map<string, KeywordEntity[]>;
  negativeKeywords: Map<string, KeywordEntity[]>;
  linksByPlatform: Map<string, AdvertiserAdAccountEntity>;
  accountsById: Map<string, AdAccountEntity>;
};

/**
 * Group rows by the node they hang from.
 *
 * @typeParam T - The row
 * @param rows - The rows
 * @param keyOf - Which node a row hangs from
 * @returns The rows by node id
 */
function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key: string = keyOf(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return grouped;
}

/**
 * Read everything a campaign is made of.
 *
 * @param manager - Where to read
 * @param campaign - The campaign, already found
 * @returns Its tree
 *
 * @example
 * ```typescript
 * const tree: CampaignTree = await readCampaignTree(manager, campaign);
 * ```
 */
export async function readCampaignTree(manager: EntityManager, campaign: CampaignEntity): Promise<CampaignTree> {
  const organizationId: string = campaign.organizationId;
  const alive = { campaignId: campaign.id, organizationId, deletedAt: IsNull() };

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
  const versionIds: string[] = creatives
    .map((creative: CreativeEntity): string | null => creative.activeVersionId)
    .filter((id): id is string => id !== null);
  const versions: CreativeVersionEntity[] = versionIds.length
    ? await manager.find(CreativeVersionEntity, { where: { organizationId, id: In(versionIds) } })
    : [];

  const keywords: KeywordEntity[] = targetingGroups.length
    ? await manager.find(KeywordEntity, {
        where: {
          organizationId,
          targetingGroupId: In(targetingGroups.map((node: TargetingGroupEntity): string => node.id)),
        },
      })
    : [];

  const links: AdvertiserAdAccountEntity[] = await manager.find(AdvertiserAdAccountEntity, {
    where: { organizationId, advertiserId: campaign.advertiserId, currency: campaign.currency, deletedAt: IsNull() },
  });
  const accounts: AdAccountEntity[] = links.length
    ? await manager.find(AdAccountEntity, {
        where: { organizationId, id: In(links.map((link: AdvertiserAdAccountEntity): string => link.adAccountId)) },
        withDeleted: true,
      })
    : [];

  const byId = new Map<string, CreativeVersionEntity>(
    versions.map((version: CreativeVersionEntity): [string, CreativeVersionEntity] => [version.id, version])
  );
  return {
    campaign,
    levers,
    adGroups,
    targetingGroups,
    lines,
    creatives: new Map(creatives.map((creative: CreativeEntity): [string, CreativeEntity] => [creative.id, creative])),
    versions: new Map(
      creatives
        .filter((creative: CreativeEntity): boolean => byId.has(creative.activeVersionId ?? ''))
        .map((creative: CreativeEntity): [string, CreativeVersionEntity] => [
          creative.id,
          byId.get(creative.activeVersionId as string) as CreativeVersionEntity,
        ])
    ),
    keywords: groupBy(
      keywords.filter((keyword: KeywordEntity): boolean => !keyword.negative),
      (keyword: KeywordEntity): string => keyword.targetingGroupId
    ),
    negativeKeywords: groupBy(
      keywords.filter((keyword: KeywordEntity): boolean => keyword.negative),
      (keyword: KeywordEntity): string => keyword.targetingGroupId
    ),
    linksByPlatform: new Map(
      links.map((link: AdvertiserAdAccountEntity): [string, AdvertiserAdAccountEntity] => [link.platform, link])
    ),
    accountsById: new Map(accounts.map((account: AdAccountEntity): [string, AdAccountEntity] => [account.id, account])),
  };
}

/**
 * The AdGroups of one lever.
 *
 * @param tree - The tree
 * @param leverId - The lever
 * @returns Its AdGroups
 */
export function adGroupsOf(tree: CampaignTree, leverId: string): AdGroupEntity[] {
  return tree.adGroups.filter((node: AdGroupEntity): boolean => node.leverId === leverId);
}

/**
 * The TargetingGroups of one AdGroup.
 *
 * @param tree - The tree
 * @param adGroupId - The AdGroup
 * @returns Its TargetingGroups
 */
export function targetingGroupsOf(tree: CampaignTree, adGroupId: string): TargetingGroupEntity[] {
  return tree.targetingGroups.filter((node: TargetingGroupEntity): boolean => node.adGroupId === adGroupId);
}

/**
 * The Lines of one TargetingGroup.
 *
 * @param tree - The tree
 * @param targetingGroupId - The TargetingGroup
 * @returns Its Lines
 */
export function linesOf(tree: CampaignTree, targetingGroupId: string): LineEntity[] {
  return tree.lines.filter((line: LineEntity): boolean => line.targetingGroupId === targetingGroupId);
}

/**
 * The campaign and one of its levers, as the projection reads them — without the AdGroups.
 *
 * The objects these two levels become are **shared** by every AdGroup of the lever, so they are
 * projected once and counted once.
 *
 * @param tree - The tree
 * @param lever - The lever
 * @returns The skeleton of that lever
 */
export function leverStructure(tree: CampaignTree, lever: LeverEntity): ProjectionNode {
  return {
    level: 'campaign',
    id: tree.campaign.id,
    budgetCents: tree.campaign.budgetCents,
    children: [{ level: 'lever', id: lever.id, budgetCents: lever.budgetCents, children: [] }],
  };
}

/**
 * One AdGroup and everything under it, as the projection reads it.
 *
 * @param tree - The tree
 * @param adGroup - The AdGroup
 * @returns Its branch
 */
export function adGroupStructure(tree: CampaignTree, adGroup: AdGroupEntity): ProjectionNode {
  return {
    level: 'ad_group',
    id: adGroup.id,
    budgetCents: adGroup.budgetCents,
    children: targetingGroupsOf(tree, adGroup.id).map((node: TargetingGroupEntity): ProjectionNode => ({
      level: 'targeting_group',
      id: node.id,
      budgetCents: node.budgetCents,
      keywordIds: (tree.keywords.get(node.id) ?? []).map((keyword: KeywordEntity): string => keyword.id),
      children: linesOf(tree, node.id).map((line: LineEntity): ProjectionNode => ({
        level: 'line',
        id: line.id,
        budgetCents: line.budgetCents,
        children: [],
      })),
    })),
  };
}

/**
 * The whole branch of one unit: our campaign, its lever, and one AdGroup with everything under it.
 *
 * What the **synchronization** projects, where the preview projects the skeleton and each AdGroup
 * apart to count the shared objects once. A unit has to see the campaign and the lever, because the
 * objects those two become over there — a mediaplan, say — are its own ancestors there.
 *
 * @param tree - The tree
 * @param lever - The lever of the AdGroup
 * @param adGroup - The AdGroup
 * @returns The branch, from the campaign down
 */
export function branchStructure(tree: CampaignTree, lever: LeverEntity, adGroup: AdGroupEntity): ProjectionNode {
  return {
    level: 'campaign',
    id: tree.campaign.id,
    budgetCents: tree.campaign.budgetCents,
    children: [
      {
        level: 'lever',
        id: lever.id,
        budgetCents: lever.budgetCents,
        children: [adGroupStructure(tree, adGroup)],
      },
    ],
  };
}
