import { DesiredAsset, DesiredObject, DesiredUnit } from '@src/platforms/desired-state';
import { GoogleUnitSync } from '@src/platforms/google/google.apply';
import { nameTag } from '@src/platforms/google/google.mapping';
import { GoogleAdsRow, GoogleMutateOperation } from '@src/platforms/google/google.types';
import { ApplyResult, PlatformContext, PlatformError } from '@src/platforms/platform-adapter';

/** The client account, ten digits. */
const CID = '5550001111';

/** 2027-01-04 10:00 UTC, 11:00 in Paris. */
const NOW: number = Date.parse('2027-01-04T10:00:00.000Z');

/** Where the existing campaign of these specs lives. */
const CAMPAIGN = `customers/${CID}/campaigns/11`;
const AD_GROUP = `customers/${CID}/adGroups/22`;

/** What a creative of these specs says. */
const RSA = { headlines: ['Lits', 'Chêne', 'Herbéa'], descriptions: ['Fabriqués en France', 'Livrés'] };

/** The logo of these specs. */
const LOGO: DesiredAsset = {
  role: 'logo',
  id: 'asset-logo',
  fingerprint: 'abcdef0123456789abcdef',
  fileName: 'logo.png',
  mimeType: 'image/png',
  width: 512,
  height: 512,
};

/**
 * One projected object.
 *
 * @param key - Its key
 * @param kind - Google's kind
 * @param overrides - What this case declares
 * @returns The object
 */
function object(key: string, kind: DesiredObject['object'], overrides: Partial<DesiredObject> = {}): DesiredObject {
  return {
    key,
    level: 'line',
    nodeId: key.split(':').pop() as string,
    keywordId: null,
    object: kind,
    parentKey: null,
    split: false,
    name: key,
    status: 'active',
    startsOn: '2027-01-05',
    endsOn: '2027-01-10',
    dailyBudgetMicros: null,
    bidMicros: null,
    bidStrategy: 'max_cpc',
    capping: null,
    targeting: null,
    creative: null,
    landingPageUrl: null,
    trackers: null,
    keyword: null,
    ...overrides,
  };
}

/**
 * The desired state of these specs: one campaign, one ad group with two keywords and one ad, the
 * lever's extensions and a brand.
 *
 * @param overrides - What this case declares, by object key, and on the unit
 * @returns The state
 */
function desired(
  overrides: {
    objects?: Record<string, Partial<DesiredObject>>;
    unit?: Partial<DesiredUnit>;
    extra?: DesiredObject[];
  } = {}
): DesiredUnit {
  const objects: DesiredObject[] = [
    object('ad_group:g1', 'campaign', { name: 'Grand Paris', dailyBudgetMicros: 10_000_000, bidMicros: 500_000 }),
    object('targeting_group:t1', 'ad_group', {
      parentKey: 'ad_group:g1',
      name: 'Île-de-France',
      targeting: { country: { include: ['FR'], exclude: [] }, device: { include: [], exclude: ['tablet'] } },
    }),
    object('keyword:k1', 'keyword', {
      parentKey: 'targeting_group:t1',
      bidStrategy: null,
      keyword: { id: 'k1', text: 'lit chêne', matchType: 'exact', negative: false },
    }),
    object('keyword:k2', 'keyword', {
      parentKey: 'targeting_group:t1',
      bidStrategy: null,
      keyword: { id: 'k2', text: 'gratuit', matchType: 'broad', negative: true },
    }),
    object('line:l1', 'ad', {
      parentKey: 'targeting_group:t1',
      landingPageUrl: 'https://herbea.test/lits',
      creative: {
        versionId: 'v1',
        format: 'search_text',
        subtype: 'rsa',
        payload: { ...RSA, businessName: 'Herbéa' },
        assets: [LOGO],
      },
    }),
    ...(overrides.extra ?? []),
  ].map((one: DesiredObject): DesiredObject => ({ ...one, ...overrides.objects?.[one.key] }));
  return {
    unitId: 'u1',
    platform: 'google_ads',
    lever: 'search',
    adGroupId: 'g1',
    status: 'active',
    campaignId: 'c1',
    campaignName: 'Automne',
    insertionOrderNumber: null,
    containsPoliticalAdvertising: false,
    settings: { searchPartners: true, aiMax: false },
    extensions: { sitelinks: [], callouts: ['Livraison offerte'], structuredSnippets: [] },
    locationIntent: 'presence',
    currency: 'EUR',
    timezone: 'Europe/Paris',
    objects,
    ...overrides.unit,
  };
}

/**
 * A fake Google: answers each read by the table it queries, records each change.
 */
class FakeGoogle {
  /** What each read answers, by the table it reads. */
  public rows: Record<string, GoogleAdsRow[]> = {
    tag: [],
    campaign: [],
    criterion: [],
    adGroup: [],
    keyword: [],
    modifier: [],
    ad: [],
    link: [],
    image: [],
    status: [{ campaign: { status: 'ENABLED' } }],
  };

  /** The changes, one list of operations per call. */
  public readonly mutations: GoogleMutateOperation[][] = [];

