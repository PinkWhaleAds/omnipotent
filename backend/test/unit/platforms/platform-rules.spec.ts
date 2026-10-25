import {
  PLATFORM_RULES,
  leversOf,
  rulesOf,
  supportedPlatforms,
  unsupportedDimensions,
} from '@src/platforms/platform-rules';
import { TargetingDimension } from '@src/types';
import { errorCodeOf, statusCodeOf } from '@utils';

describe('Unit::Platforms::PlatformRules', () => {
  /** The registry, writable, so a test can declare a couple as a phase would. */
  const registry: Record<
    string,
    Record<string, { label: string; targeting: TargetingDimension[] }>
  > = PLATFORM_RULES as Record<string, Record<string, { label: string; targeting: TargetingDimension[] }>>;

  afterEach((): void => {
    for (const platform of Object.keys(registry)) Reflect.deleteProperty(registry, platform);
  });

  it('should hold no platform yet: each one arrives with its phase', (): void => {
    expect(PLATFORM_RULES).toEqual({});
    expect(supportedPlatforms()).toEqual([]);
  });

  it('should be keyed by the couple (platform, lever), never by the platform alone', (): void => {
    // leviers.md L2 and faisabilite-search.md F11: the same platform accepts different things on
    // different levers, so a phase declares one entry per couple.
    registry.dv360 = { ctv_tvs: { label: 'DV360', targeting: [] }, audio: { label: 'DV360', targeting: [] } };

    expect(supportedPlatforms()).toEqual(['dv360']);
    expect(leversOf('dv360')).toEqual(['audio', 'ctv_tvs']);
    expect(rulesOf('dv360', 'audio')).toEqual({ label: 'DV360', targeting: [] });
  });

  describe('supportedPlatforms', () => {
    it('should name every platform of the registry, sorted', (): void => {
      registry.hawk = { dooh: { label: 'Hawk', targeting: [] } };
      registry.dv360 = { dac: { label: 'DV360', targeting: [] } };

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
      registry.amazon_dsp = { ctv_tvs: { label: 'Amazon DSP', targeting: [] } };

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
      registry.hawk = { dooh: { label: 'Hawk', targeting: [] } };

      expect(rulesOf('hawk', 'dooh')).toEqual({ label: 'Hawk', targeting: [] });
    });
  });

  describe('unsupportedDimensions', () => {
    it('should name what the couple cannot express, among what the node asks for', (): void => {
      registry.hawk = { dooh: { label: 'Hawk', targeting: ['screen', 'country', 'schedule'] } };

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
});
