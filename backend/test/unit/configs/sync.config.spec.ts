jest.mock('config');
import config from 'config';

describe('Unit::Configs::Sync', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
  });

  it('should use default values when no config exists', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { syncConfig } = await import('@configs/sync.config');

      expect(syncConfig).toEqual({ maxBackoffMinutes: 60, sweepBatchSize: 500, pacingJitterMinutes: 30 });
    });
  });

  it('should read every configured value', async (): Promise<void> => {
    const values: Record<string, unknown> = {
      'Sync.maxBackoffMinutes': 15,
      'Sync.sweepBatchSize': 50,
      'Sync.pacingJitterMinutes': 5,
    };
    jest.spyOn(config, 'has').mockImplementation((): boolean => true);
    jest.spyOn(config, 'get').mockImplementation((key: string): unknown => values[key]);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { syncConfig } = await import('@configs/sync.config');

      expect(syncConfig).toEqual({ maxBackoffMinutes: 15, sweepBatchSize: 50, pacingJitterMinutes: 5 });
    });
  });
});
