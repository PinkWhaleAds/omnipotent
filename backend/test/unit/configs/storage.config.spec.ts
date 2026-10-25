jest.mock('config');
import config from 'config';

describe('Unit::Configs::Storage', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
  });

  it('should use default values when no config exists', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { storageConfig } = await import('@configs/storage.config');
      expect(storageConfig).toEqual({
        endpoint: '',
        region: 'eu-north-1',
        bucket: 'omnipotent-assets',
        accessKeyId: '',
        secretAccessKey: '',
        forcePathStyle: false,
        createBucket: false,
        presignTtl: 3600,
        maxUploadBytes: 5242880,
      });
    });
  });

  it('should read every configured value', async (): Promise<void> => {
    const values: Record<string, unknown> = {
      'Storage.endpoint': 'http://localhost:9010',
      'Storage.region': 'us-east-1',
      'Storage.bucket': 'local-assets',
      'Storage.accessKeyId': 'local-access-key',
      'Storage.secretAccessKey': 'local-secret-key',
      'Storage.forcePathStyle': true,
      'Storage.createBucket': true,
      'Storage.presignTtl': 600,
      'Storage.maxUploadBytes': 1048576,
    };
    jest.spyOn(config, 'has').mockImplementation((): boolean => true);
    jest.spyOn(config, 'get').mockImplementation((key: string): unknown => values[key]);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { storageConfig } = await import('@configs/storage.config');
      expect(storageConfig).toEqual({
        endpoint: 'http://localhost:9010',
        region: 'us-east-1',
        bucket: 'local-assets',
        accessKeyId: 'local-access-key',
        secretAccessKey: 'local-secret-key',
        forcePathStyle: true,
        createBucket: true,
        presignTtl: 600,
        maxUploadBytes: 1048576,
      });
    });
  });

  it('should mix configured values and defaults key by key', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((key: string): boolean => key === 'Storage.bucket');
    jest
      .spyOn(config, 'get')
      .mockImplementation((key: string): unknown => (key === 'Storage.bucket' ? 'prod-assets' : 1));

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { storageConfig } = await import('@configs/storage.config');
      expect(storageConfig.bucket).toBe('prod-assets');
      expect(storageConfig.region).toBe('eu-north-1');
      expect(storageConfig.createBucket).toBe(false);
      expect(config.get).toHaveBeenCalledTimes(1);
      expect(config.get).toHaveBeenCalledWith('Storage.bucket');
    });
  });
});