  /** What the next calls of `mutate` fail with, in order; `null` lets one through. */
  public failures: (Error | null)[] = [];

  /** The reads made. */
  public readonly queries: string[] = [];

  public readonly search = jest.fn(
    async (_account: string, customerId: string, query: string): Promise<GoogleAdsRow[]> => {
      expect(customerId).toBe(CID);
      this.queries.push(query);
      const table: string = (
        [
          [/REGEXP_MATCH/, 'tag'],
          [/^SELECT campaign\.status FROM campaign/, 'status'],
          [/FROM campaign WHERE campaign\.resource_name IN/, 'campaign'],
          [/FROM campaign_criterion/, 'criterion'],
          [/FROM ad_group WHERE/, 'adGroup'],
          [/FROM ad_group_criterion/, 'keyword'],
          [/FROM ad_group_bid_modifier/, 'modifier'],
          [/FROM ad_group_ad/, 'ad'],
          [/FROM campaign_asset/, 'link'],
          [/FROM asset WHERE/, 'image'],
        ] as [RegExp, string][]
      ).find(([pattern]: [RegExp, string]): boolean => pattern.test(query))?.[1] as string;
      return this.rows[table];
    }
  );

  public readonly mutate = jest.fn(
    async (_account: string, _customerId: string, operations: GoogleMutateOperation[]): Promise<string[]> => {
      this.mutations.push(operations);
      const failure: Error | null | undefined = this.failures.shift();
      if (failure) throw failure;
      return operations.map(
        (_operation, index: number): string => `customers/${CID}/made/${this.mutations.length}-${index}`
      );
    }
  );

  /**
   * Every operation of every change, flattened.
   *
   * @returns The operations
   */
  public operations(): GoogleMutateOperation[] {
    return this.mutations.flat();
  }
}

/**
 * The account of these specs.
 *
 * @param readAsset - What reads a file
 * @returns The context
 */
function context(readAsset: jest.Mock = jest.fn().mockResolvedValue(Buffer.from('png'))): PlatformContext {
  return {
    platform: 'google_ads',
    adAccountId: 'acc-1',
    externalId: CID,
    externalAdvertiserId: CID,
    currency: 'EUR',
    timezone: 'Europe/Paris',
    scope: {},
    credentials: null,
    readAsset,
  };
}

/**
 * A refusal of Google.
 *
 * @param retryable - Whether waiting can mend it
 * @returns The error
 */
function googleRefusal(retryable: boolean): PlatformError {
  return new PlatformError('google_ads', 'Refused', {
    statusCode: retryable ? 503 : 400,
    retryable,
    invalidCredentials: false,
    requestId: null,
  });
}

/**
 * What Google holds once the unit of these specs was created as it is wanted.
 *
 * @param google - The fake to arrange
 * @returns Nothing
 */
function existing(google: FakeGoogle): void {
  const name = `Automne — Grand Paris ${nameTag('u1', 'ad_group:g1')}`;
  google.rows.campaign = [
    {
      campaign: {
        resourceName: CAMPAIGN,
        name,
        status: 'ENABLED',
        campaignBudget: `customers/${CID}/campaignBudgets/33`,
        biddingStrategyType: 'MANUAL_CPC',
        networkSettings: { targetSearchNetwork: true },
        geoTargetTypeSetting: { positiveGeoTargetType: 'PRESENCE' },
        aiMaxSetting: { enableAiMax: false },
        startDateTime: '2027-01-05 00:00:00',
        endDateTime: '2027-01-10 23:59:59',
      },
      campaignBudget: { amountMicros: '10000000' },
    },
  ];
  google.rows.criterion = [
    {
      campaignCriterion: {
        resourceName: `${CAMPAIGN}~1`,
        campaign: CAMPAIGN,
        location: { geoTargetConstant: 'geoTargetConstants/2250' },
      },
    },
  ];
  google.rows.adGroup = [
    {
      adGroup: {
        resourceName: AD_GROUP,
        campaign: CAMPAIGN,
        name: `Île-de-France ${nameTag('u1', 'targeting_group:t1')}`,
        status: 'ENABLED',
        cpcBidMicros: '500000',
      },
    },
  ];
  google.rows.keyword = [
    {
      adGroupCriterion: {
        resourceName: `${AD_GROUP}~k1`,
        adGroup: AD_GROUP,
        status: 'ENABLED',
        keyword: { text: 'lit chêne', matchType: 'EXACT' },
      },
    },
    {
      adGroupCriterion: {
        resourceName: `${AD_GROUP}~k2`,
        adGroup: AD_GROUP,
        negative: true,
        keyword: { text: 'gratuit', matchType: 'BROAD' },
      },
    },
  ];
  // Google answers a row for every device with no modifier: not ours, and never to remove.
  google.rows.modifier = [
    { adGroupBidModifier: { resourceName: `${AD_GROUP}~30000`, adGroup: AD_GROUP, device: { type: 'MOBILE' } } },
    { adGroupBidModifier: { resourceName: `${AD_GROUP}~30001`, adGroup: AD_GROUP, device: { type: 'DESKTOP' } } },
    {
      adGroupBidModifier: {
        resourceName: `${AD_GROUP}~m`,
        adGroup: AD_GROUP,
        device: { type: 'TABLET' },
        bidModifier: 0,
      },
    },
  ];
  google.rows.ad = [
    {
      adGroupAd: {
        resourceName: `${AD_GROUP}~a1`,
        adGroup: AD_GROUP,
        status: 'ENABLED',
        ad: {
          resourceName: `customers/${CID}/ads/a1`,
          finalUrls: ['https://herbea.test/lits'],
          urlCustomParameters: [{ key: 'mskey', value: 'l1' }],
          responsiveSearchAd: {
            headlines: RSA.headlines.map((text: string) => ({ text })),
            descriptions: RSA.descriptions.map((text: string) => ({ text })),
          },
        },
      },
    },
  ];
  google.rows.link = [
    {
      campaignAsset: { resourceName: `${CAMPAIGN}~c1`, campaign: CAMPAIGN, fieldType: 'CALLOUT' },
      asset: { resourceName: `customers/${CID}/assets/c1`, calloutAsset: { calloutText: 'Livraison offerte' } },
    },
    {
      campaignAsset: { resourceName: `${CAMPAIGN}~b1`, campaign: CAMPAIGN, fieldType: 'BUSINESS_NAME' },
      asset: { resourceName: `customers/${CID}/assets/b1`, textAsset: { text: 'Herbéa' } },
    },
    {
      campaignAsset: { resourceName: `${CAMPAIGN}~l1`, campaign: CAMPAIGN, fieldType: 'BUSINESS_LOGO' },
      asset: { resourceName: `customers/${CID}/assets/l1`, name: 'logo.png [op:abcdef0123456789]' },
    },
  ];
}

