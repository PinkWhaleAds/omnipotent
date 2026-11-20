jest.mock('config');
import config from 'config';

describe('Unit::Configs::MicrosoftAds', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
  });

  it('should leave Microsoft without a manager account by default, and come back on port 4102', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { microsoftAdsConfig } = await import('@configs/microsoft-ads.config');

      expect(microsoftAdsConfig).toEqual({
        customerId: '',
        appSecret: 'microsoft-ads/app',
        oauthSecret: 'microsoft-ads/oauth',
        redirectUri: 'http://localhost:4102/microsoft/callback',
      });
    });
  });

  it('should read every configured value', async (): Promise<void> => {
    const values: Record<string, unknown> = {
      'MicrosoftAds.customerId': '255113635',
      'MicrosoftAds.appSecret': 'a',
      'MicrosoftAds.oauthSecret': 'o',
      'MicrosoftAds.redirectUri': 'http://localhost:9999/cb',
    };
    jest.spyOn(config, 'has').mockImplementation((): boolean => true);
    jest.spyOn(config, 'get').mockImplementation((key: string): unknown => values[key]);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { microsoftAdsConfig } = await import('@configs/microsoft-ads.config');

      expect(microsoftAdsConfig).toEqual({
        customerId: '255113635',
        appSecret: 'a',
        oauthSecret: 'o',
        redirectUri: 'http://localhost:9999/cb',
      });
    });
  });
});
