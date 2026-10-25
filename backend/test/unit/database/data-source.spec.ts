import { DataSource, DataSourceOptions } from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

import { DatabaseConfig, databaseConfig } from '@configs/database.config';
import { buildDataSourceOptions, createDataSource } from '@src/database/data-source';
import { ENTITIES } from '@src/database/entities';
import { MIGRATIONS } from '@src/database/migrations';
import { SnakeNamingStrategy } from '@src/database/snake-naming.strategy';

describe('Unit::Database::DataSource', () => {
  const CONFIG: DatabaseConfig = {
    host: 'db.internal',
    port: 5432,
    user: 'omnipotent',
    password: 's3cret',
    name: 'omnipotent',
    ssl: false,
    poolSize: 7,
    logging: true,
    iamAuth: false,
    region: '',
    appUser: '',
  };

  beforeEach((): void => {
    jest.clearAllMocks();
  });

  describe('buildDataSourceOptions', () => {
    it('should map the connection settings', (): void => {
      const options: PostgresConnectionOptions = buildDataSourceOptions(CONFIG) as PostgresConnectionOptions;

      expect(options).toMatchObject({
        type: 'postgres',
        host: 'db.internal',
        port: 5432,
        username: 'omnipotent',
        password: 's3cret',
        database: 'omnipotent',
        logging: true,
        extra: { max: 7 },
      });
    });

    it('should register the entities and migrations, with snake_case names and pgcrypto UUIDs', (): void => {
      const options: PostgresConnectionOptions = buildDataSourceOptions(CONFIG) as PostgresConnectionOptions;

      expect(options.entities).toBe(ENTITIES);
      expect(options.migrations).toBe(MIGRATIONS);
      expect(options.namingStrategy).toBeInstanceOf(SnakeNamingStrategy);
      expect(options.uuidExtension).toBe('pgcrypto');
    });

    it('should never change the schema implicitly', (): void => {
      const options: DataSourceOptions = buildDataSourceOptions(CONFIG);

      expect(options.synchronize).toBe(false);
      expect(options.migrationsRun).toBe(false);
    });

    it('should connect without TLS when ssl is off', (): void => {
      const options: PostgresConnectionOptions = buildDataSourceOptions(CONFIG) as PostgresConnectionOptions;

      expect(options.ssl).toBe(false);
    });

    it('should verify the server certificate when ssl is on', (): void => {
      const options: PostgresConnectionOptions = buildDataSourceOptions({
        ...CONFIG,
        ssl: true,
      }) as PostgresConnectionOptions;

      expect(options.ssl).toEqual({ rejectUnauthorized: true });
    });

    it('should sign each new connection in with an RDS IAM token when IAM authentication is on', (): void => {
      const options: PostgresConnectionOptions = buildDataSourceOptions({
        ...CONFIG,
        iamAuth: true,
        region: 'eu-north-1',
      }) as PostgresConnectionOptions;

      expect(options.password).toEqual(expect.any(Function));
    });
  });

  describe('createDataSource', () => {
    it('should build a data source that is not connected yet', (): void => {
      const dataSource: DataSource = createDataSource(CONFIG);

      expect(dataSource).toBeInstanceOf(DataSource);
      expect(dataSource.isInitialized).toBe(false);
      expect(dataSource.options).toMatchObject({ host: 'db.internal', database: 'omnipotent' });
    });

    it('should use the application configuration by default', (): void => {
      const dataSource: DataSource = createDataSource();

      expect(dataSource.options).toMatchObject({
        host: databaseConfig.host,
        port: databaseConfig.port,
        database: databaseConfig.name,
      });
    });
  });
});
