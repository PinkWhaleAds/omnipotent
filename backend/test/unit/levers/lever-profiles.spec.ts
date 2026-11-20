import {
  allLevers,
  assertBidStrategyPermitted,
  assertDimensionPermitted,
  assertFieldAllowed,
  assertKeywordsPermitted,
  assertObjectivePermitted,
  assertPlatformEligible,
  assertSearchFieldPermitted,
  assertVolumeUnitPermitted,
  carriesBudget,
  defaultBidStrategyOf,
  defaultObjectiveOf,
  fieldRuleOf,
  LEVER_PROFILES,
  permitsDimension,
  targetingDimensionsOf,
  LeverProfile,
  profileOf,
} from '@src/levers/lever-profiles';
import { allDimensions } from '@src/targeting/dimensions';
import { BidStrategy, Lever, leverSchema, TargetingDimension, treeLevelSchema } from '@src/types';

/** The levers whose inventory is bought programmatically: the ones deals apply to (L7). */
const PROGRAMMATIC: Lever[] = ['dooh', 'audio', 'ctv_tvs', 'dac'];

/** The strategies that name a price per thousand, which a volume entry needs to convert (L25). */
const CPM_STRATEGIES: BidStrategy[] = ['cpm', 'fixed_cpm', 'from_deal'];

