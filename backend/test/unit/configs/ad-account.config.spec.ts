jest.mock('config');
import config from 'config';

describe('Unit::Configs::AdAccount', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
  });

  it('should withdraw an unanswered invitation after thirty days by default', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { adAccountConfig } = await import('@configs/ad-account.config');

      expect(adAccountConfig).toEqual({ linkRequestLifetimeDays: 30 });
    });
  });

  it('should read the configured lifetime', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => true);
    jest.spyOn(config, 'get').mockImplementation((): unknown => 7);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { adAccountConfig } = await import('@configs/ad-account.config');

      expect(adAccountConfig).toEqual({ linkRequestLifetimeDays: 7 });
    });
  });
});
