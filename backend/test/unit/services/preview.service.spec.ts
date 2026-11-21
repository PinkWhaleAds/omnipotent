import { FastifyInstance } from 'fastify';

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
import { ADAPTERS, PlatformAdapter } from '@src/platforms/platform-adapter';
import { PLATFORM_RULES, PlatformRules } from '@src/platforms/platform-rules';
import PreviewServicePlugin, { canonical, PreviewService } from '@src/services/preview.service';
import { Campaign, Platform, Preview, PreviewFinding } from '@src/types';
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
    bidStrategies: ['fixed_cpm', 'from_deal'],
    sharedTargeting: [],
    maxActiveAds: null,
    settings: {},
    locationIntent: false,
    extensions: false,
    geo: { levels: [], excludedLevels: [], maxRadii: null },
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
  function seedComplete(
    overrides: {
      campaign?: object;
      lever?: object;
      adGroup?: object;
      node?: object;
      line?: object;
      account?: object;
    } = {}
  ): void {
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
        startTime: null,
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
        ...overrides.lever,
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
        bidStrategy: 'fixed_cpm',
        budgetCents: null,
        platformShares: null,
        deletedAt: null,
        ...overrides.adGroup,
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

    it('should refuse a responsive ad that repeats a headline, spaces and case aside', async (): Promise<void> => {
      seedComplete();
      Object.assign(store.rows(CreativeEntity)[0], { name: 'Annonce', format: 'search_text', subtype: 'rsa' });
      store.seed(CreativeVersionEntity, [
        {
          id: 'fd000000-0000-4000-8000-000000000001',
          organizationId: IDS.organization,
          creativeId: CREATIVE_ID,
          payload: {
            headlines: ['Lits en chêne', 'Livraison offerte', ' lits EN CHÊNE'],
            descriptions: ['Fabriqués en France.', 'Livrés chez vous.'],
          },
        },
      ]);

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      // The descriptions all differ: only the headlines are refused.
      expect(preview.errors).toEqual([
        expect.objectContaining({
          code: 'preview_creative_text_duplicate',
          params: { creative: 'Annonce', field: 'headlines', text: ' lits EN CHÊNE' },
          level: 'line',
          nodeId: LINE_ID,
        }),
      ]);
    });

    it('should look for no repeated text in a creative whose couple does not ask for it', async (): Promise<void> => {
      seedComplete();
      store.seed(CreativeVersionEntity, [
        {
          id: 'fd000000-0000-4000-8000-000000000001',
          organizationId: IDS.organization,
          creativeId: CREATIVE_ID,
          payload: { altText: 'Lit' },
        },
      ]);

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview.errors).toEqual([]);
    });

    it('should take the page of the Line as the click URL, over a creative that has none', async (): Promise<void> => {
      registry.hawk = { dooh: hawkRules({ requiresClickThroughUrl: true }) };
      seedComplete({ line: { landingPageUrl: 'https://herbea.test/automne' } });

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(codes(preview.errors)).not.toContain('preview_click_url_missing');
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

  describe('the places and circles (D57)', () => {
    /** Places of the referential, as the targeting service fills them. */
    const PARIS = {
      id: '1006094',
      level: 'city',
      name: 'Paris',
      canonicalName: 'Paris,Paris,Ile-de-France,France',
      countryCode: 'FR',
    };
    const PARIS_1ST = { ...PARIS, id: '9056126', level: 'postal_code', name: '75001' };
    const BRUSSELS = { ...PARIS, id: '1001004', name: 'Brussels', countryCode: 'BE' };

    it('should refuse a place or a circle outside the countries the TargetingGroup includes, on every platform', async (): Promise<void> => {
      seedComplete({
        node: {
          targeting: {
            country: { include: ['FR'], exclude: [] },
            location: { include: [PARIS, BRUSSELS], exclude: [] },
            proximity: { points: [{ latitude: 48.86, longitude: 2.35, radiusKm: 5, label: 'Châtelet' }] },
          },
        },
      });

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview.errors).toContainEqual({
        code: 'preview_geo_outside_countries',
        params: { count: 2, names: 'Brussels, Châtelet' },
        level: 'targeting_group',
        nodeId: NODE_ID,
        platform: null,
      });
      expect(preview.launchable).toBe(false);
    });

    it('should say where a platform serves a country whole, with the money, and what it does not exclude', async (): Promise<void> => {
      registry.hawk = { dooh: hawkRules({ geo: { levels: ['region'], excludedLevels: [], maxRadii: null } }) };
      seedComplete({
        node: {
          targeting: {
            country: { include: ['FR'], exclude: [] },
            location: { include: [PARIS], exclude: [PARIS_1ST] },
          },
        },
      });

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview.warnings).toEqual(
        expect.arrayContaining([
          {
            code: 'preview_geo_widened_to_country',
            params: { platform: 'hawk', country: 'FR', reasons: 'level', cents: 100_000 },
            level: 'targeting_group',
            nodeId: NODE_ID,
            platform: 'hawk',
          },
          {
            code: 'preview_geo_exclusions_ignored',
            params: { platform: 'hawk', count: 1, names: '75001' },
            level: 'targeting_group',
            nodeId: NODE_ID,
            platform: 'hawk',
          },
        ])
      );
      // The plan says it with the country: the places are not also reported as dropped.
      expect(codes(preview.warnings)).not.toContain('preview_targeting_dropped');
      expect(codes(preview.errors)).not.toContain('preview_geo_outside_countries');
    });

    it('should refuse more circles than one object of the platform takes', async (): Promise<void> => {
      registry.hawk = { dooh: hawkRules({ geo: { levels: [], excludedLevels: [], maxRadii: 1 } }) };
      const circle = { latitude: 48.86, longitude: 2.35, radiusKm: 5, countryCode: 'FR' };
      seedComplete({
        node: {
          targeting: {
            country: { include: ['FR'], exclude: [] },
            proximity: { points: [circle, { ...circle, radiusKm: 9 }] },
          },
        },
      });

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview.errors).toContainEqual({
        code: 'preview_geo_too_many_radii',
        params: { platform: 'hawk', count: 2, max: 1 },
        level: 'targeting_group',
        nodeId: NODE_ID,
        platform: 'hawk',
      });
    });

    it('should say nothing of a TargetingGroup whose places the platform targets', async (): Promise<void> => {
      registry.hawk = { dooh: hawkRules({ geo: { levels: ['city'], excludedLevels: ['postal_code'], maxRadii: 10 } }) };
      seedComplete({
        node: {
          targeting: {
            country: { include: ['FR'], exclude: [] },
            location: { include: [PARIS], exclude: [PARIS_1ST] },
          },
        },
      });

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(
        codes([...preview.errors, ...preview.warnings]).filter((code: string): boolean =>
          code.startsWith('preview_geo')
        )
      ).toEqual([]);
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

  describe('what a couple cannot hold', () => {
    /**
     * One more TargetingGroup under the AdGroup.
     *
     * @param index - Which one, from 2
     * @param overrides - What it declares
     * @returns Its id
     */
    function seedNode(index: number, overrides: object = {}): string {
      const id = `f4000000-0000-4000-8000-00000000000${index}`;
      store.seed(TargetingGroupEntity, [
        {
          id,
          organizationId: IDS.organization,
          campaignId: CAMPAIGN_ID,
          adGroupId: AD_GROUP_ID,
          lever: 'dooh',
          name: `Node ${index}`,
          status: 'active',
          targeting: {},
          budgetCents: null,
          deletedAt: null,
          ...overrides,
        },
      ]);
      return id;
    }

    /**
     * Lines under one TargetingGroup, each with the creative of the seed.
     *
     * @param nodeId - The TargetingGroup
     * @param statuses - The status of each, in order
     * @returns Nothing
     */
    function seedLines(nodeId: string, statuses: string[]): void {
      store.seed(
        LineEntity,
        statuses.map((status: string, index: number) => ({
          id: `f5000000-0000-4000-8000-0000000001${nodeId.slice(-1)}${index}`,
          organizationId: IDS.organization,
          campaignId: CAMPAIGN_ID,
          targetingGroupId: nodeId,
          lever: 'dooh',
          name: `Line ${index}`,
          status,
          creativeId: CREATIVE_ID,
          budgetCents: null,
          deletedAt: null,
        }))
      );
    }

    it('should refuse an AdGroup bidding with a strategy the platform does not take', async (): Promise<void> => {
      seedComplete({ adGroup: { bidStrategy: 'target_cpcv' } });

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview.errors).toEqual([
        expect.objectContaining({
          code: 'preview_bid_strategy_unsupported',
          params: { platform: 'hawk', strategy: 'target_cpcv' },
          level: 'ad_group',
          nodeId: AD_GROUP_ID,
          platform: 'hawk',
        }),
      ]);
    });

    it('should not ask an AdGroup whose own key leaves the platform out', async (): Promise<void> => {
      seedComplete({
        lever: { platformShares: [{ platform: 'hawk', shareBasisPoints: 10_000 }] },
        adGroup: { bidStrategy: 'target_cpcv', platformShares: [{ platform: 'dv360', shareBasisPoints: 10_000 }] },
      });

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(codes(preview.errors)).not.toContain('preview_bid_strategy_unsupported');
    });

    it('should refuse more active ads under one object than the platform serves', async (): Promise<void> => {
      registry.hawk = { dooh: hawkRules({ maxActiveAds: 3 }) };
      seedComplete();
      seedLines(NODE_ID, ['active', 'active', 'active']);

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview.errors).toEqual([
        expect.objectContaining({
          code: 'preview_too_many_ads',
          params: { count: 4, max: 3 },
          level: 'targeting_group',
          nodeId: NODE_ID,
          platform: 'hawk',
        }),
      ]);
    });

    it('should not count a Line in pause, which is paused over there too', async (): Promise<void> => {
      registry.hawk = { dooh: hawkRules({ maxActiveAds: 3 }) };
      seedComplete();
      seedLines(NODE_ID, ['active', 'active', 'paused']);

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(codes(preview.errors)).not.toContain('preview_too_many_ads');
    });

    it('should count the ads of each object apart', async (): Promise<void> => {
      registry.hawk = { dooh: hawkRules({ maxActiveAds: 3 }) };
      seedComplete();
      seedLines(NODE_ID, ['active', 'active']);
      seedLines(seedNode(2), ['active', 'active', 'active']);

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(codes(preview.errors)).not.toContain('preview_too_many_ads');
    });

    it('should refuse TargetingGroups of one object of the budget level asking for different places', async (): Promise<void> => {
      registry.hawk = { dooh: hawkRules({ sharedTargeting: ['country'] }) };
      seedComplete({ node: { targeting: { country: { include: ['FR'], exclude: [] } } } });
      seedLines(seedNode(2, { targeting: { country: { include: ['BE'], exclude: [] } } }), ['active']);

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview.errors).toEqual([
        expect.objectContaining({
          code: 'preview_targeting_not_shared',
          params: { dimension: 'country' },
          level: 'ad_group',
          nodeId: AD_GROUP_ID,
          platform: 'hawk',
        }),
      ]);
    });

    it('should refuse a place asked by one TargetingGroup and not by its sibling', async (): Promise<void> => {
      registry.hawk = { dooh: hawkRules({ sharedTargeting: ['country'] }) };
      seedComplete({ node: { targeting: { country: { include: ['FR'], exclude: [] } } } });
      seedLines(seedNode(2), ['active']);

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(codes(preview.errors)).toEqual(['preview_targeting_not_shared']);
    });

    it('should accept the same places written in another order', async (): Promise<void> => {
      registry.hawk = { dooh: hawkRules({ sharedTargeting: ['country'] }) };
      seedComplete({ node: { targeting: { country: { include: ['FR', 'BE'], exclude: [] } } } });
      seedLines(seedNode(2, { targeting: { country: { exclude: [], include: ['BE', 'FR'] } } }), ['active']);

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview.errors).toEqual([]);
    });

    it('should let a TargetingGroup split into its own object ask for its own places', async (): Promise<void> => {
      registry.hawk = { dooh: hawkRules({ sharedTargeting: ['country'] }) };
      seedComplete({ node: { targeting: { country: { include: ['FR'], exclude: [] } } } });
      seedLines(seedNode(2, { budgetCents: 20_000, targeting: { country: { include: ['BE'], exclude: [] } } }), [
        'active',
      ]);

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview.errors).toEqual([]);
    });
  });

  describe('what a Search lever shows, and how it reads a place', () => {
    const EXTENSIONS = { sitelinks: [], callouts: ['Livraison offerte'], structuredSnippets: [] };

    it('should refuse a sitelink with one description line: the platforms take two or none', async (): Promise<void> => {
      seedComplete({
        lever: {
          extensions: {
            sitelinks: [
              { text: 'Nos lits', description1: 'En chêne', finalUrl: 'https://herbea.test/lits' },
              { text: 'Nos draps', finalUrl: 'https://herbea.test/draps' },
              {
                text: 'Nos oreillers',
                description1: 'En plumes',
                description2: 'Et en laine',
                finalUrl: 'https://herbea.test/oreillers',
              },
            ],
            callouts: [],
            structuredSnippets: [],
          },
        },
      });

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview.errors).toEqual([
        expect.objectContaining({
          code: 'preview_sitelink_descriptions',
          params: { text: 'Nos lits' },
          level: 'lever',
          nodeId: LEVER_ID,
        }),
      ]);
    });

    it('should warn that a platform shows none of the extensions of the lever', async (): Promise<void> => {
      seedComplete({ lever: { extensions: EXTENSIONS } });

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'preview_extensions_dropped', params: { platform: 'hawk' }, level: 'lever' }),
        ])
      );
    });

    it('should say nothing of extensions a platform shows, or of a lever that carries none', async (): Promise<void> => {
      registry.hawk = { dooh: hawkRules({ extensions: true }) };
      seedComplete({ lever: { extensions: EXTENSIONS } });
      expect(codes((await service.preview(JANE, IDS.organization, CAMPAIGN_ID)).warnings)).not.toContain(
        'preview_extensions_dropped'
      );

      store = createTreeStore();
      service = build();
      registry.hawk = { dooh: hawkRules() };
      seedComplete({ lever: { extensions: { sitelinks: [], callouts: [], structuredSnippets: [] } } });
      expect(codes((await service.preview(JANE, IDS.organization, CAMPAIGN_ID)).warnings)).not.toContain(
        'preview_extensions_dropped'
      );
    });

    it('should warn that a platform reads a place as the people in it only', async (): Promise<void> => {
      seedComplete({ adGroup: { locationIntent: 'presence_or_interest' } });

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(preview.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'preview_location_intent_dropped',
            params: { platform: 'hawk' },
            level: 'ad_group',
            nodeId: AD_GROUP_ID,
          }),
        ])
      );
    });

    it('should say nothing of an intent the platform reads', async (): Promise<void> => {
      registry.hawk = { dooh: hawkRules({ locationIntent: true }) };
      seedComplete({ adGroup: { locationIntent: 'presence_or_interest' } });

      const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

      expect(codes(preview.warnings)).not.toContain('preview_location_intent_dropped');
    });
  });

  describe('canonical', () => {
    it('should read two equal values the same, whatever the order of their keys and lists', (): void => {
      expect(canonical({ include: ['FR', 'BE'], exclude: [] })).toBe(canonical({ exclude: [], include: ['BE', 'FR'] }));
      expect(canonical({ points: [{ latitude: 1, longitude: 2 }] })).not.toBe(
        canonical({ points: [{ latitude: 2, longitude: 1 }] })
      );
      expect(canonical(null)).toBe('null');
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

    describe('on a platform with an adapter', () => {
      /** The adapters, writable, so a spec registers one as the startup would. */
      const adapters: Partial<Record<Platform, PlatformAdapter>> = ADAPTERS as Partial<
        Record<Platform, PlatformAdapter>
      >;

      afterEach((): void => {
        Reflect.deleteProperty(adapters, 'hawk');
      });

      it('should ask no secret of an account whose platform runs on our credentials', async (): Promise<void> => {
        // A `manager_link` platform: our manager account manages theirs (`docs/phase-10.md` § 4.1).
        adapters.hawk = { platform: 'hawk', connection: 'manager_link', apply: jest.fn() };
        seedComplete({ account: { secretName: null } });

        const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

        expect(preview.errors).toEqual([]);
      });

      it('should still ask one of an account that brings its own secret', async (): Promise<void> => {
        adapters.hawk = { platform: 'hawk', connection: 'account_secret', apply: jest.fn() };
        seedComplete({ account: { secretName: null } });

        const preview: Preview = await service.preview(JANE, IDS.organization, CAMPAIGN_ID);

        expect(codes(preview.errors)).toEqual(['preview_account_credentials_missing']);
      });
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

    it('should set the appointment at the start time when it comes before midnight', async (): Promise<void> => {
      // It is 12:00 in Paris, and the campaign starts today at 15:00: that is when it must be woken.
      seedComplete({ campaign: { timezone: 'Europe/Paris', startsOn: '2026-10-06', startTime: '15:00' } });

      await service.launch(JANE, IDS.organization, CAMPAIGN_ID);

      const campaign = store.rows(CampaignEntity)[0] as { nextPacingAt: Date };
      expect(campaign.nextPacingAt.toISOString()).toBe('2026-10-06T13:00:00.000Z');
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

    it('should date the AdGroups it sends, and leave a paused one unsent', async (): Promise<void> => {
      seedComplete({ adGroup: { activatedAt: null } });
      store.seed(AdGroupEntity, [
        {
          id: 'f3000000-0000-4000-8000-000000000002',
          organizationId: IDS.organization,
          campaignId: CAMPAIGN_ID,
          leverId: LEVER_ID,
          lever: 'dooh',
          name: 'En réserve',
          status: 'paused',
          bidStrategy: 'fixed_cpm',
          budgetCents: null,
          platformShares: null,
          activatedAt: null,
          deletedAt: null,
        },
      ]);

      await service.launch(JANE, IDS.organization, CAMPAIGN_ID);

      // A paused AdGroup's missing TargetingGroup does not stop the launch: it sends nothing.
      const dated = (groups: { id: string; activatedAt: Date | null }[]): Record<string, Date | null> =>
        Object.fromEntries(groups.map((group) => [group.id, group.activatedAt]));
      const expected = { [AD_GROUP_ID]: NOW, 'f3000000-0000-4000-8000-000000000002': null };
      expect(dated(store.rows(AdGroupEntity) as { id: string; activatedAt: Date | null }[])).toEqual(expected);
      // The engine is handed the tree as it now stands, so it makes units for the dated one only.
      expect(dated((sync.ensureUnits.mock.calls[0][1] as { adGroups: [] }).adGroups)).toEqual(expected);
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

  describe('setNodeStatus', () => {
    /** A campaign that delivers, in a timezone of its own. */
    const LIVE = { status: 'active', timezone: 'Europe/Paris' };

    it('should pause a node of a live campaign, and have the platforms hear about it', async (): Promise<void> => {
      seedComplete({ campaign: LIVE });

      const change = await service.setNodeStatus(JANE, IDS.organization, 'targeting_group', NODE_ID, {
        status: 'paused',
      });

      expect(change).toEqual({ level: 'targeting_group', id: NODE_ID, campaignId: CAMPAIGN_ID, status: 'paused' });
      expect(store.rows(TargetingGroupEntity)[0].status).toBe('paused');
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'manager');
      expect(scheduler.request).toHaveBeenCalledWith(CAMPAIGN_ID);
    });

    it('should switch a node of a draft freely, and ask no platform anything', async (): Promise<void> => {
      seedComplete({ line: { status: 'paused', creativeId: null } });

      await service.setNodeStatus(JANE, IDS.organization, 'line', LINE_ID, { status: 'active' });

      // Nothing has been sent from a draft: the preview judges it at the launch.
      expect(store.rows(LineEntity)[0].status).toBe('active');
      expect(scheduler.request).not.toHaveBeenCalled();
    });

    it('should refuse a node of an ended or archived campaign', async (): Promise<void> => {
      for (const status of ['ended', 'archived']) {
        store = createTreeStore();
        service = build();
        seedComplete({ campaign: { ...LIVE, status } });

        await expect(
          service.setNodeStatus(JANE, IDS.organization, 'ad_group', AD_GROUP_ID, { status: 'paused' })
        ).rejects.toMatchObject({ statusCode: 400, errorCode: 'node_campaign_closed', errorParams: { status } });
      }
    });

    it('should refuse a status the node already holds', async (): Promise<void> => {
      seedComplete({ campaign: LIVE });

      await expect(
        service.setNodeStatus(JANE, IDS.organization, 'lever', LEVER_ID, { status: 'active' })
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'node_status_unchanged',
        errorParams: { level: 'lever', status: 'active' },
      });
    });

    it('should not find a node of another Organization', async (): Promise<void> => {
      seedComplete({ campaign: LIVE });

      await expect(
        service.setNodeStatus(JANE, IDS.otherOrganization, 'line', LINE_ID, { status: 'paused' })
      ).rejects.toMatchObject({ statusCode: 404, errorCode: 'line_not_found' });
    });

    it('should relay a refusal of the role, before reading anything', async (): Promise<void> => {
      access.assertOrganizationRole.mockRejectedValue(httpError(403, 'Forbidden', { code: 'role_required' }));

      await expect(
        service.setNodeStatus(JANE, IDS.organization, 'line', LINE_ID, { status: 'paused' })
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('should refuse to activate a node whose window has ended', async (): Promise<void> => {
      seedComplete({ campaign: { ...LIVE, startsOn: '2026-09-01', endsOn: '2026-09-30' }, line: { status: 'paused' } });

      await expect(
        service.setNodeStatus(JANE, IDS.organization, 'line', LINE_ID, { status: 'active' })
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'node_ended',
        errorParams: { level: 'line', endsOn: '2026-09-30' },
      });
      expect(store.rows(LineEntity)[0].status).toBe('paused');
    });

    it('should refuse to activate a node the preview finds an error under, and name its codes', async (): Promise<void> => {
      seedComplete({ campaign: LIVE, adGroup: { status: 'paused', activatedAt: null }, line: { creativeId: null } });

      await expect(
        service.setNodeStatus(JANE, IDS.organization, 'ad_group', AD_GROUP_ID, { status: 'active' })
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'node_not_activatable',
        errorParams: { level: 'ad_group', errors: 1, codes: 'preview_creative_missing' },
      });
      expect(store.rows(AdGroupEntity)[0]).toMatchObject({ status: 'paused', activatedAt: null });
    });

    it('should not hold against a node an error under a node still paused below it', async (): Promise<void> => {
      // The Line stays paused, so activating its TargetingGroup sends nothing wrong: the Line's own
      // activation will be judged on its own.
      seedComplete({ campaign: LIVE, node: { status: 'paused' }, line: { status: 'paused', creativeId: null } });

      await service.setNodeStatus(JANE, IDS.organization, 'targeting_group', NODE_ID, { status: 'active' });

      expect(store.rows(TargetingGroupEntity)[0].status).toBe('active');
    });

    it('should not hold against a node an error elsewhere in the campaign', async (): Promise<void> => {
      seedComplete({ campaign: LIVE, line: { status: 'paused' }, account: { status: 'pending' } });

      await service.setNodeStatus(JANE, IDS.organization, 'line', LINE_ID, { status: 'active' });

      expect(store.rows(LineEntity)[0].status).toBe('active');
    });

    it('should date the first activation of an AdGroup, which gives it its units', async (): Promise<void> => {
      seedComplete({ campaign: LIVE, adGroup: { status: 'paused', activatedAt: null } });

      await service.setNodeStatus(JANE, IDS.organization, 'ad_group', AD_GROUP_ID, { status: 'active' });

      expect(store.rows(AdGroupEntity)[0]).toMatchObject({ status: 'active', activatedAt: NOW });
      expect(scheduler.request).toHaveBeenCalledWith(CAMPAIGN_ID);
    });

    it('should keep the date of an AdGroup activated before', async (): Promise<void> => {
      const before = new Date('2026-10-01T08:00:00.000Z');
      seedComplete({ campaign: LIVE, adGroup: { status: 'paused', activatedAt: before } });

      await service.setNodeStatus(JANE, IDS.organization, 'ad_group', AD_GROUP_ID, { status: 'active' });

      expect(store.rows(AdGroupEntity)[0]).toMatchObject({ status: 'active', activatedAt: before });
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
