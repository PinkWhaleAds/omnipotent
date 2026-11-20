import {
  DesiredInput,
  DesiredNode,
  DesiredObject,
  desiredUnit,
  DesiredUnit,
  fingerprint,
  MICROS_PER_CENT,
  structureOf,
  toMicros,
} from '@src/platforms/desired-state';
import { PlatformProjection } from '@src/platforms/platform-rules';

/** What Google does with our tree: the AdGroup is a campaign and holds the budget. */
const SEARCH_SHAPE: PlatformProjection = {
  levels: { campaign: null, lever: null, ad_group: 'campaign', targeting_group: 'ad_group', line: 'ad' },
  budgetLevel: 'ad_group',
};

/**
 * One node of the tree with everything a platform needs from it.
 *
 * @param level - Its level
 * @param id - Its id
 * @param overrides - What this case declares
 * @returns The node
 */
function node(level: DesiredNode['level'], id: string, overrides: Partial<DesiredNode> = {}): DesiredNode {
  return {
    level,
    id,
    name: id,
    status: 'active',
    startsOn: '2027-01-01',
    endsOn: '2027-01-07',
    budgetCents: null,
    dailyBudgetCents: null,
    averageDailyCents: null,
    bidAmountCents: null,
    bidStrategy: null,
    capping: null,
    targeting: null,
    creative: null,
    landingPageUrl: null,
    trackers: null,
    keywords: [],
    children: [],
    ...overrides,
  };
}

/**
 * The branch of one unit: our campaign down to one Line.
 *
 * @param overrides - What each level declares
 * @returns The campaign node
 */
