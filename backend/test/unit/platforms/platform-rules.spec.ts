import {
  acceptsCreative,
  PLATFORM_RULES,
  PlatformRules,
  leversOf,
  projectionOf,
  rulesOf,
  supportedPlatforms,
  unsupportedDimensions,
} from '@src/platforms/platform-rules';
import { errorCodeOf, statusCodeOf } from '@utils';

describe('Unit::Platforms::PlatformRules', () => {
  /** The registry, writable, so a test can declare a couple as a phase would. */
  const registry: Record<string, Record<string, PlatformRules>> = PLATFORM_RULES as Record<
    string,
    Record<string, PlatformRules>
  >;

  /**
   * The rules a phase would declare, accepting nothing: a case adds what it needs.
   *
   * @param label - Display name of the platform
   * @param overrides - What this case declares
   * @returns The rules
   */
  function rules(label: string, overrides: Partial<PlatformRules> = {}): PlatformRules {
    return {
      label,
      targeting: [],
      creatives: [],
      projection: {
        levels: { campaign: null, lever: null, ad_group: 'campaign', targeting_group: 'ad_group', line: 'ad' },
        budgetLevel: 'ad_group',
      },
      requiresClickThroughUrl: false,
      requiresIabCategories: false,
      minDailyBudgetCents: 0,
      bidStrategies: ['max_cpc', 'maximize_clicks', 'maximize_conversions', 'cpm'],
      sharedTargeting: [],
      maxActiveAds: null,
      settings: {},
      locationIntent: false,
      extensions: false,
      geo: { levels: [], excludedLevels: [], maxRadii: null },
      ...overrides,
    };
  }

  afterEach((): void => {
    for (const platform of Object.keys(registry)) Reflect.deleteProperty(registry, platform);
  });

  it('should declare Google Ads on Search as phase 10 lands it', (): void => {
    // The first case of the file: the registry is still the one the code declares.
    expect(supportedPlatforms()).toEqual(['google_ads']);
    expect(rulesOf('google_ads', 'search')).toMatchObject({
      creatives: ['search_text:rsa'],
      // One TargetingGroup, one Google campaign with its ad group (D55).
      projection: {
        levels: { ad_group: null, targeting_group: 'campaign', line: 'ad' },
        budgetLevel: 'targeting_group',
      },
      requiresClickThroughUrl: true,
      bidStrategies: ['max_cpc', 'maximize_clicks'],
      sharedTargeting: [],
      maxActiveAds: 3,
      settings: { searchPartners: true, aiMax: false },
      locationIntent: true,
      extensions: true,
      // The places of the referential and the circles, every level in both ways (D57).
      targeting: ['country', 'location', 'proximity', 'device'],
      geo: {
        levels: ['region', 'department', 'city', 'postal_code'],
        excludedLevels: ['region', 'department', 'city', 'postal_code'],
        maxRadii: 500,
      },
    });
  });

  it('should be keyed by the couple (platform, lever), never by the platform alone', (): void => {
    // leviers.md L2 and faisabilite-search.md F11: the same platform accepts different things on
    // different levers, so a phase declares one entry per couple.
    registry.dv360 = { ctv_tvs: rules('DV360'), audio: rules('DV360') };

    expect(supportedPlatforms()).toEqual(['dv360']);
    expect(leversOf('dv360')).toEqual(['audio', 'ctv_tvs']);
    expect(rulesOf('dv360', 'audio')).toEqual(rules('DV360'));
  });

  describe('supportedPlatforms', () => {
    it('should name every platform of the registry, sorted', (): void => {
      registry.hawk = { dooh: rules('Hawk') };
      registry.dv360 = { dac: rules('DV360') };

      expect(supportedPlatforms()).toEqual(['dv360', 'hawk']);
    });
  });

  describe('leversOf', () => {
    it('should answer nothing for a platform no connector declares', (): void => {
      expect(leversOf('google_ads')).toEqual([]);
    });
  });

  describe('rulesOf', () => {
    it('should refuse a platform no connector declares with 400 platform_unknown', (): void => {
      let error: unknown;
      try {
        rulesOf('google_ads', 'search');
      } catch (thrown: unknown) {
        error = thrown;
      }

      expect(statusCodeOf(error)).toBe(400);
      expect(errorCodeOf(error)).toEqual({ code: 'platform_unknown', params: { platform: 'google_ads' } });
      expect((error as Error).message).toBe('Unknown platform google_ads');
    });

    it('should refuse a lever the platform has no connector for', (): void => {
      registry.amazon_dsp = { ctv_tvs: rules('Amazon DSP') };

      // L27: Amazon DSP left the audio lever, so the couple does not exist.
      let error: unknown;
      try {
        rulesOf('amazon_dsp', 'audio');
      } catch (thrown: unknown) {
        error = thrown;
      }

      expect(statusCodeOf(error)).toBe(400);
      expect(errorCodeOf(error)).toEqual({
        code: 'platform_lever_unsupported',
        params: { platform: 'amazon_dsp', lever: 'audio' },
      });
      expect((error as Error).message).toBe('amazon_dsp has no connector for the audio lever');
    });

    it('should answer the rules of a declared couple', (): void => {
      registry.hawk = { dooh: rules('Hawk') };

      expect(rulesOf('hawk', 'dooh')).toEqual(rules('Hawk'));
    });
  });

  describe('unsupportedDimensions', () => {
    it('should name what the couple cannot express, among what the node asks for', (): void => {
      registry.hawk = { dooh: rules('Hawk', { targeting: ['screen', 'country', 'schedule'] }) };

      expect(unsupportedDimensions('hawk', 'dooh', ['country', 'browser', 'viewability'])).toEqual([
        'browser',
        'viewability',
      ]);
      expect(unsupportedDimensions('hawk', 'dooh', ['country', 'screen'])).toEqual([]);
    });

    it('should refuse to answer for a couple no connector declares', (): void => {
      expect((): unknown => unsupportedDimensions('hawk', 'dooh', ['country'])).toThrow(
        expect.objectContaining({ statusCode: 400 })
      );
    });
  });

  describe('what a couple makes of our tree', () => {
    it('should answer the projection and the level that holds the budget', (): void => {
      registry.google_ads = {
        search: rules('Google Ads', {
          projection: {
            levels: { campaign: null, lever: null, ad_group: 'campaign', targeting_group: 'ad_group', line: 'ad' },
            budgetLevel: 'ad_group',
          },
        }),
      };

      // What multi-search proves today: our AdGroup is a Google campaign, which is where the budget
      // sits, and our TargetingGroup is one of its ad groups (`../../CADRAGE.md` § 7).
      expect(projectionOf('google_ads', 'search')).toEqual({
        levels: { campaign: null, lever: null, ad_group: 'campaign', targeting_group: 'ad_group', line: 'ad' },
        budgetLevel: 'ad_group',
      });
    });

    it('should say which creative couples it accepts', (): void => {
      registry.hawk = { dooh: rules('Hawk', { creatives: ['display:image', 'video:file'] }) };

      expect(acceptsCreative('hawk', 'dooh', 'display', 'image')).toBe(true);
      // Hawk has no type for a DOOH native, so the couple is simply absent (G6).
      expect(acceptsCreative('hawk', 'dooh', 'native', 'assets')).toBe(false);
    });

    it('should refuse to answer for a couple no connector declares', (): void => {
      expect((): unknown => projectionOf('hawk', 'dooh')).toThrow(expect.objectContaining({ statusCode: 400 }));
      expect((): unknown => acceptsCreative('hawk', 'dooh', 'display', 'image')).toThrow(
        expect.objectContaining({ statusCode: 400 })
      );
    });
  });
});
