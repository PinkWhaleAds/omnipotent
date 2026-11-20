jest.mock('config');
import config from 'config';

describe('Unit::Configs::GoogleAds', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
  });

  it('should leave Google without a manager account by default', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { googleAdsConfig } = await import('@configs/google-ads.config');

      expect(googleAdsConfig).toEqual({ managerId: '', serviceAccountSecret: 'google-ads/service-account' });
    });
  });

  it('should read every configured value', async (): Promise<void> => {
    const values: Record<string, unknown> = {
      'GoogleAds.managerId': '771-934-5054',
      'GoogleAds.serviceAccountSecret': 'google-ads/other',
    };
    jest.spyOn(config, 'has').mockImplementation((): boolean => true);
    jest.spyOn(config, 'get').mockImplementation((key: string): unknown => values[key]);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { googleAdsConfig } = await import('@configs/google-ads.config');

      expect(googleAdsConfig).toEqual({ managerId: '771-934-5054', serviceAccountSecret: 'google-ads/other' });
    });
  });
});
