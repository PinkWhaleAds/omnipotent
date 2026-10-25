import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';

import { DatabaseConfig, databaseConfig } from '@configs/database.config';
import { ENTITIES } from './entities';
import { databasePassword } from './iam-auth';
import { MIGRATIONS } from './migrations';
import { SnakeNamingStrategy } from './snake-naming.strategy';

/**
 * Build the TypeORM options for the application database.
 *
 * - `synchronize` is always off: the schema only changes through migrations,
 *   which are run explicitly (`pnpm migration:run`, or `node dist/database/migrate.js`
 *   in the image), never implicitly by a booting replica.
 * - UUIDs come from PostgreSQL's built-in `gen_random_uuid()` (`pgcrypto`
 *   mode), so no extension has to be installed.
 *
 * @param config - Connection settings
 * @returns Options ready to pass to `new DataSource(...)`
 *
 * @example
 * ```typescript
 * const dataSource: DataSource = new DataSource(buildDataSourceOptions(databaseConfig));
 * ```
 */
export function buildDataSourceOptions(config: DatabaseConfig): DataSourceOptions {
  return {
    type: 'postgres',
    host: config.host,
    port: config.port,
    username: config.user,
    // The configured password, or a fresh RDS IAM token for each new connection (`config.iamAuth`).
    password: databasePassword(config),
    database: config.name,
    ssl: config.ssl ? { rejectUnauthorized: true } : false,
    logging: config.logging,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    namingStrategy: new SnakeNamingStrategy(),
    uuidExtension: 'pgcrypto',
    synchronize: false,
    migrationsRun: false,
    extra: { max: config.poolSize },
  };
}

/**
 * Create a (not yet initialized) data source for the application database.
 *
 * @param config - Connection settings, the application configuration by default
 * @returns A data source; call `initialize()` before using it
 *
 * @example
 * ```typescript
 * const dataSource: DataSource = createDataSource();
 * await dataSource.initialize();
 * ```
 */
export function createDataSource(config: DatabaseConfig = databaseConfig): DataSource {
  return new DataSource(buildDataSourceOptions(config));
}
