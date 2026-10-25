jest.mock('config');
import config from 'config';

describe('Unit::Configs::App', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
  });

  it('should use default values when no config exists', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { appConfig } = await import('@configs/app.config');
      expect(appConfig).toEqual({
        shutdownTimeout: 10000,
        drainDelay: 0,
        mode: 'api',
      });
    });
  });

  it('should use config values when they exist', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => true);
    jest.spyOn(config, 'get').mockImplementation((key: string): unknown => {
      if (key === 'App.shutdownTimeout') return 25000;
      if (key === 'App.drainDelay') return 5000;
      if (key === 'App.mode') return 'worker';
      return undefined;
    });

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { appConfig } = await import('@configs/app.config');
      expect(appConfig).toEqual({
        shutdownTimeout: 25000,
        drainDelay: 5000,
        mode: 'worker',
      });
    });
  });

  it('should refuse an unknown mode instead of starting the wrong process', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((key: string): boolean => key === 'App.mode');
    jest.spyOn(config, 'get').mockImplementation((): unknown => 'scheduler');

    await jest.isolateModulesAsync(async (): Promise<void> => {
      await expect(import('@configs/app.config')).rejects.toThrow("Unknown App.mode 'scheduler'");
    });
  });
});