/** The refs the engine keeps once the unit of these specs exists. */
const REFS: Record<string, string> = { 'ad_group:g1': CAMPAIGN, 'targeting_group:t1': AD_GROUP };

describe('Unit::Platforms::Google::Apply', () => {
  let google: FakeGoogle;
  let sync: GoogleUnitSync;

  beforeEach((): void => {
    google = new FakeGoogle();
    sync = new GoogleUnitSync(google as never, (): number => NOW);
  });

  describe('a unit Google does not hold yet', () => {
    it('should create the whole campaign in one atomic change, and keep what it made', async (): Promise<void> => {
      const result: ApplyResult = await sync.apply(context(), desired(), {});

      const [structure] = google.mutations;
      expect(structure.map((operation) => Object.keys(operation)[0])).toEqual([
        'campaignBudgetOperation',
        'campaignOperation',
        'campaignCriterionOperation',
        'adGroupOperation',
        'adGroupBidModifierOperation',
        'adGroupCriterionOperation',
        'adGroupCriterionOperation',
        'adGroupAdOperation',
        'assetOperation',
        'campaignAssetOperation',
      ]);
      expect(structure[1]).toEqual({
        campaignOperation: {
          create: {
            resourceName: `customers/${CID}/campaigns/-2`,
            name: `Automne — Grand Paris ${nameTag('u1', 'ad_group:g1')}`,
            status: 'ENABLED',
            advertisingChannelType: 'SEARCH',
            campaignBudget: `customers/${CID}/campaignBudgets/-1`,
            containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
            networkSettings: {
              targetGoogleSearch: true,
              targetSearchNetwork: true,
              targetContentNetwork: false,
              targetPartnerSearchNetwork: false,
            },
            geoTargetTypeSetting: { positiveGeoTargetType: 'PRESENCE', negativeGeoTargetType: 'PRESENCE' },
            aiMaxSetting: { enableAiMax: false },
            manualCpc: { enhancedCpcEnabled: false },
            startDateTime: '2027-01-05 00:00:00',
            endDateTime: '2027-01-10 23:59:59',
          },
        },
      });
      // The ad group bids its campaign's amount, having none of its own.
      expect(structure[3]).toMatchObject({
        adGroupOperation: { create: { cpcBidMicros: '500000', type: 'SEARCH_STANDARD' } },
      });
      expect(structure[5]).toEqual({
        adGroupCriterionOperation: {
          create: {
            adGroup: `customers/${CID}/adGroups/-3`,
            status: 'ENABLED',
            keyword: { text: 'lit chêne', matchType: 'EXACT' },
          },
        },
      });
      expect(structure[6]).toMatchObject({ adGroupCriterionOperation: { create: { negative: true } } });

      // The brand goes apart: the business name, then the logo, found nowhere and uploaded.
      expect(google.mutations.slice(1).map((operations) => Object.keys(operations[0])[0])).toEqual([
        'assetOperation',
        'campaignAssetOperation',
        'assetOperation',
        'campaignAssetOperation',
      ]);
      expect(google.mutations[3][0]).toEqual({
        assetOperation: {
          create: {
            name: 'logo.png [op:abcdef0123456789]',
            type: 'IMAGE',
            imageAsset: { data: Buffer.from('png').toString('base64') },
          },
        },
      });

      expect(result.refs).toMatchObject({
        'ad_group:g1': `customers/${CID}/made/1-1`,
        'targeting_group:t1': `customers/${CID}/made/1-3`,
        'keyword:k1': `customers/${CID}/made/1-5`,
        'keyword:k2': `customers/${CID}/made/1-6`,
        'line:l1': `customers/${CID}/made/1-7`,
        'image:abcdef0123456789abcdef': `customers/${CID}/made/4-0`,
      });
      expect(result.appliedStatus).toBe('active');
      // A new ad is one Google reviews.
      expect(result.submitted).toEqual(['line:l1']);
    });

    it('should find a campaign an interrupted synchronization made, by the tag of its name', async (): Promise<void> => {
      existing(google);
      google.rows.tag = [
        { campaign: { resourceName: `customers/${CID}/campaigns/1`, name: 'Une autre [op:ffffffffffff]' } },
        { campaign: {} },
        { campaign: { resourceName: CAMPAIGN, name: google.rows.campaign[0].campaign?.name } },
      ];

      const result: ApplyResult = await sync.apply(context(), desired(), {});

      expect(google.mutations).toEqual([]);
      expect(result.refs).toMatchObject({
        'ad_group:g1': CAMPAIGN,
        'targeting_group:t1': AD_GROUP,
        'keyword:k1': `${AD_GROUP}~k1`,
        'keyword:k2': `${AD_GROUP}~k2`,
        'line:l1': `${AD_GROUP}~a1`,
      });
      expect(google.queries[0]).toContain(`op:(${nameTag('u1', 'ad_group:g1').slice(4, -1)})`);
    });

    it('should leave out a paused Line still being written, and refuse an active one', async (): Promise<void> => {
      await sync.apply(
        context(),
        desired({
          objects: {
            'ad_group:g1': { bidStrategy: 'maximize_clicks' },
            'targeting_group:t1': { bidStrategy: 'maximize_clicks' },
            'line:l1': { creative: null, status: 'paused' },
          },
        }),
        {}
      );
      expect(google.operations().some((operation) => 'adGroupAdOperation' in operation)).toBe(false);
      // Under maximized clicks the ad group bids nothing of its own.
      expect(google.mutations[0]).toContainEqual({
        adGroupOperation: { create: expect.not.objectContaining({ cpcBidMicros: expect.anything() }) },
      });

      await expect(
        sync.apply(context(), desired({ objects: { 'line:l1': { creative: null } } }), {})
      ).rejects.toMatchObject({ options: { messageCode: 'google_ad_incomplete' } });
    });

    it('should send a keyword asked twice once', async (): Promise<void> => {
      const twice: DesiredObject = object('keyword:k3', 'keyword', {
        parentKey: 'targeting_group:t1',
        keyword: { id: 'k3', text: 'Lit chêne', matchType: 'exact', negative: false },
      });

      await sync.apply(context(), desired({ extra: [twice] }), {});

      expect(google.mutations[0].filter((operation) => 'adGroupCriterionOperation' in operation)).toHaveLength(2);
    });

    it('should create a campaign that holds no ad group yet, beside another', async (): Promise<void> => {
      const split: DesiredObject = object('split:targeting_group:t2', 'campaign', { dailyBudgetMicros: 2_000_000 });

      await sync.apply(context(), desired({ extra: [split] }), {});

      expect(google.mutations[0].filter((operation) => 'campaignOperation' in operation)).toHaveLength(2);

      // Alone, it is read back as the status of the unit.
      google.mutations.length = 0;
      const result: ApplyResult = await sync.apply(context(), desired({ unit: { objects: [split] } }), {});
      expect(google.mutations[0].map((operation) => Object.keys(operation)[0])).toEqual([
        'campaignBudgetOperation',
        'campaignOperation',
        'assetOperation',
        'campaignAssetOperation',
      ]);
      expect(result.appliedStatus).toBe('active');
    });

    it('should create a campaign already begun, or past its end, without the dates Google refuses', async (): Promise<void> => {
      await sync.apply(
        context(),
        desired({ objects: { 'ad_group:g1': { startsOn: '2027-01-04', endsOn: '2027-01-03' } } }),
        {}
      );

      const created = google.mutations[0].find((operation) => 'campaignOperation' in operation) as {
        campaignOperation: { create: object };
      };
      expect(created.campaignOperation.create).not.toHaveProperty('startDateTime');
      expect(created.campaignOperation.create).not.toHaveProperty('endDateTime');
    });

    it('should create a TargetingGroup as one campaign holding its own ad group, as Google projects it (D55)', async (): Promise<void> => {
      const unit: DesiredUnit = desired({
        unit: {
          objects: [
            object('targeting_group:t1', 'campaign', {
              name: 'Île-de-France',
              dailyBudgetMicros: 10_000_000,
              bidMicros: 500_000,
              targeting: { country: { include: ['FR'], exclude: [] } },
            }),
            object('keyword:k1', 'keyword', {
              parentKey: 'targeting_group:t1',
              bidStrategy: null,
              keyword: { id: 'k1', text: 'lit chêne', matchType: 'exact', negative: false },
            }),
            object('line:l1', 'ad', {
              parentKey: 'targeting_group:t1',
              landingPageUrl: 'https://herbea.test/lits',
              creative: { versionId: 'v1', format: 'search_text', subtype: 'rsa', payload: RSA, assets: [] },
            }),
          ],
        },
      });

      const result: ApplyResult = await sync.apply(context(), unit, {});

      expect(google.mutations[0].map((operation) => Object.keys(operation)[0])).toEqual([
        'campaignBudgetOperation',
        'campaignOperation',
        'campaignCriterionOperation',
        'adGroupOperation',
        'adGroupCriterionOperation',
        'adGroupAdOperation',
        'assetOperation',
        'campaignAssetOperation',
      ]);
      expect(google.mutations[0][3]).toMatchObject({
        adGroupOperation: {
          create: { name: `Île-de-France ${nameTag('u1', 'targeting_group:t1#ad_group')}`, cpcBidMicros: '500000' },
        },
      });
      expect(result.refs).toMatchObject({
        'targeting_group:t1': `customers/${CID}/made/1-1`,
        'targeting_group:t1#ad_group': `customers/${CID}/made/1-3`,
        'keyword:k1': `customers/${CID}/made/1-4`,
        'line:l1': `customers/${CID}/made/1-5`,
      });
      expect(result.appliedStatus).toBe('active');
    });

    it('should answer no status for a unit that holds no campaign', async (): Promise<void> => {
      const result: ApplyResult = await sync.apply(context(), desired({ unit: { objects: [] } }), {});

      expect(result).toEqual({ refs: {}, appliedStatus: null, submitted: [] });
      expect(google.mutate).not.toHaveBeenCalled();
    });

    it('should read a paused campaign back as paused', async (): Promise<void> => {
      google.rows.status = [];

      expect((await sync.apply(context(), desired(), {})).appliedStatus).toBe('paused');
    });
  });

  describe('a unit Google holds', () => {
    beforeEach((): void => {
      existing(google);
    });

    it('should send nothing when Google already holds what is wanted', async (): Promise<void> => {
      const result: ApplyResult = await sync.apply(context(), desired(), REFS);

      expect(google.mutate).not.toHaveBeenCalled();
      expect(result.refs).toMatchObject(REFS);
      expect(google.queries.some((query) => query.includes('REGEXP_MATCH'))).toBe(false);
    });

    it('should send only what changed, the pauses first and the activations last', async (): Promise<void> => {
      google.rows.ad.push({
        adGroupAd: {
          resourceName: `${AD_GROUP}~old`,
          adGroup: AD_GROUP,
          status: 'ENABLED',
          ad: { urlCustomParameters: [{ key: 'mskey', value: 'gone' }] },
        },
      });
      google.rows.keyword.push(
        {
          adGroupCriterion: {
            resourceName: `${AD_GROUP}~old-positive`,
            adGroup: AD_GROUP,
            status: 'ENABLED',
            keyword: { text: 'ancien', matchType: 'PHRASE' },
          },
        },
        {
          adGroupCriterion: {
            resourceName: `${AD_GROUP}~old-paused`,
            adGroup: AD_GROUP,
            status: 'PAUSED',
            keyword: { text: 'endormi', matchType: 'PHRASE' },
          },
        },
        {
          adGroupCriterion: {
            resourceName: `${AD_GROUP}~old-negative`,
            adGroup: AD_GROUP,
            negative: true,
            keyword: { text: 'occasion', matchType: 'BROAD' },
          },
        }
      );
      google.rows.campaign[0].campaign = { ...google.rows.campaign[0].campaign, status: 'PAUSED' };
      // What Google answers half: a criterion of no campaign, a keyword with no term, a link with no asset,
      // an ad of nobody's; and a country no node targets any more.
      google.rows.criterion.push({});
      google.rows.criterion.push({
        campaignCriterion: {
          resourceName: `${CAMPAIGN}~be`,
          campaign: CAMPAIGN,
          location: { geoTargetConstant: 'geoTargetConstants/2056' },
        },
      });
      google.rows.ad.push({
        adGroupAd: { resourceName: `${AD_GROUP}~nobody`, adGroup: AD_GROUP, status: 'PAUSED', ad: {} },
      });
      google.rows.keyword.push({
        adGroupCriterion: { resourceName: `${AD_GROUP}~junk`, adGroup: AD_GROUP, status: 'PAUSED' },
      });
      google.rows.link.push({
        campaignAsset: { resourceName: `${CAMPAIGN}~x`, campaign: CAMPAIGN, fieldType: 'CALLOUT' },
      });

      const result: ApplyResult = await sync.apply(
        context(),
        desired({
          objects: {
            'ad_group:g1': {
              name: 'Paris',
              dailyBudgetMicros: 12_000_000,
              bidStrategy: 'maximize_clicks',
              bidMicros: 900_000,
            },
            'targeting_group:t1': {
              name: 'IDF',
              bidMicros: 700_000,
              bidStrategy: 'max_cpc',
              targeting: {
                country: { include: ['FR'], exclude: [] },
                proximity: { points: [{ latitude: 48.85, longitude: 2.35, radiusKm: 5, countryCode: 'FR' }] },
                device: { include: ['mobile'], exclude: [] },
              },
            },
            'keyword:k1': { status: 'paused' },
            'line:l1': {
              status: 'paused',
              creative: {
                versionId: 'v2',
                format: 'search_text',
                subtype: 'rsa',
                payload: { ...RSA, headlines: ['Lits', 'Chêne', 'Neuf'], businessName: 'Herbéa' },
                assets: [LOGO],
              },
            },
          },
          unit: {
            settings: { searchPartners: false, aiMax: true },
            locationIntent: 'presence_or_interest',
            extensions: {
              sitelinks: [{ text: 'Nos lits', finalUrl: 'https://herbea.test/lits' }],
              callouts: [],
              structuredSnippets: [],
            },
          },
        }),
        REFS
      );

      expect(google.mutations).toHaveLength(1);
      const operations: GoogleMutateOperation[] = google.mutations[0];
      const pauses = operations.slice(0, 4);
      expect(pauses).toEqual(
        expect.arrayContaining([
          {
            adGroupCriterionOperation: {
              update: { resourceName: `${AD_GROUP}~k1`, status: 'PAUSED' },
              updateMask: 'status',
            },
          },
          {
            adGroupCriterionOperation: {
              update: { resourceName: `${AD_GROUP}~old-positive`, status: 'PAUSED' },
              updateMask: 'status',
            },
          },
          {
            adGroupAdOperation: { update: { resourceName: `${AD_GROUP}~a1`, status: 'PAUSED' }, updateMask: 'status' },
          },
          {
            adGroupAdOperation: { update: { resourceName: `${AD_GROUP}~old`, status: 'PAUSED' }, updateMask: 'status' },
          },
        ])
      );
      expect(operations[operations.length - 1]).toEqual({
        campaignOperation: { update: { resourceName: CAMPAIGN, status: 'ENABLED' }, updateMask: 'status' },
      });
      expect(operations).toContainEqual({
        campaignBudgetOperation: {
          update: { resourceName: `customers/${CID}/campaignBudgets/33`, amountMicros: '12000000' },
          updateMask: 'amount_micros',
        },
      });
      expect(operations).toContainEqual(
        expect.objectContaining({
          campaignOperation: expect.objectContaining({
            updateMask:
              'name,network_settings.target_google_search,network_settings.target_search_network,' +
              'network_settings.target_content_network,network_settings.target_partner_search_network,' +
              'geo_target_type_setting.positive_geo_target_type,geo_target_type_setting.negative_geo_target_type,' +
              'ai_max_setting.enable_ai_max,target_spend.cpc_bid_ceiling_micros',
          }),
        })
      );
      expect(operations).toContainEqual({
        adGroupOperation: {
          update: {
            resourceName: AD_GROUP,
            name: `IDF ${nameTag('u1', 'targeting_group:t1')}`,
            cpcBidMicros: '700000',
          },
          updateMask: 'name,cpc_bid_micros',
        },
      });
      expect(operations).toContainEqual(
        expect.objectContaining({
          campaignCriterionOperation: { create: expect.objectContaining({ proximity: expect.anything() }) },
        })
      );
      expect(operations).not.toContainEqual({ adGroupBidModifierOperation: { remove: `${AD_GROUP}~m` } });
      expect(operations).toContainEqual({
        adGroupBidModifierOperation: { create: { adGroup: AD_GROUP, device: { type: 'DESKTOP' }, bidModifier: 0 } },
      });
      expect(operations).toContainEqual({ adGroupCriterionOperation: { remove: `${AD_GROUP}~old-negative` } });
      expect(operations).not.toContainEqual(
        expect.objectContaining({
          adGroupCriterionOperation: expect.objectContaining({
            update: expect.objectContaining({ resourceName: `${AD_GROUP}~old-paused` }),
          }),
        })
      );
      expect(operations).toContainEqual(
        expect.objectContaining({
          adOperation: expect.objectContaining({
            update: expect.objectContaining({ resourceName: `customers/${CID}/ads/a1` }),
          }),
        })
      );
      // The ad rewritten goes back to Google's review.
      expect(result.submitted).toEqual(['line:l1']);
      expect(operations).toContainEqual({ campaignAssetOperation: { remove: `${CAMPAIGN}~c1` } });
      expect(operations).toContainEqual({ campaignAssetOperation: { remove: `${CAMPAIGN}~x` } });
      expect(operations).toContainEqual({ campaignCriterionOperation: { remove: `${CAMPAIGN}~be` } });
      // France is replaced by its circle, never sent beside it: Google would serve the whole country (D57).
      expect(operations).toContainEqual({ campaignCriterionOperation: { remove: `${CAMPAIGN}~1` } });
      expect(operations).not.toContainEqual(
        expect.objectContaining({
          adGroupAdOperation: expect.objectContaining({
            update: expect.objectContaining({ resourceName: `${AD_GROUP}~nobody` }),
          }),
        })
      );
      expect(operations).toContainEqual(
        expect.objectContaining({
          assetOperation: { create: expect.objectContaining({ sitelinkAsset: { linkText: 'Nos lits' } }) },
        })
      );
    });

    it('should move a start still to come, and leave one already begun', async (): Promise<void> => {
      await sync.apply(
        context(),
        desired({ objects: { 'ad_group:g1': { startsOn: '2027-01-06', endsOn: '2027-01-12' } } }),
        REFS
      );
      expect(google.mutations[0]).toContainEqual({
        campaignOperation: {
          update: { resourceName: CAMPAIGN, startDateTime: '2027-01-06 00:00:00', endDateTime: '2027-01-12 23:59:59' },
          updateMask: 'start_date_time,end_date_time',
        },
      });

      google.mutations.length = 0;
      google.rows.campaign[0].campaign = { ...google.rows.campaign[0].campaign, startDateTime: '2027-01-01 00:00:00' };
      // An end already passed is never sent either.
      await sync.apply(
        context(),
        desired({ objects: { 'ad_group:g1': { startsOn: '2027-01-06', endsOn: '2027-01-03' } } }),
        REFS
      );
      expect(google.mutations).toEqual([]);
    });

    it('should switch a campaign to maximized clicks, then follow its ceiling', async (): Promise<void> => {
      const clicks = desired({
        objects: {
          'ad_group:g1': { bidStrategy: 'maximize_clicks', bidMicros: 900_000 },
          'targeting_group:t1': { bidStrategy: 'maximize_clicks' },
        },
      });
      google.rows.campaign[0].campaign = {
        ...google.rows.campaign[0].campaign,
        biddingStrategyType: 'TARGET_SPEND',
        targetSpend: { cpcBidCeilingMicros: '900000' },
        // A start Google does not say is never moved.
        startDateTime: undefined,
      };

      await sync.apply(context(), clicks, REFS);
      expect(google.mutate).not.toHaveBeenCalled();

      google.rows.campaign[0].campaign = {
        ...google.rows.campaign[0].campaign,
        biddingStrategyType: 'MAXIMIZE_CONVERSIONS',
      };
      await sync.apply(context(), desired(), REFS);
      expect(google.mutations[0]).toContainEqual({
        campaignOperation: {
          update: { resourceName: CAMPAIGN, manualCpc: { enhancedCpcEnabled: false } },
          updateMask: 'manual_cpc.enhanced_cpc_enabled',
        },
      });
    });

    it('should pause an ad group no TargetingGroup stands for, and one whose node is paused', async (): Promise<void> => {
      google.rows.adGroup.push({
        adGroup: {
          resourceName: `${AD_GROUP}9`,
          campaign: CAMPAIGN,
          name: 'Ancien [op:000000000000]',
          status: 'ENABLED',
        },
      });
      google.rows.adGroup.push({
        adGroup: {
          resourceName: `${AD_GROUP}8`,
          campaign: CAMPAIGN,
          name: 'Endormi [op:111111111111]',
          status: 'PAUSED',
        },
      });
      // Read first, so the search of the ad group of the node meets an ad group with no name.
      google.rows.adGroup.unshift({ adGroup: { resourceName: `${AD_GROUP}7`, campaign: CAMPAIGN, status: 'PAUSED' } });

      await sync.apply(context(), desired({ objects: { 'targeting_group:t1': { status: 'paused' } } }), REFS);

      expect(google.mutations[0]).toContainEqual({
        adGroupOperation: { update: { resourceName: `${AD_GROUP}9`, status: 'PAUSED' }, updateMask: 'status' },
      });
      expect(google.mutations[0]).toContainEqual({
        adGroupOperation: { update: { resourceName: AD_GROUP, status: 'PAUSED' }, updateMask: 'status' },
      });
      expect(google.mutations[0]).not.toContainEqual(
        expect.objectContaining({
          adGroupOperation: expect.objectContaining({
            update: expect.objectContaining({ resourceName: `${AD_GROUP}8` }),
          }),
        })
      );
    });

    it('should enable a keyword and an ad whose node is active again, last', async (): Promise<void> => {
      google.rows.keyword[0].adGroupCriterion = { ...google.rows.keyword[0].adGroupCriterion, status: 'PAUSED' };
      google.rows.ad[0].adGroupAd = { ...google.rows.ad[0].adGroupAd, status: 'PAUSED' };
      google.rows.adGroup[0].adGroup = { ...google.rows.adGroup[0].adGroup, status: 'PAUSED' };

      await sync.apply(context(), desired(), REFS);

      expect(google.mutations[0].map((operation) => JSON.stringify(operation))).toEqual(
        [
          { adGroupOperation: { update: { resourceName: AD_GROUP, status: 'ENABLED' }, updateMask: 'status' } },
          {
            adGroupCriterionOperation: {
              update: { resourceName: `${AD_GROUP}~k1`, status: 'ENABLED' },
              updateMask: 'status',
            },
          },
          {
            adGroupAdOperation: { update: { resourceName: `${AD_GROUP}~a1`, status: 'ENABLED' }, updateMask: 'status' },
          },
        ].map((operation) => JSON.stringify(operation))
      );
    });

    it('should fill a campaign that holds nothing yet but its ad group', async (): Promise<void> => {
      google.rows.criterion = [];
      google.rows.keyword = [];
      google.rows.ad = [];
      google.rows.modifier = [];
      google.rows.link = [];

      await sync.apply(context(), desired(), REFS);

      expect(google.mutations[0].map((operation) => Object.keys(operation)[0])).toEqual([
        'campaignCriterionOperation',
        'adGroupBidModifierOperation',
        'adGroupCriterionOperation',
        'adGroupCriterionOperation',
        'adGroupAdOperation',
        'assetOperation',
        'campaignAssetOperation',
      ]);
    });

    it('should create an ad group, an ad and a keyword new to a campaign that exists', async (): Promise<void> => {
      google.rows.adGroup = [];
      google.rows.keyword = [];
      google.rows.ad = [];
      google.rows.modifier = [];

      const result: ApplyResult = await sync.apply(context(), desired(), REFS);

      expect(google.mutations[0].map((operation) => Object.keys(operation)[0])).toEqual([
        'adGroupOperation',
        'adGroupBidModifierOperation',
        'adGroupCriterionOperation',
        'adGroupCriterionOperation',
        'adGroupAdOperation',
      ]);
      expect(result.refs['targeting_group:t1']).toBe(`customers/${CID}/made/1-0`);
    });

    it('should pause a campaign no object stands for any more, and leave one already paused or gone', async (): Promise<void> => {
      const OLD = `customers/${CID}/campaigns/99`;
      const SLEEPING = `customers/${CID}/campaigns/98`;
      google.rows.campaign.push(
        { campaign: { resourceName: OLD, status: 'ENABLED' } },
        { campaign: { resourceName: SLEEPING, status: 'PAUSED' } }
      );

      await sync.apply(context(), desired(), {
        ...REFS,
        'split:targeting_group:t9': OLD,
        'split:targeting_group:t8': SLEEPING,
        'split:targeting_group:t7': `customers/${CID}/campaigns/97`,
      });

      expect(google.mutations[0]).toEqual([
        { campaignOperation: { update: { resourceName: OLD, status: 'PAUSED' }, updateMask: 'status' } },
      ]);
    });

    it('should refuse a campaign removed outside Omnipotent, rather than create it again', async (): Promise<void> => {
      google.rows.campaign = [];

      await expect(sync.apply(context(), desired(), REFS)).rejects.toMatchObject({
        options: { messageCode: 'google_campaign_removed', messageParams: { campaign: 'Grand Paris' } },
      });
      expect(google.mutate).not.toHaveBeenCalled();
    });
  });

  describe('the brand', () => {
    it('should find an image already uploaded by the tag of its name, rather than upload it twice', async (): Promise<void> => {
      google.rows.image = [{ asset: { resourceName: `customers/${CID}/assets/77` } }];
      const readAsset = jest.fn();

      const result: ApplyResult = await sync.apply(context(readAsset), desired(), {});

      expect(readAsset).not.toHaveBeenCalled();
      expect(result.refs['image:abcdef0123456789abcdef']).toBe(`customers/${CID}/assets/77`);
      expect(google.queries).toContainEqual(expect.stringContaining("asset.name LIKE '%op:abcdef0123456789%'"));
    });

    it('should not look for an image refs already names', async (): Promise<void> => {
      const result: ApplyResult = await sync.apply(context(), desired(), {
        'image:abcdef0123456789abcdef': 'customers/1/assets/5',
      });

      expect(google.queries.some((query) => query.includes('FROM asset WHERE'))).toBe(false);
      expect(google.mutations[google.mutations.length - 1]).toEqual([
        {
          campaignAssetOperation: {
            create: { campaign: result.refs['ad_group:g1'], asset: 'customers/1/assets/5', fieldType: 'BUSINESS_LOGO' },
          },
        },
      ]);
    });

    it('should keep a refusal Google will not change its mind on, and never send that asset again', async (): Promise<void> => {
      google.failures = [null, googleRefusal(false), null, null];

      const result: ApplyResult = await sync.apply(context(), desired(), {});

      const refused = Object.entries(result.refs).filter(([, value]) => value === '');
      expect(refused.map(([key]) => key)).toEqual([`brand:${JSON.stringify(['BUSINESS_NAME', 'Herbéa'])}`]);

      google.mutations.length = 0;
      const [[key]] = refused;
      await sync.apply(context(), desired(), { [key]: '' });
      expect(google.operations().some((operation) => JSON.stringify(operation).includes('textAsset'))).toBe(false);
    });

    it('should let a refusal that waiting can mend through, and one of our own credentials', async (): Promise<void> => {
      google.failures = [null, googleRefusal(true)];
      await expect(sync.apply(context(), desired(), {})).rejects.toMatchObject({ options: { retryable: true } });

      const ours = new PlatformError('google_ads', 'Ours', {
        statusCode: 401,
        retryable: false,
        invalidCredentials: true,
        ownCredentials: true,
        requestId: null,
      });
      google.mutations.length = 0;
      google.failures = [null, ours];
      await expect(sync.apply(context(), desired(), {})).rejects.toBe(ours);

      google.failures = [null, new Error('boom')];
      await expect(sync.apply(context(), desired(), {})).rejects.toThrow('boom');
    });
  });
});
