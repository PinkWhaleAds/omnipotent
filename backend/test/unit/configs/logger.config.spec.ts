jest.mock('config');
import config from 'config';

describe('Unit::Configs::Logger', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
  });

  it('should use default values when no config exists', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { loggerConfig } = await import('@configs/logger.config');
      expect(loggerConfig.level).toBe('warn');
      expect(loggerConfig.accessLog).toBe(true);
    });
  });

  it.each([
    [false, false],
    [true, true],
  ])('should read accessLog %p', async (value: boolean, expected: boolean): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((key: string): boolean => key === 'Logger.accessLog');
    jest.spyOn(config, 'get').mockImplementation((): unknown => value);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { loggerConfig } = await import('@configs/logger.config');
      expect(loggerConfig.accessLog).toBe(expected);
    });
  });

  it('should use configured level', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((key: string): boolean => key === 'Logger.level');
    jest.spyOn(config, 'get').mockImplementation((key: string): unknown => {
      if (key === 'Logger.level') return 'info';
      return undefined;
    });

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { loggerConfig } = await import('@configs/logger.config');
      expect(loggerConfig.level).toBe('info');
    });
  });
});
