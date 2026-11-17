jest.mock('config');
import config from 'config';

describe('Unit::Configs::Access', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
  });

  it('should use default values when no config exists', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { accessConfig } = await import('@configs/access.config');
      expect(accessConfig).toEqual({ cacheTtl: 60000 });
    });
  });

  it('should use config values when they exist', async (): Promise<void> => {
    const values: Record<string, unknown> = { 'Access.cacheTtl': 30000 };
    jest.spyOn(config, 'has').mockImplementation((key: string): boolean => key in values);
    jest.spyOn(config, 'get').mockImplementation((key: string): unknown => values[key]);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { accessConfig } = await import('@configs/access.config');
      expect(accessConfig).toEqual({ cacheTtl: 30000 });
    });
  });
});
