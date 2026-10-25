jest.mock('config');
import config from 'config';

describe('Unit::Configs::Database', () => {
  const CONNECTION: Record<string, unknown> = {
    'Database.host': 'db.internal',
    'Database.port': 5432,
    'Database.user': 'omnipotent',
    'Database.password': 's3cret',
    'Database.name': 'omnipotent',
  };

  beforeEach((): void => {
    jest.clearAllMocks();
  });

  it('should read the connection settings and default the optional ones', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);
    jest.spyOn(config, 'get').mockImplementation((key: string): unknown => CONNECTION[key]);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { databaseConfig } = await import('@configs/database.config');
      expect(databaseConfig).toEqual({
        host: 'db.internal',
        port: 5432,
        user: 'omnipotent',
        password: 's3cret',
        name: 'omnipotent',
        ssl: false,
        poolSize: 10,
        logging: false,
        iamAuth: false,
        region: '',
        appUser: '',
      });
    });
  });

  it('should use configured values when they exist', async (): Promise<void> => {
    const values: Record<string, unknown> = {
      ...CONNECTION,
      'Database.ssl': true,
      'Database.poolSize': 25,
      'Database.logging': true,
      'Database.iamAuth': true,
      'Database.region': 'eu-north-1',
      'Database.appUser': 'omnipotent_app',
    };
    jest.spyOn(config, 'has').mockImplementation((): boolean => true);
    jest.spyOn(config, 'get').mockImplementation((key: string): unknown => values[key]);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { databaseConfig } = await import('@configs/database.config');
      expect(databaseConfig).toEqual({
        host: 'db.internal',
        port: 5432,
        user: 'omnipotent',
        password: 's3cret',
        name: 'omnipotent',
        ssl: true,
        poolSize: 25,
        logging: true,
        iamAuth: true,
        region: 'eu-north-1',
        appUser: 'omnipotent_app',
      });
    });
  });

  it('should fail when a connection setting is missing', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);
    jest.spyOn(config, 'get').mockImplementation((key: string): unknown => {
      throw new Error(`Configuration property "${key}" is not defined`);
    });

    await jest.isolateModulesAsync(async (): Promise<void> => {
      await expect(import('@configs/database.config')).rejects.toThrow(
        'Configuration property "Database.host" is not defined'
      );
    });
  });
});
