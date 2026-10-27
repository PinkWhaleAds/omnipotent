import { FastifyInstance } from 'fastify';

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
import { PLATFORM_RULES, PlatformRules } from '@src/platforms/platform-rules';
import PreviewServicePlugin, { PreviewService } from '@src/services/preview.service';
import { Campaign, Preview, PreviewFinding } from '@src/types';
import { AccessServiceMock, buildServiceApp, createAccessMock } from '@test/unit/mocks/access.mock';
import { IDS, JANE, NOW } from '@test/unit/mocks/auth.fixtures';
import { createDataSourceMock, DataSourceMock } from '@test/unit/mocks/data-source.mock';
import { createTreeStore, TreeStore } from '@test/unit/mocks/tree-store.mock';
import { httpError } from '@utils';

/** The ids the specs work with. */
const CAMPAIGN_ID = 'f1000000-0000-4000-8000-000000000001';
const LEVER_ID = 'f2000000-0000-4000-8000-000000000001';
const AD_GROUP_ID = 'f3000000-0000-4000-8000-000000000001';
const NODE_ID = 'f4000000-0000-4000-8000-000000000001';
const LINE_ID = 'f5000000-0000-4000-8000-000000000001';
const CREATIVE_ID = 'fe000000-0000-4000-8000-000000000001';
const ACCOUNT_ID = 'ff000000-0000-4000-8000-000000000001';

/** The campaign every spec previews, as the API answers it. */
const CAMPAIGN: Campaign = { id: CAMPAIGN_ID, status: 'draft' } as Campaign;

/**
 * The rules a platform phase would declare: Hawk on DOOH, which takes everything these specs need.
 *
 * @param overrides - What this case declares
 * @returns The rules
 */
function hawkRules(overrides: Partial<PlatformRules> = {}): PlatformRules {
  return {
    label: 'Hawk',
    targeting: ['country'],
    creatives: ['display:image'],
    projection: {
      levels: { campaign: 'media_plan', lever: null, ad_group: 'campaign', targeting_group: 'ad_group', line: 'ad' },
      budgetLevel: 'ad_group',
    },
    requiresClickThroughUrl: false,
    requiresIabCategories: false,
    minDailyBudgetCents: 0,
    ...overrides,
  };
}

/** What a finding looks like once only its code and its node are kept. */
function codes(findings: PreviewFinding[]): string[] {
  return findings.map((finding: PreviewFinding): string => finding.code);
}

