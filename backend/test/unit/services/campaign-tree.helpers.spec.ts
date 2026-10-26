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
import {
  adGroupsOf,
  adGroupStructure,
  branchStructure,
  CampaignTree,
  leverStructure,
  linesOf,
  readCampaignTree,
  targetingGroupsOf,
} from '@src/services/campaign-tree.helpers';
import { IDS } from '@test/unit/mocks/auth.fixtures';
import { createTreeStore, TreeStore } from '@test/unit/mocks/tree-store.mock';

/** The ids the specs work with. */
const CAMPAIGN_ID = 'f1000000-0000-4000-8000-000000000001';
const LEVER_ID = 'f2000000-0000-4000-8000-000000000001';
const AD_GROUP_ID = 'f3000000-0000-4000-8000-000000000001';
const NODE_ID = 'f4000000-0000-4000-8000-000000000001';
const LINE_ID = 'f5000000-0000-4000-8000-000000000001';
const CREATIVE_ID = 'fe000000-0000-4000-8000-000000000001';
const VERSION_ID = 'fd000000-0000-4000-8000-000000000001';
const ACCOUNT_ID = 'ff000000-0000-4000-8000-000000000001';

describe('Unit::Services::CampaignTreeHelpers', () => {
  let store: TreeStore;

  /** The campaign row every spec reads from. */
  const campaign = {
    id: CAMPAIGN_ID,
    organizationId: IDS.organization,
    advertiserId: IDS.advertiser,
    name: 'Automne',
    status: 'active',
    currency: 'EUR',
    budgetCents: 100_000,
    deletedAt: null,
  } as unknown as CampaignEntity;

  /**
   * Seed a tree: one lever, one AdGroup, one TargetingGroup with two keywords, one Line with a
   * creative that has a delivering version, and a linked account.
   *
   * @returns Nothing
   */
  function seed(): void {
    store.seed(CampaignEntity, [campaign]);
    store.seed(LeverEntity, [
      { id: LEVER_ID, organizationId: IDS.organization, campaignId: CAMPAIGN_ID, budgetCents: null, deletedAt: null },
    ]);
    store.seed(AdGroupEntity, [
      {
        id: AD_GROUP_ID,
        organizationId: IDS.organization,
        campaignId: CAMPAIGN_ID,
        leverId: LEVER_ID,
        budgetCents: null,
        deletedAt: null,
      },
      {
        id: 'f3000000-0000-4000-8000-000000000009',
        organizationId: IDS.organization,
        campaignId: CAMPAIGN_ID,
        leverId: 'another',
        budgetCents: null,
        deletedAt: null,
      },
    ]);
    store.seed(TargetingGroupEntity, [
      {
        id: NODE_ID,
        organizationId: IDS.organization,
        campaignId: CAMPAIGN_ID,
        adGroupId: AD_GROUP_ID,
        budgetCents: 30_000,
        deletedAt: null,
      },
    ]);
    store.seed(LineEntity, [
      {
        id: LINE_ID,
        organizationId: IDS.organization,
        campaignId: CAMPAIGN_ID,
        targetingGroupId: NODE_ID,
        creativeId: CREATIVE_ID,
        budgetCents: null,
        deletedAt: null,
      },
    ]);
    store.seed(KeywordEntity, [
      {
        id: 'k1',
        organizationId: IDS.organization,
        campaignId: CAMPAIGN_ID,
        targetingGroupId: NODE_ID,
        text: 'lit',
        negative: false,
      },
      {
        id: 'k2',
        organizationId: IDS.organization,
        campaignId: CAMPAIGN_ID,
        targetingGroupId: NODE_ID,
        text: 'gratuit',
        negative: true,
      },
    ]);
    store.seed(CreativeEntity, [
      {
        id: CREATIVE_ID,
        organizationId: IDS.organization,
        advertiserId: IDS.advertiser,
        activeVersionId: VERSION_ID,
        deletedAt: null,
      },
    ]);
    store.seed(CreativeVersionEntity, [
      { id: VERSION_ID, organizationId: IDS.organization, creativeId: CREATIVE_ID, payload: {} },
    ]);
    store.seed(AdAccountEntity, [
      { id: ACCOUNT_ID, organizationId: IDS.organization, platform: 'hawk', currency: 'EUR', deletedAt: null },
    ]);
    store.seed(AdvertiserAdAccountEntity, [
      {
        id: 'ff000000-0000-4000-8000-000000000002',
        organizationId: IDS.organization,
        advertiserId: IDS.advertiser,
        platform: 'hawk',
        currency: 'EUR',
        adAccountId: ACCOUNT_ID,
        deletedAt: null,
      },
    ]);
  }

  beforeEach((): void => {
    jest.clearAllMocks();
    store = createTreeStore();
  });

  describe('readCampaignTree', () => {
    it('should read the whole tree, one query per table', async (): Promise<void> => {
      seed();

      const tree: CampaignTree = await readCampaignTree(store.manager, campaign);

      expect(tree.levers).toHaveLength(1);
      expect(tree.adGroups).toHaveLength(2);
      expect(tree.targetingGroups).toHaveLength(1);
      expect(tree.lines).toHaveLength(1);
      expect(tree.creatives.get(CREATIVE_ID)).toMatchObject({ id: CREATIVE_ID });
      expect(tree.versions.get(CREATIVE_ID)).toMatchObject({ id: VERSION_ID });
      expect(tree.keywords.get(NODE_ID)).toEqual([expect.objectContaining({ id: 'k1' })]);
      expect(tree.negativeKeywords.get(NODE_ID)).toEqual([expect.objectContaining({ id: 'k2' })]);
      expect(tree.linksByPlatform.get('hawk')).toMatchObject({ adAccountId: ACCOUNT_ID });
      expect(tree.accountsById.get(ACCOUNT_ID)).toMatchObject({ id: ACCOUNT_ID });
    });

    it('should read nothing more than it needs for an empty campaign', async (): Promise<void> => {
      store.seed(CampaignEntity, [campaign]);

      const tree: CampaignTree = await readCampaignTree(store.manager, campaign);

      expect(tree.levers).toEqual([]);
      expect(tree.creatives.size).toBe(0);
      expect(tree.versions.size).toBe(0);
      expect(tree.keywords.size).toBe(0);
      expect(tree.accountsById.size).toBe(0);
    });

    it('should leave a creative with no delivering version out of the versions', async (): Promise<void> => {
      seed();
      (store.rows(CreativeEntity)[0] as { activeVersionId: string | null }).activeVersionId = null;

      const tree: CampaignTree = await readCampaignTree(store.manager, campaign);

      expect(tree.creatives.has(CREATIVE_ID)).toBe(true);
      expect(tree.versions.has(CREATIVE_ID)).toBe(false);
    });
  });

  describe('the children of a node', () => {
    it('should answer what hangs from each level', async (): Promise<void> => {
      seed();
      const tree: CampaignTree = await readCampaignTree(store.manager, campaign);

      expect(adGroupsOf(tree, LEVER_ID).map((node: AdGroupEntity): string => node.id)).toEqual([AD_GROUP_ID]);
      expect(targetingGroupsOf(tree, AD_GROUP_ID).map((node: TargetingGroupEntity): string => node.id)).toEqual([
        NODE_ID,
      ]);
      expect(linesOf(tree, NODE_ID).map((line: LineEntity): string => line.id)).toEqual([LINE_ID]);
      expect(linesOf(tree, 'nobody')).toEqual([]);
    });
  });

  describe('the structures the projection reads', () => {
    it('should give the campaign and its lever, without the AdGroups', async (): Promise<void> => {
      seed();
      const tree: CampaignTree = await readCampaignTree(store.manager, campaign);

      expect(leverStructure(tree, tree.levers[0])).toEqual({
        level: 'campaign',
        id: CAMPAIGN_ID,
        budgetCents: 100_000,
        children: [{ level: 'lever', id: LEVER_ID, budgetCents: null, children: [] }],
      });
    });

    it('should give the whole branch of one unit, campaign included', async (): Promise<void> => {
      seed();
      const tree: CampaignTree = await readCampaignTree(store.manager, campaign);

      expect(branchStructure(tree, tree.levers[0], tree.adGroups[0])).toEqual({
        level: 'campaign',
        id: CAMPAIGN_ID,
        budgetCents: 100_000,
        children: [
          {
            level: 'lever',
            id: LEVER_ID,
            budgetCents: null,
            children: [adGroupStructure(tree, tree.adGroups[0])],
          },
        ],
      });
    });

    it('should give one AdGroup and everything under it, keywords included', async (): Promise<void> => {
      seed();
      const tree: CampaignTree = await readCampaignTree(store.manager, campaign);

      expect(adGroupStructure(tree, tree.adGroups[0])).toEqual({
        level: 'ad_group',
        id: AD_GROUP_ID,
        budgetCents: null,
        children: [
          {
            level: 'targeting_group',
            id: NODE_ID,
            budgetCents: 30_000,
            keywordIds: ['k1'],
            children: [{ level: 'line', id: LINE_ID, budgetCents: null, children: [] }],
          },
        ],
      });
    });
  });
});
