import { DataSource } from 'typeorm';

import { databaseConfig, DatabaseConfig } from '@configs/database.config';
import { ENTITIES } from '@src/database/entities';
import { createDataSource } from '@src/database/data-source';

/**
 * Connection settings of the throwaway integration database: the configured
 * server, with `_it` appended to the database name.
 */
export const INTEGRATION_DATABASE: DatabaseConfig = { ...databaseConfig, name: `${databaseConfig.name}_it` };

/**
 * Open a data source on the integration database and apply pending migrations.
 *
 * The schema is built only by the migrations, so the suite also proves they
 * produce what the entities expect.
 *
 * @returns An initialized data source; destroy it after use
 */
export async function connectIntegrationDatabase(): Promise<DataSource> {
  const dataSource: DataSource = createDataSource(INTEGRATION_DATABASE);
  await dataSource.initialize();
  await dataSource.runMigrations({ transaction: 'all' });
  return dataSource;
}

/**
 * Empty every application table, keeping the schema.
 *
 * The tables are those of the registered entities, so a phase that adds one does not have to list it
 * here; children are emptied with their parent (`CASCADE`).
 *
 * @param dataSource - Data source on the integration database
 * @returns A promise that resolves once the tables are empty
 */
export async function truncateAll(dataSource: DataSource): Promise<void> {
  if (ENTITIES.length === 0) return;
  const tables: string[] = ENTITIES.map(
    (entity: new () => unknown): string => `"${dataSource.getMetadata(entity).tableName}"`
  );
  await dataSource.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}
