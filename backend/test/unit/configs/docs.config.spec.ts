jest.mock('config');
import config from 'config';

describe('Unit::Configs::Docs', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
  });

  it('should keep the documentation off when no configuration asks for it', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { docsConfig } = await import('@configs/docs.config');
      expect(docsConfig).toEqual({ enabled: false });
      expect(config.get).not.toHaveBeenCalled();
    });
  });

  it.each([
    [true, true],
    [false, false],
    // Only a JSON true turns it on (`APP_DOCS_ENABLED=true`).
    ['true', false],
  ])('should read %j as %s', async (value: unknown, enabled: boolean): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => true);
    jest.spyOn(config, 'get').mockImplementation((): unknown => value);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { docsConfig } = await import('@configs/docs.config');
      expect(docsConfig).toEqual({ enabled });
      expect(config.get).toHaveBeenCalledWith('Docs.enabled');
    });
  });

  it('should be exported by the configuration barrel', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const configs = await import('@configs');
      expect(configs.docsConfig.enabled).toBe(false);
    });
  });
});
