jest.mock('config');
import config from 'config';

describe('Unit::Configs::Queue', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
  });

  it('should use default values when no config exists', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { queueConfig } = await import('@configs/queue.config');
      expect(queueConfig).toEqual({ schema: 'pgboss', poolSize: 4 });
    });
  });

  it('should use configured values when they exist', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => true);
    jest.spyOn(config, 'get').mockImplementation((key: string): unknown => {
      if (key === 'Queue.schema') return 'jobs';
      if (key === 'Queue.poolSize') return 8;
      return undefined;
    });

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { queueConfig } = await import('@configs/queue.config');
      expect(queueConfig).toEqual({ schema: 'jobs', poolSize: 8 });
    });
  });
});
