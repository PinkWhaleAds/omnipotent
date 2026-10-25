import { DataSource } from 'typeorm';

import { MIGRATIONS } from '@src/database/migrations';
import { connectIntegrationDatabase, truncateAll } from './database.utils';

/**
 * Tables the migrations must create, besides TypeORM's own `migrations` table.
 *
 * Each phase adds the tables of its migration here, so a migration that forgets one — or creates one
 * nobody declared — fails this suite.
 */
const APPLICATION_TABLES: string[] = [
  'ad_groups',
  'advertisers',
  'campaigns',
  'label_assignments',
  'labels',
  'levers',
  'lines',
  'targeting_groups',
];

/**
 * List the tables of the public schema.
 *
 * @param dataSource - Data source on the integration database
 * @returns Table names, sorted
 */
async function publicTables(dataSource: DataSource): Promise<string[]> {
  const rows: { table_name: string }[] = await dataSource.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  return rows.map((row: { table_name: string }): string => row.table_name);
}

describe('Integration::Migrations', () => {
  let dataSource: DataSource;

  beforeAll(async (): Promise<void> => {
    dataSource = await connectIntegrationDatabase();
  });

  afterAll(async (): Promise<void> => {
    await dataSource.destroy();
  });

  it('should create every application table', async (): Promise<void> => {
    expect(await publicTables(dataSource)).toEqual([...APPLICATION_TABLES, 'migrations'].sort());
  });

  it('should have applied every migration of the list', async (): Promise<void> => {
    const applied: { name: string }[] = await dataSource.query('SELECT name FROM migrations');

    expect(applied).toHaveLength(MIGRATIONS.length);
  });

  it('should leave nothing pending: the entities match the migrated schema', async (): Promise<void> => {
    const pending: boolean = await dataSource.showMigrations();
    expect(pending).toBe(false);

    const schemaDiff: { upQueries: unknown[] } = await dataSource.driver.createSchemaBuilder().log();
    expect(schemaDiff.upQueries).toEqual([]);
  });

  it('should empty every registered table', async (): Promise<void> => {
    await expect(truncateAll(dataSource)).resolves.toBeUndefined();
  });
});
