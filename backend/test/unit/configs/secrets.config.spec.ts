jest.mock('config');
import config from 'config';

describe('Unit::Configs::Secrets', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
  });

  it('should use default values when no config exists', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { secretsConfig } = await import('@configs/secrets.config');
      expect(secretsConfig).toEqual({
        endpoint: '',
        region: 'eu-north-1',
        prefix: 'omnipotent',
        accessKeyId: '',
        secretAccessKey: '',
        cacheTtl: 300000,
      });
    });
  });

  it('should read every configured value', async (): Promise<void> => {
    const values: Record<string, unknown> = {
      'Secrets.endpoint': 'http://localhost:9020',
      'Secrets.region': 'us-east-1',
      'Secrets.prefix': 'omnipotent-local',
      'Secrets.accessKeyId': 'local',
      'Secrets.secretAccessKey': 'local-secret',
      'Secrets.cacheTtl': 60000,
    };
    jest.spyOn(config, 'has').mockImplementation((): boolean => true);
    jest.spyOn(config, 'get').mockImplementation((key: string): unknown => values[key]);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { secretsConfig } = await import('@configs/secrets.config');
      expect(secretsConfig).toEqual({
        endpoint: 'http://localhost:9020',
        region: 'us-east-1',
        prefix: 'omnipotent-local',
        accessKeyId: 'local',
        secretAccessKey: 'local-secret',
        cacheTtl: 60000,
      });
    });
  });

  it('should mix configured values and defaults key by key', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((key: string): boolean => key === 'Secrets.prefix');
    jest
      .spyOn(config, 'get')
      .mockImplementation((key: string): unknown => (key === 'Secrets.prefix' ? 'omnipotent-prod' : 1));

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { secretsConfig } = await import('@configs/secrets.config');
      expect(secretsConfig.prefix).toBe('omnipotent-prod');
      expect(secretsConfig.region).toBe('eu-north-1');
      expect(secretsConfig.cacheTtl).toBe(300000);
      expect(config.get).toHaveBeenCalledTimes(1);
      expect(config.get).toHaveBeenCalledWith('Secrets.prefix');
    });
  });
});
