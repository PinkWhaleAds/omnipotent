jest.mock('config');
import config from 'config';

describe('Unit::Configs::Preview', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
  });

  it('should use default values when no config exists', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { previewConfig } = await import('@configs/preview.config');

      // A guard-rail against the split of `../../CADRAGE.md` § 7 fanning an AdGroup out into hundreds
      // of platform campaigns, not a platform limit: the real ceilings of a Google account are still
      // to be read (`A-FAIRE.md`).
      expect(previewConfig).toEqual({ maxPlatformObjectsPerAdGroup: 50 });
    });
  });

  it('should read every configured value', async (): Promise<void> => {
    const values: Record<string, unknown> = { 'Preview.maxPlatformObjectsPerAdGroup': 120 };
    jest.spyOn(config, 'has').mockImplementation((): boolean => true);
    jest.spyOn(config, 'get').mockImplementation((key: string): unknown => values[key]);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { previewConfig } = await import('@configs/preview.config');

      expect(previewConfig).toEqual({ maxPlatformObjectsPerAdGroup: 120 });
    });
  });
});