function branch(
  overrides: {
    campaign?: Partial<DesiredNode>;
    adGroup?: Partial<DesiredNode>;
    targetingGroup?: Partial<DesiredNode>;
    line?: Partial<DesiredNode>;
  } = {}
): DesiredNode {
  return node('campaign', 'c1', {
    name: 'Automne',
    budgetCents: 100_000,
    ...overrides.campaign,
    children: [
      node('lever', 'v1', {
        children: [
          node('ad_group', 'g1', {
            dailyBudgetCents: 1_000,
            averageDailyCents: 1_400,
            ...overrides.adGroup,
            children: [
              node('targeting_group', 't1', {
                ...overrides.targetingGroup,
                children: [node('line', 'l1', overrides.line)],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

/**
 * The input of the desired state.
 *
 * @param overrides - What this case declares
 * @returns The input
 */
function input(overrides: Partial<DesiredInput> = {}): DesiredInput {
  return {
    unitId: 'u1',
    platform: 'google_ads',
    lever: 'search',
    adGroupId: 'g1',
    projection: SEARCH_SHAPE,
    campaign: branch(),
    insertionOrderNumber: null,
    containsPoliticalAdvertising: false,
    settings: { searchPartners: true },
    extensions: null,
    locationIntent: 'presence',
    currency: 'EUR',
    timezone: 'Europe/Paris',
    fxRate: 1,
    live: true,
    started: true,
    // Inside the window every node of `branch()` declares.
    today: '2027-01-03',
    minDailyBudgetCents: 0,
    ...overrides,
  };
}

/** The object of one key. */
function objectOf(desired: DesiredUnit, key: string): DesiredObject {
  return desired.objects.find((object: DesiredObject): boolean => object.key === key) as DesiredObject;
}

describe('Unit::Platforms::DesiredState', () => {
  describe('fingerprint', () => {
    it('should be stable for the same value, and differ for another', (): void => {
      expect(fingerprint({ a: 1 })).toBe(fingerprint({ a: 1 }));
      expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
      expect(fingerprint({ a: 1 }, 16)).toHaveLength(16);
    });
  });

  describe('toMicros', () => {
    it('should convert cents of the campaign currency into micros of the account one', (): void => {
      expect(toMicros(1_000, 1)).toBe(1_000 * MICROS_PER_CENT);
      // Rounded to the cent of the account currency before being blown up to micros: a platform
      // refuses a fraction of a cent, and the rounding must not hide inside the micros.
      expect(toMicros(1_000, 1.1234)).toBe(1_123 * MICROS_PER_CENT);
    });
  });

  describe('structureOf', () => {
    it('should keep only what the projection reads', (): void => {
      const structure = structureOf(branch({ targetingGroup: { keywords: [kw('k1')] } }));

      expect(structure).toEqual({
        level: 'campaign',
        id: 'c1',
        budgetCents: 100_000,
        keywordIds: [],
        children: [
          {
            level: 'lever',
            id: 'v1',
            budgetCents: null,
            keywordIds: [],
            children: [
              {
                level: 'ad_group',
                id: 'g1',
                budgetCents: null,
                keywordIds: [],
                children: [
                  {
                    level: 'targeting_group',
                    id: 't1',
                    budgetCents: null,
                    keywordIds: ['k1'],
                    children: [{ level: 'line', id: 'l1', budgetCents: null, keywordIds: [], children: [] }],
                  },
                ],
              },
            ],
          },
        ],
      });
    });
  });

  describe('desiredUnit', () => {
    it('should answer the projected objects with what each must hold', (): void => {
      const { desired, hash } = desiredUnit(input());

      expect(desired).toMatchObject({
        unitId: 'u1',
        platform: 'google_ads',
        lever: 'search',
        adGroupId: 'g1',
        status: 'active',
        campaignId: 'c1',
        campaignName: 'Automne',
        containsPoliticalAdvertising: false,
        settings: { searchPartners: true },
        extensions: null,
        locationIntent: 'presence',
        currency: 'EUR',
        timezone: 'Europe/Paris',
      });
      expect(desired.objects.map((object: DesiredObject): string => object.key)).toEqual([
        'ad_group:g1',
        'targeting_group:t1',
        'line:l1',
      ]);
      expect(hash).toHaveLength(64);
    });

    it('should put the budget on the level the platform holds one, and nowhere else', (): void => {
      const { desired } = desiredUnit(input());

      expect(objectOf(desired, 'ad_group:g1').dailyBudgetMicros).toBe(1_000 * MICROS_PER_CENT);
      expect(objectOf(desired, 'targeting_group:t1').dailyBudgetMicros).toBeNull();
      expect(objectOf(desired, 'line:l1').dailyBudgetMicros).toBeNull();
    });

    it('should convert every amount at the frozen rate', (): void => {
      const { desired } = desiredUnit(
        input({ campaign: branch({ adGroup: { dailyBudgetCents: 1_000, bidAmountCents: 250 } }), fxRate: 2 })
      );

      expect(objectOf(desired, 'ad_group:g1').dailyBudgetMicros).toBe(2_000 * MICROS_PER_CENT);
      expect(objectOf(desired, 'ad_group:g1').bidMicros).toBe(500 * MICROS_PER_CENT);
    });

    it('should send a paused object the larger of the platform floor and the planned average', (): void => {
      const paused = input({
        campaign: branch({ adGroup: { status: 'paused', dailyBudgetCents: 1_000, averageDailyCents: 1_400 } }),
        minDailyBudgetCents: 2_000,
      });

      // A platform refuses a budget under its minimum even on something that is not delivering, and
      // sending its real zero would make the next resume start from zero.
      expect(objectOf(desiredUnit(paused).desired, 'ad_group:g1').dailyBudgetMicros).toBe(2_000 * MICROS_PER_CENT);
      expect(
        objectOf(desiredUnit({ ...paused, minDailyBudgetCents: 100 }).desired, 'ad_group:g1').dailyBudgetMicros
      ).toBe(1_400 * MICROS_PER_CENT);
    });

    it('should pause an object whose budget of today is nothing', (): void => {
      const { desired } = desiredUnit(
        input({ campaign: branch({ adGroup: { dailyBudgetCents: 0, averageDailyCents: 1_400 } }) })
      );

      // What the pacing answers once the planned total is spent. A platform either refuses a zero
      // budget or, worse, keeps yesterday's amount.
      expect(objectOf(desired, 'ad_group:g1').status).toBe('paused');
      expect(objectOf(desired, 'line:l1').status).toBe('paused');
      expect(desired.status).toBe('paused');
    });

    it('should pause an object whose budget of today is under the platform floor', (): void => {
      const { desired } = desiredUnit(
        input({
          campaign: branch({ adGroup: { dailyBudgetCents: 500, averageDailyCents: 1_400 } }),
          minDailyBudgetCents: 1_000,
        })
      );

      expect(objectOf(desired, 'ad_group:g1').status).toBe('paused');
      // And it is sent the floor rather than its real amount, which the platform would refuse.
      expect(objectOf(desired, 'ad_group:g1').dailyBudgetMicros).toBe(1_400 * MICROS_PER_CENT);
    });

    it('should pause an object whose window has not started, and one whose window has ended', (): void => {
      expect(objectOf(desiredUnit(input({ today: '2026-12-31' })).desired, 'ad_group:g1').status).toBe('paused');
      expect(objectOf(desiredUnit(input({ today: '2027-01-08' })).desired, 'ad_group:g1').status).toBe('paused');
      expect(objectOf(desiredUnit(input({ today: '2027-01-07' })).desired, 'ad_group:g1').status).toBe('active');
    });

    it('should pause only the branch whose own window has ended', (): void => {
      const { desired } = desiredUnit(
        input({ campaign: branch({ targetingGroup: { startsOn: '2027-01-01', endsOn: '2027-01-02' } }) })
      );

      expect(objectOf(desired, 'ad_group:g1').status).toBe('active');
      expect(objectOf(desired, 'targeting_group:t1').status).toBe('paused');
      expect(objectOf(desired, 'line:l1').status).toBe('paused');
    });

    it('should pause everything below a paused node', (): void => {
      const { desired } = desiredUnit(input({ campaign: branch({ targetingGroup: { status: 'paused' } }) }));

      expect(objectOf(desired, 'ad_group:g1').status).toBe('active');
      expect(objectOf(desired, 'targeting_group:t1').status).toBe('paused');
      expect(objectOf(desired, 'line:l1').status).toBe('paused');
    });

    it('should pause everything, unit included, while the campaign is not active', (): void => {
      const { desired } = desiredUnit(input({ live: false }));

      expect(desired.status).toBe('paused');
      expect(desired.objects.every((object: DesiredObject): boolean => object.status === 'paused')).toBe(true);
    });

    it('should pause everything, unit included, until the start time has come', (): void => {
      // The time itself is never sent: the platforms hold the campaign paused until it.
      const { desired } = desiredUnit(input({ started: false }));

      expect(desired.status).toBe('paused');
      expect(desired.objects.every((object: DesiredObject): boolean => object.status === 'paused')).toBe(true);
    });

    it('should carry a keyword as itself, with the status of the node it hangs from', (): void => {
      const { desired } = desiredUnit(
        input({
          campaign: branch({ targetingGroup: { status: 'paused', keywords: [kw('k1')] } }),
        })
      );

      expect(objectOf(desired, 'keyword:k1')).toMatchObject({
        keywordId: 'k1',
        nodeId: 't1',
        object: 'keyword',
        status: 'paused',
        keyword: { id: 'k1', text: 'k1', matchType: 'exact', negative: false },
        dailyBudgetMicros: null,
      });
    });

    it('should give every object below the AdGroup the strategy it bids with, and none to a keyword', (): void => {
      const { desired } = desiredUnit(
        input({
          campaign: branch({ adGroup: { bidStrategy: 'maximize_clicks' }, targetingGroup: { keywords: [kw('k1')] } }),
        })
      );

      expect(objectOf(desired, 'ad_group:g1').bidStrategy).toBe('maximize_clicks');
      expect(objectOf(desired, 'targeting_group:t1').bidStrategy).toBe('maximize_clicks');
      expect(objectOf(desired, 'line:l1').bidStrategy).toBe('maximize_clicks');
      expect(objectOf(desired, 'keyword:k1').bidStrategy).toBeNull();
    });

    it('should let a node below the AdGroup say its own strategy', (): void => {
      const { desired } = desiredUnit(
        input({ campaign: branch({ adGroup: { bidStrategy: 'max_cpc' }, targetingGroup: { bidStrategy: 'cpm' } }) })
      );

      expect(objectOf(desired, 'ad_group:g1').bidStrategy).toBe('max_cpc');
      expect(objectOf(desired, 'line:l1').bidStrategy).toBe('cpm');
    });

    it('should carry what the user declared about political advertising', (): void => {
      expect(desiredUnit(input({ containsPoliticalAdvertising: true })).desired.containsPoliticalAdvertising).toBe(
        true
      );
    });

    it('should give the split object the budget of the node that caused it', (): void => {
      const { desired } = desiredUnit(
        input({
          campaign: branch({ targetingGroup: { budgetCents: 30_000, dailyBudgetCents: 500, averageDailyCents: 500 } }),
        })
      );

      expect(objectOf(desired, 'split:targeting_group:t1')).toMatchObject({
        level: 'ad_group',
        nodeId: 't1',
        split: true,
        dailyBudgetMicros: 500 * MICROS_PER_CENT,
      });
    });

    it('should change its fingerprint when anything a platform holds changes, and not otherwise', (): void => {
      const reference: string = desiredUnit(input()).hash;

      expect(desiredUnit(input()).hash).toBe(reference);
      expect(desiredUnit(input({ campaign: branch({ line: { name: 'Autre' } }) })).hash).not.toBe(reference);
      expect(desiredUnit(input({ campaign: branch({ adGroup: { dailyBudgetCents: 1_001 } }) })).hash).not.toBe(
        reference
      );
      expect(desiredUnit(input({ campaign: branch({ adGroup: { bidStrategy: 'max_cpc' } }) })).hash).not.toBe(
        reference
      );
      // The unit's own id is part of it: a platform tags its objects with it.
      expect(desiredUnit(input({ unitId: 'u2' })).hash).not.toBe(reference);
    });
  });
});

/**
 * One keyword.
 *
 * @param id - Its id, which doubles as its text here
 * @returns The keyword
 */
function kw(id: string): { id: string; text: string; matchType: 'exact'; negative: boolean } {
  return { id, text: id, matchType: 'exact', negative: false };
}
