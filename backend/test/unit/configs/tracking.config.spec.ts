jest.mock('config');
import config from 'config';

describe('Unit::Configs::Tracking', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
  });

  it('should serve the scripts from a local API by default', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { trackingConfig } = await import('@configs/tracking.config');
      expect(trackingConfig).toEqual({ scriptBaseUrl: 'http://localhost:3002' });
      expect(config.get).not.toHaveBeenCalled();
    });
  });

  it('should read the configured address, without its trailing slashes', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((key: string): boolean => key === 'Tracking.scriptBaseUrl');
    jest.spyOn(config, 'get').mockImplementation((): unknown => 'https://omnipotent.pinkwhale.co//');

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { trackingConfig } = await import('@configs/tracking.config');
      expect(trackingConfig).toEqual({ scriptBaseUrl: 'https://omnipotent.pinkwhale.co' });
    });
  });

  it('should be exported by the configuration barrel', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const configs = await import('@configs');
      expect(configs.trackingConfig).toEqual({ scriptBaseUrl: 'http://localhost:3002' });
    });
  });
});