describe('Unit::Levers::LeverProfiles', () => {
  describe('the registry itself', () => {
    it('should declare a profile for every lever, and nothing else', (): void => {
      expect(Object.keys(LEVER_PROFILES).sort()).toEqual([...leverSchema.options].sort());
      expect(allLevers()).toEqual([...leverSchema.options]);
    });

    it('should rule every field at every level', (): void => {
      for (const lever of allLevers()) {
        for (const field of ['budget', 'dates', 'capping'] as const) {
          expect(Object.keys(profileOf(lever).rules[field]).sort()).toEqual([...treeLevelSchema.options].sort());
        }
      }
    });

    it('should permit the default strategy and the default objective it declares', (): void => {
      for (const lever of allLevers()) {
        const profile: LeverProfile = profileOf(lever);

        expect(profile.bidStrategies).toContain(defaultBidStrategyOf(lever));
        expect(profile.objectives).toContain(defaultObjectiveOf(lever));
      }
    });

    it('should let a lever that takes a volume name a price per thousand (L25)', (): void => {
      for (const lever of allLevers()) {
        const profile: LeverProfile = profileOf(lever);
        if (profile.volumeUnits.length === 0) continue;

        // A volume is converted through a CPM: a lever taking one without a CPM strategy could never
        // convert it, and every entry would answer `volume_without_bid`.
        expect(profile.bidStrategies.some((strategy: BidStrategy): boolean => CPM_STRATEGIES.includes(strategy))).toBe(
          true
        );
      }
    });

    it('should never let the TargetingGroup carry dates', (): void => {
      for (const lever of allLevers()) {
        expect(fieldRuleOf(lever, 'targeting_group', 'dates')).toBe('forbidden');
      }
    });
  });

  describe('the decisions the profiles carry', () => {
    it('should forbid a budget on a Search Line, and allow it elsewhere (D12)', (): void => {
      expect(fieldRuleOf('search', 'line', 'budget')).toBe('forbidden');
      expect(carriesBudget('search', 'line')).toBe(false);
      expect(carriesBudget('search', 'targeting_group')).toBe(true);
      expect(carriesBudget('dooh', 'line')).toBe(true);
    });

    it('should forbid any capping on the Search, at every level (L6)', (): void => {
      for (const level of treeLevelSchema.options) {
        expect(fieldRuleOf('search', level, 'capping')).toBe('forbidden');
        // Everywhere else a cap is optional, the TargetingGroup included: it is a cap on a targeting.
        expect(fieldRuleOf('dooh', level, 'capping')).toBe('allowed');
      }
    });

    it('should require a budget and dates on the campaign of every lever', (): void => {
      for (const lever of allLevers()) {
        expect(fieldRuleOf(lever, 'campaign', 'budget')).toBe('required');
        expect(fieldRuleOf(lever, 'campaign', 'dates')).toBe('required');
      }
    });

    it('should permit deals on the programmatic levers only (L7)', (): void => {
      for (const lever of allLevers()) {
        expect({ lever, deals: profileOf(lever).dealsPermitted }).toEqual({
          lever,
          deals: PROGRAMMATIC.includes(lever),
        });
      }
    });

    it('should permit the Products mode on the Search only (L13, L14)', (): void => {
      for (const lever of allLevers()) {
        expect({ lever, products: profileOf(lever).productsModePermitted }).toEqual({
          lever,
          products: lever === 'search',
        });
      }
    });

    it('should hold the platforms of the matrix, GAM gone and Amazon DSP out of audio', (): void => {
      expect(profileOf('search').platforms).toEqual(['google_ads', 'microsoft', 'openai', 'thrad', 'amazon_search']);
      expect(profileOf('dooh').platforms).toEqual(['hawk']);
      expect(profileOf('audio').platforms).toEqual(['hawk', 'dv360']);
      expect(profileOf('ctv_tvs').platforms).toEqual(['hawk', 'dv360', 'amazon_dsp']);
      expect(profileOf('dac').platforms).toEqual(['hawk', 'dv360']);
      expect(profileOf('social').platforms).toEqual(['meta', 'tiktok', 'snap']);
    });

    it('should say which objective lists are final, and which await a platform study', (): void => {
      expect(profileOf('search').objectivesComplete).toBe(true);
      for (const lever of allLevers().filter((other: Lever): boolean => other !== 'search')) {
        expect({ lever, complete: profileOf(lever).objectivesComplete }).toEqual({ lever, complete: false });
      }
    });
  });

  describe('assertFieldAllowed', () => {
    it('should refuse a value on a field the lever forbids, naming where', (): void => {
      expect((): void => assertFieldAllowed('search', 'line', 'budget', true)).toThrow(
        expect.objectContaining({
          statusCode: 400,
          errorCode: 'lever_field_forbidden',
          errorParams: { lever: 'search', level: 'line', field: 'budget' },
        })
      );
    });

    it('should accept an absent value, which is how every inheriting level is written', (): void => {
      expect((): void => assertFieldAllowed('search', 'line', 'budget', false)).not.toThrow();
    });

    it('should accept a value the lever allows', (): void => {
      expect((): void => assertFieldAllowed('dooh', 'line', 'budget', true)).not.toThrow();
    });
  });

  describe('assertPlatformEligible', () => {
    it('should accept a platform of the lever', (): void => {
      expect((): void => assertPlatformEligible('ctv_tvs', 'amazon_dsp')).not.toThrow();
    });

    it('should refuse a platform the lever does not serve', (): void => {
      expect((): void => assertPlatformEligible('audio', 'amazon_dsp')).toThrow(
        expect.objectContaining({
          statusCode: 400,
          errorCode: 'platform_not_eligible',
          errorParams: { platform: 'amazon_dsp', lever: 'audio' },
        })
      );
    });
  });

  describe('assertBidStrategyPermitted', () => {
    it('should accept a strategy the lever permits', (): void => {
      expect((): void => assertBidStrategyPermitted('search', 'maximize_conversions')).not.toThrow();
    });

    it('should refuse a strategy of another paradigm', (): void => {
      expect((): void => assertBidStrategyPermitted('search', 'target_cpcv')).toThrow(
        expect.objectContaining({ statusCode: 400, errorCode: 'bid_strategy_not_permitted' })
      );
    });
  });

  describe('assertObjectivePermitted', () => {
    it('should accept an objective the lever permits', (): void => {
      expect((): void => assertObjectivePermitted('search', 'conversions')).not.toThrow();
    });

    it('should refuse an objective the lever does not permit', (): void => {
      expect((): void => assertObjectivePermitted('search', 'app_installs')).toThrow(
        expect.objectContaining({
          statusCode: 400,
          errorCode: 'objective_not_permitted',
          errorParams: { objective: 'app_installs', lever: 'search' },
        })
      );
    });
  });

  describe('assertVolumeUnitPermitted', () => {
    it('should accept a unit the lever takes a budget in', (): void => {
      expect((): void => assertVolumeUnitPermitted('dooh', 'plays')).not.toThrow();
    });

    it('should refuse a volume on a lever that buys in money only', (): void => {
      expect((): void => assertVolumeUnitPermitted('search', 'impressions')).toThrow(
        expect.objectContaining({
          statusCode: 400,
          errorCode: 'volume_not_permitted',
          errorParams: { unit: 'impressions', lever: 'search' },
        })
      );
    });
  });

  describe('the defaults', () => {
    it('should give each lever the strategy and the objective of its paradigm', (): void => {
      expect(defaultBidStrategyOf('search')).toBe('max_cpc');
      expect(defaultBidStrategyOf('dooh')).toBe('fixed_cpm');
      expect(defaultObjectiveOf('search')).toBe('traffic');
      expect(defaultObjectiveOf('social')).toBe('awareness');
    });
  });

  describe('what a lever can be targeted on', () => {
    it('should give each paradigm the dimensions that mean something to it', (): void => {
      // The words and the catalogue are Search; a screen and its audience multiplier are DOOH; a
      // feed placement is social. Nothing else is exclusive (`docs/phase-5.md` § 5).
      expect(targetingDimensionsOf('search')).toContain('context_hints');
      expect(targetingDimensionsOf('search')).not.toContain('screen');
      expect(targetingDimensionsOf('dooh')).toContain('screen');
      expect(targetingDimensionsOf('dooh')).toContain('multiplier');
      expect(targetingDimensionsOf('dooh')).not.toContain('context_hints');
      expect(targetingDimensionsOf('social')).toContain('social_placement');
      expect(targetingDimensionsOf('dac')).not.toContain('social_placement');
    });

    it('should refuse what a paradigm has nothing to do with', (): void => {
      // A screen in the street has no browser and no viewport; a Search platform buys intent, not
      // inventory.
      expect(permitsDimension('dooh', 'browser')).toBe(false);
      expect(permitsDimension('audio', 'viewability')).toBe(false);
      expect(permitsDimension('search', 'exchange')).toBe(false);
      expect(permitsDimension('dac', 'viewability')).toBe(true);
    });

    it('should let every dimension of the registry be reached by at least one lever', (): void => {
      const reachable = new Set<TargetingDimension>(
        allLevers().flatMap((lever: Lever): TargetingDimension[] => targetingDimensionsOf(lever))
      );

      expect(allDimensions().filter((dimension: TargetingDimension): boolean => !reachable.has(dimension))).toEqual([]);
    });

    it('should never declare the same dimension twice on one lever', (): void => {
      for (const lever of allLevers()) {
        const declared: readonly TargetingDimension[] = LEVER_PROFILES[lever].targetingDimensions;

        expect({ lever, duplicates: declared.length - new Set(declared).size }).toEqual({ lever, duplicates: 0 });
      }
    });

    it('should refuse a dimension in 400, naming the lever and the dimension', (): void => {
      expect((): void => assertDimensionPermitted('search', 'exchange')).toThrow(
        expect.objectContaining({
          statusCode: 400,
          errorCode: 'targeting_dimension_forbidden',
          errorParams: { lever: 'search', dimension: 'exchange' },
        })
      );
      expect((): void => assertDimensionPermitted('search', 'country')).not.toThrow();
    });

    it('should buy keywords on Search only', (): void => {
      expect((): void => assertKeywordsPermitted('search')).not.toThrow();
      for (const lever of allLevers().filter((lever: Lever): boolean => lever !== 'search')) {
        expect((): void => assertKeywordsPermitted(lever)).toThrow(
          expect.objectContaining({ errorCode: 'keywords_not_permitted', errorParams: { lever } })
        );
      }
    });

    it('should carry extensions and the intent of a place on Search only', (): void => {
      expect((): void => assertSearchFieldPermitted('search', 'lever', 'extensions')).not.toThrow();
      expect((): void => assertSearchFieldPermitted('search', 'ad_group', 'locationIntent')).not.toThrow();
      for (const lever of allLevers().filter((lever: Lever): boolean => lever !== 'search')) {
        expect((): void => assertSearchFieldPermitted(lever, 'lever', 'extensions')).toThrow(
          expect.objectContaining({
            errorCode: 'lever_field_forbidden',
            errorParams: { lever, level: 'lever', field: 'extensions' },
          })
        );
        expect((): void => assertSearchFieldPermitted(lever, 'ad_group', 'locationIntent')).toThrow(
          expect.objectContaining({
            errorCode: 'lever_field_forbidden',
            errorParams: { lever, level: 'ad_group', field: 'locationIntent' },
          })
        );
      }
    });
  });
});