describe('Unit::Services::PreviewService', () => {
  /** The registry, writable, so a spec declares a couple as a platform phase would. */
  const registry: Record<string, Record<string, PlatformRules>> = PLATFORM_RULES as Record<
    string,
    Record<string, PlatformRules>
  >;
  let store: TreeStore;
  let access: AccessServiceMock;
  let campaigns: { get: jest.Mock };
  let sync: { ensureUnits: jest.Mock };
  let scheduler: { request: jest.Mock };
  let service: PreviewService;

  /**
   * Seed a campaign that previews clean: one lever on Hawk, one AdGroup, one TargetingGroup, one Line
   * with a creative, and an active account with credentials.
   *
   * @param overrides - Rows to change, by entity
   * @returns Nothing
   */
  function seedComplete(overrides: { campaign?: object; node?: object; line?: object; account?: object } = {}): void {
    store.seed(CampaignEntity, [
      {
        id: CAMPAIGN_ID,
        organizationId: IDS.organization,
        advertiserId: IDS.advertiser,
        name: 'Automne',
        status: 'draft',
        currency: 'EUR',
        timezone: null,
        startsOn: '2027-01-01',
        endsOn: '2027-01-07',
        budgetCents: 100_000,
        deletedAt: null,
        ...overrides.campaign,
      },
    ]);
    store.seed(LeverEntity, [
      {
        id: LEVER_ID,
        organizationId: IDS.organization,
        campaignId: CAMPAIGN_ID,
        lever: 'dooh',
        status: 'active',
        platformShares: [{ platform: 'hawk', shareBasisPoints: 10_000 }],
        budgetCents: null,
        deletedAt: null,
      },
    ]);
    store.seed(AdGroupEntity, [
      {
        id: AD_GROUP_ID,
        organizationId: IDS.organization,
        campaignId: CAMPAIGN_ID,
        leverId: LEVER_ID,
        lever: 'dooh',
        name: 'Grand Paris',
        status: 'active',
        budgetCents: null,
        platformShares: null,
        deletedAt: null,
      },
    ]);
    store.seed(TargetingGroupEntity, [
      {
        id: NODE_ID,
        organizationId: IDS.organization,
        campaignId: CAMPAIGN_ID,
        adGroupId: AD_GROUP_ID,
        lever: 'dooh',
        name: 'Île-de-France',
        status: 'active',
        targeting: {},
        budgetCents: null,
        deletedAt: null,
        ...overrides.node,
      },
    ]);
    store.seed(LineEntity, [
      {
        id: LINE_ID,
        organizationId: IDS.organization,
        campaignId: CAMPAIGN_ID,
        targetingGroupId: NODE_ID,
        lever: 'dooh',
        name: 'Bannière',
        status: 'active',
        creativeId: CREATIVE_ID,
        budgetCents: null,
        deletedAt: null,
        ...overrides.line,
      },
    ]);
    store.seed(CreativeEntity, [
      {
        id: CREATIVE_ID,
        organizationId: IDS.organization,
        advertiserId: IDS.advertiser,
        name: 'Bannière 300x250',
        format: 'display',
        subtype: 'image',
        iabCategories: [],
        iabTaxonomyVersion: null,
        clickThroughUrl: null,
        activeVersionId: 'fd000000-0000-4000-8000-000000000001',
        deletedAt: null,
      },
    ]);
    store.seed(AdAccountEntity, [
      {
        id: ACCOUNT_ID,
        organizationId: IDS.organization,
        platform: 'hawk',
        externalId: 'A1',
        name: 'Hawk',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        status: 'active',
        statusReason: null,
        scope: {},
        secretName: 'omnipotent/ad-account/1',
        deletedAt: null,
        ...overrides.account,
      },
    ]);
    store.seed(AdvertiserAdAccountEntity, [
      {
        id: 'ff000000-0000-4000-8000-000000000002',
        organizationId: IDS.organization,
        advertiserId: IDS.advertiser,
        platform: 'hawk',
        currency: 'EUR',
        adAccountId: ACCOUNT_ID,
        externalAdvertiserId: '555',
        deletedAt: null,
      },
    ]);
  }

  /**
   * The service on the current store, with a cap low enough for a spec to reach it.
   *
   * @returns The service
   */
  function build(): PreviewService {
    return new PreviewService(
      store.dataSource as never,
      access as never,
      campaigns as never,
      sync as never,
      scheduler as never,
      { maxPlatformObjectsPerAdGroup: 3 },
      (): number => NOW.getTime()
    );
  }

  beforeEach((): void => {
    jest.clearAllMocks();
    for (const platform of Object.keys(registry)) Reflect.deleteProperty(registry, platform);
    registry.hawk = { dooh: hawkRules() };
    store = createTreeStore();
    access = createAccessMock();
    campaigns = { get: jest.fn().mockResolvedValue(CAMPAIGN) };
    sync = { ensureUnits: jest.fn().mockResolvedValue([]) };
    scheduler = { request: jest.fn().mockResolvedValue(undefined) };
    service = build();
  });

  afterEach((): void => {
    for (const platform of Object.keys(registry)) Reflect.deleteProperty(registry, platform);
  });

  describe('preview', () => {
    it('should answer what one platform receives, and nothing to fix', async (): Promise<void> => {
      seedComplete();
      store.seed(KeywordEntity, []);

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview).toMatchObject({
        campaignId: CAMPAIGN_ID,
        status: 'draft',
        launchable: true,
        errors: [],
        warnings: [],
      });
      expect(preview.platforms).toEqual([
        {
          platform: 'hawk',
          lever: 'dooh',
          adAccountId: ACCOUNT_ID,
          accountCurrency: 'EUR',
          // D22 freezes a rate at launch; no rate service exists yet.
          fxRate: null,
          effectiveCents: 100_000,
          objects: { media_plan: 1, campaign: 1, ad_group: 1, ad: 1 },
        },
      ]);
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
    });

    it('should refuse a campaign the user declared as political advertising, complete or not', async (): Promise<void> => {
      seedComplete({ campaign: { containsPoliticalAdvertising: true } });
      store.seed(KeywordEntity, []);

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview.launchable).toBe(false);
      // The campaign itself is at fault, not a node of it, and the refusal names no platform: none of
      // them accepts political advertising (D53).
      expect(preview.errors).toEqual([
        { code: 'preview_political_advertising_unsupported', params: {}, level: null, nodeId: null, platform: null },
      ]);
      // Everything else still answers: the user sees what the campaign would create, and the one thing
      // that stops it.
      expect(preview.platforms).toHaveLength(1);
    });

    it('should list what is missing, level by level, on a campaign nobody finished', async (): Promise<void> => {
      store.seed(CampaignEntity, [
        {
          id: CAMPAIGN_ID,
          organizationId: IDS.organization,
          advertiserId: IDS.advertiser,
          status: 'draft',
          currency: 'EUR',
          budgetCents: 100_000,
          deletedAt: null,
        },
      ]);

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview.launchable).toBe(false);
      expect(codes(preview.errors)).toEqual(['preview_lever_missing']);
      expect(preview.platforms).toEqual([]);
    });

    it('should name the level of each missing child', async (): Promise<void> => {
      seedComplete();
      store.rows(AdGroupEntity).length = 0;
      store.rows(TargetingGroupEntity).length = 0;
      store.rows(LineEntity).length = 0;

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview.errors).toEqual([
        expect.objectContaining({ code: 'preview_ad_group_missing', level: 'lever', nodeId: LEVER_ID }),
      ]);
    });

    it('should name an AdGroup left without a TargetingGroup, and the node left without a Line', async (): Promise<void> => {
      seedComplete();
      store.rows(TargetingGroupEntity).length = 0;
      store.rows(LineEntity).length = 0;
      let preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);
      expect(preview.errors).toEqual([
        expect.objectContaining({ code: 'preview_targeting_group_missing', level: 'ad_group', nodeId: AD_GROUP_ID }),
      ]);

      store = createTreeStore();
      service = build();
      seedComplete();
      store.rows(LineEntity).length = 0;
      preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);
      expect(codes(preview.errors)).toEqual(['preview_line_missing']);
    });

    it('should treat a creative that no longer exists as a missing one', async (): Promise<void> => {
      seedComplete();
      // The library deleted it: the Line still names it, and the preview says the Line has no creative
      // rather than letting a launch send a reference to nothing.
      store.rows(CreativeEntity)[0].deletedAt = NOW;

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview.errors).toEqual([
        expect.objectContaining({ code: 'preview_creative_missing', level: 'line', nodeId: LINE_ID }),
      ]);
    });

    it('should refuse a Line with no creative, and one whose creative does not deliver', async (): Promise<void> => {
      seedComplete({ line: { creativeId: null } });
      let preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);
      expect(codes(preview.errors)).toContain('preview_creative_missing');

      store.rows(LineEntity)[0].creativeId = CREATIVE_ID;
      store.rows(CreativeEntity)[0].activeVersionId = null;
      preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);
      expect(codes(preview.errors)).toContain('preview_creative_version_missing');
    });

    it('should refuse a Search TargetingGroup with no positive keyword', async (): Promise<void> => {
      registry.google_ads = { search: hawkRules({ label: 'Google Ads' }) };
      seedComplete({ node: { lever: 'search' } });
      store.rows(LeverEntity)[0].lever = 'search';
      store.rows(LeverEntity)[0].platformShares = [{ platform: 'google_ads', shareBasisPoints: 10_000 }];
      store.rows(AdGroupEntity)[0].lever = 'search';
      store.rows(LineEntity)[0].lever = 'search';

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(codes(preview.errors)).toContain('preview_keywords_missing');
    });

    it('should count the keywords a Search node carries, and stop complaining', async (): Promise<void> => {
      registry.google_ads = { search: hawkRules({ label: 'Google Ads' }) };
      seedComplete({ node: { lever: 'search' } });
      store.rows(LeverEntity)[0].lever = 'search';
      store.rows(LeverEntity)[0].platformShares = [{ platform: 'google_ads', shareBasisPoints: 10_000 }];
      store.seed(KeywordEntity, [
        { id: 'k1', organizationId: IDS.organization, targetingGroupId: NODE_ID, negative: false },
        { id: 'k2', organizationId: IDS.organization, targetingGroupId: NODE_ID, negative: false },
        { id: 'k3', organizationId: IDS.organization, targetingGroupId: NODE_ID, negative: true },
      ]);

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(codes(preview.errors)).not.toContain('preview_keywords_missing');
      // The negative one does not count as something to buy.
      expect(preview.platforms[0].objects.keyword).toBe(2);
    });

    it('should warn about a node in pause', async (): Promise<void> => {
      seedComplete();
      store.rows(LineEntity)[0].status = 'paused';

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview.warnings).toEqual([
        expect.objectContaining({ code: 'preview_node_paused', level: 'line', nodeId: LINE_ID }),
      ]);
      expect(preview.launchable).toBe(true);
    });
  });

  describe('the platforms', () => {
    it('should refuse a couple no adapter declares, and project nothing for it', async (): Promise<void> => {
      Reflect.deleteProperty(registry, 'hawk');
      seedComplete();

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'preview_adapter_missing',
            platform: 'hawk',
            params: { platform: 'hawk', lever: 'dooh' },
          }),
        ])
      );
      expect(preview.platforms[0].objects).toEqual({});
    });

    it('should refuse a couple the platform has a connector for, but not on that lever', async (): Promise<void> => {
      registry.hawk = { audio: hawkRules() };
      seedComplete();

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(codes(preview.errors)).toContain('preview_adapter_missing');
    });

    it('should refuse a platform the enumeration itself does not hold', async (): Promise<void> => {
      seedComplete();
      store.rows(LeverEntity)[0].platformShares = [{ platform: 'myspace', shareBasisPoints: 10_000 }];

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(codes(preview.errors)).toContain('preview_adapter_missing');
    });

    it('should split a TargetingGroup that carries its own budget, and say so', async (): Promise<void> => {
      seedComplete({ node: { budgetCents: 40_000 } });

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      // One platform campaign for the AdGroup, one more for the node that holds a budget (§ 7).
      expect(preview.platforms[0].objects.campaign).toBe(2);
      expect(preview.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'preview_campaign_split', level: 'ad_group', nodeId: AD_GROUP_ID }),
        ])
      );
    });

    it('should refuse a split that goes past the cap', async (): Promise<void> => {
      seedComplete({ node: { budgetCents: 20_000 } });
      for (const index of [2, 3, 4]) {
        store.seed(TargetingGroupEntity, [
          {
            id: `f4000000-0000-4000-8000-00000000000${index}`,
            organizationId: IDS.organization,
            campaignId: CAMPAIGN_ID,
            adGroupId: AD_GROUP_ID,
            lever: 'dooh',
            name: `Node ${index}`,
            status: 'active',
            targeting: {},
            budgetCents: 20_000,
            deletedAt: null,
          },
        ]);
      }

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'preview_platform_campaign_cap',
            params: { objects: 5, max: 3 },
          }),
        ])
      );
    });

    it('should not split where the platform holds its budget below the AdGroup', async (): Promise<void> => {
      registry.hawk = {
        dooh: hawkRules({
          projection: {
            levels: { campaign: null, lever: null, ad_group: 'order', targeting_group: 'order', line: 'line' },
            budgetLevel: 'line',
          },
        }),
      };
      seedComplete({ node: { budgetCents: 40_000 } });

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(codes(preview.warnings)).not.toContain('preview_campaign_split');
      // The AdGroup and the node both become an Order: two of them, and no third from a split.
      expect(preview.platforms[0].objects.order).toBe(2);
    });
  });

  describe('the creatives', () => {
    it('should warn when this platform does not take the couple of a creative', async (): Promise<void> => {
      registry.hawk = { dooh: hawkRules({ creatives: ['video:file'] }) };
      seedComplete();

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'preview_creative_dropped',
            platform: 'hawk',
            params: { format: 'display', subtype: 'image' },
          }),
        ])
      );
    });

    it('should refuse a creative with no click URL where the platform demands one', async (): Promise<void> => {
      registry.hawk = { dooh: hawkRules({ requiresClickThroughUrl: true }) };
      seedComplete();

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(codes(preview.errors)).toContain('preview_click_url_missing');
    });

    it('should refuse a creative with no IAB categories where the platform demands them', async (): Promise<void> => {
      registry.hawk = { dooh: hawkRules({ requiresIabCategories: true }) };
      seedComplete();

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(codes(preview.errors)).toContain('preview_iab_categories_missing');
    });

    it('should say nothing about a creative that holds what the platform demands', async (): Promise<void> => {
      registry.hawk = { dooh: hawkRules({ requiresClickThroughUrl: true, requiresIabCategories: true }) };
      seedComplete();
      store.rows(CreativeEntity)[0].clickThroughUrl = 'https://herbea.test';
      store.rows(CreativeEntity)[0].iabCategories = ['IAB2-3'];

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview.errors).toEqual([]);
    });
  });

  describe('the targeting a platform will not apply', () => {
    it('should name the dimension, the platform and the money that delivers without it', async (): Promise<void> => {
      seedComplete({ node: { targeting: { country: { include: ['FR'], exclude: [] }, viewability: { min: 70 } } } });

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      // Hawk declares `country` and not `viewability`: the share bought there delivers without it,
      // which is the trap of § 8 and is silent otherwise.
      expect(preview.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'preview_targeting_dropped',
            platform: 'hawk',
            level: 'targeting_group',
            params: { dimension: 'viewability', cents: 100_000 },
          }),
        ])
      );
      expect(codes(preview.warnings).filter((code: string): boolean => code === 'preview_targeting_dropped')).toEqual([
        'preview_targeting_dropped',
      ]);
    });

    it('should say nothing about a node that restricts nothing', async (): Promise<void> => {
      seedComplete();

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(codes(preview.warnings)).not.toContain('preview_targeting_dropped');
    });
  });

  describe('the accounts', () => {
    it('should refuse a platform the brand has no account on', async (): Promise<void> => {
      seedComplete();
      store.rows(AdvertiserAdAccountEntity).length = 0;

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'preview_account_missing',
            params: { platform: 'hawk', currency: 'EUR' },
          }),
        ])
      );
      expect(preview.platforms[0].adAccountId).toBeNull();
    });

    it('should refuse an account whose access is not active, and one with no credentials', async (): Promise<void> => {
      seedComplete({ account: { status: 'pending', statusReason: 'link_requested', secretName: null } });

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(codes(preview.errors)).toEqual(
        expect.arrayContaining(['preview_account_unusable', 'preview_account_credentials_missing'])
      );
    });

    it('should refuse a disconnected account as a missing one', async (): Promise<void> => {
      seedComplete({ account: { deletedAt: NOW } });

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(codes(preview.errors)).toContain('preview_account_missing');
    });
  });

  describe('launch', () => {
    it('should launch a campaign the preview finds clean', async (): Promise<void> => {
      seedComplete();

      const launched: Campaign = await service.launch(JANE, IDS.organization, CAMPAIGN_ID);

      expect(store.rows(CampaignEntity)[0].status).toBe('active');
      expect(launched).toBe(CAMPAIGN);
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'manager');
      // The launch asks the engine for the campaign's units and queues their first application.
      expect(sync.ensureUnits).toHaveBeenCalledWith(
        store.manager,
        expect.objectContaining({ campaign: expect.objectContaining({ status: 'active' }) })
      );
      expect(scheduler.request).toHaveBeenCalledWith(CAMPAIGN_ID);
    });

    it('should freeze the timezone and the pacing appointment of the campaign', async (): Promise<void> => {
      seedComplete({ campaign: { timezone: null } });

      await service.launch(JANE, IDS.organization, CAMPAIGN_ID);

      // Jane's Organization names a timezone, and the campaign keeps it from now on: a change of the
      // Organization's would otherwise move the days of a campaign already delivering.
      const campaign = store.rows(CampaignEntity)[0] as { timezone: string; nextPacingAt: Date };
      expect(campaign.timezone).toBe('Europe/Paris');
      expect(campaign.nextPacingAt.toISOString()).toBe('2026-10-06T22:00:00.000Z');
    });

    it('should keep the timezone the campaign already names', async (): Promise<void> => {
      seedComplete({ campaign: { timezone: 'America/Los_Angeles' } });

      await service.launch(JANE, IDS.organization, CAMPAIGN_ID);

      expect((store.rows(CampaignEntity)[0] as { timezone: string }).timezone).toBe('America/Los_Angeles');
    });

    it('should refuse to launch while the preview reports an error, and change nothing', async (): Promise<void> => {
      seedComplete({ line: { creativeId: null } });

      await expect(service.launch(JANE, IDS.organization, CAMPAIGN_ID)).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'campaign_preview_failed',
      });
      expect(store.rows(CampaignEntity)[0].status).toBe('draft');
    });

    it('should refuse to launch anything but a draft', async (): Promise<void> => {
      seedComplete({ campaign: { status: 'active' } });

      await expect(service.launch(JANE, IDS.organization, CAMPAIGN_ID)).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'campaign_not_draft',
        errorParams: { status: 'active' },
      });
    });
  });

  describe('setStatus', () => {
    it('should accept every transition the table names', async (): Promise<void> => {
      for (const [from, to] of [
        ['active', 'paused'],
        ['paused', 'active'],
        ['active', 'ended'],
        ['paused', 'ended'],
        ['ended', 'archived'],
      ] as const) {
        store = createTreeStore();
        service = build();
        seedComplete({ campaign: { status: from } });

        await service.setStatus(JANE, IDS.organization, CAMPAIGN_ID, { status: to });

        expect({ from, to, stored: store.rows(CampaignEntity)[0].status }).toEqual({ from, to, stored: to });
        // Pausing, ending or archiving is a change the platforms must hear about.
        expect(scheduler.request).toHaveBeenCalledWith(CAMPAIGN_ID);
      }
    });

    it('should refuse every passage the table does not name, a launch included', async (): Promise<void> => {
      for (const [from, to] of [
        ['active', 'active'],
        ['ended', 'active'],
        ['archived', 'active'],
        ['archived', 'ended'],
      ] as const) {
        store = createTreeStore();
        service = build();
        seedComplete({ campaign: { status: from } });

        await expect(service.setStatus(JANE, IDS.organization, CAMPAIGN_ID, { status: to })).rejects.toMatchObject({
          statusCode: 400,
          errorCode: 'campaign_transition_invalid',
          errorParams: { from, to },
        });
      }
    });

    it('should refuse to move a draft at all: a draft is launched', async (): Promise<void> => {
      seedComplete();

      await expect(service.setStatus(JANE, IDS.organization, CAMPAIGN_ID, { status: 'active' })).rejects.toMatchObject({
        errorCode: 'campaign_transition_invalid',
        errorParams: { from: 'draft' },
      });
    });
  });

  describe('refusals', () => {
    it('should not find a campaign of another Organization', async (): Promise<void> => {
      await expect(service.preview(JANE, IDS.organization, CAMPAIGN_ID)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'campaign_not_found',
      });
    });

    it('should relay a refusal of the role, before reading anything', async (): Promise<void> => {
      access.assertOrganizationRole.mockRejectedValue(httpError(403, 'Requires the manager role'));

      await expect(service.launch(JANE, IDS.organization, CAMPAIGN_ID)).rejects.toMatchObject({ statusCode: 403 });
    });
  });

  describe('PreviewServicePlugin', () => {
    it('should decorate the instance with a PreviewService wired to its dependencies', async (): Promise<void> => {
      const db: DataSourceMock = createDataSourceMock();
      const app: FastifyInstance = await buildServiceApp([PreviewServicePlugin], {
        db,
        access,
        campaigns: campaigns as never,
        sync: { service: sync, scheduler },
      });
      db.manager.findOne.mockResolvedValue({
        id: CAMPAIGN_ID,
        organizationId: IDS.organization,
        advertiserId: IDS.advertiser,
        status: 'draft',
        currency: 'EUR',
      });

      expect(app.previewService).toBeInstanceOf(PreviewService);
      await expect(app.previewService.preview(JANE, IDS.organization, CAMPAIGN_ID)).resolves.toMatchObject({
        campaignId: CAMPAIGN_ID,
      });

      await app.close();
    });
  });
});
