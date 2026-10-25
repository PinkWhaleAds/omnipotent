/**
 * @module database/migrate
 *
 * Standalone entry point that applies pending migrations, then exits.
 *
 * Runs as its own step of a deployment (a Kubernetes Job, an ECS task, the
 * `migrate` service of `compose.yaml`) so replicas never race each other to
 * migrate the schema while booting: `node dist/database/migrate.js`.
 */
import { DataSource, EntityManager } from 'typeorm';

import { databaseConfig } from '@configs/database.config';
import { queueConfig } from '@configs/queue.config';
import { killProcess, LoggerBuilder } from '@utils';
import { ensureAppRole } from './app-role';
import { createDataSource } from './data-source';

/**
 * Apply every pending migration in a single transaction, then, when `Database.appUser` is set,
 * create or update the role the API and the worker connect with (its grants cover the new tables).
 *
 * @returns A promise that resolves once the schema is up to date and the connection closed
 */
async function migrate(): Promise<void> {
  const dataSource: DataSource = createDataSource();
  await dataSource.initialize();
  const applied: { name: string }[] = await dataSource.runMigrations({ transaction: 'all' });
  LoggerBuilder.getLogger().info(`Applied ${applied.length} migration(s)`);
  if (databaseConfig.appUser) {
    await dataSource.transaction((manager: EntityManager): Promise<void> =>
      ensureAppRole(manager, { user: databaseConfig.appUser, queueSchema: queueConfig.schema })
    );
    LoggerBuilder.getLogger().info(`Application role ${databaseConfig.appUser} ready`);
  }
  await dataSource.destroy();
}

migrate().catch((error: Error): void => {
  killProcess('DATABASE::MIGRATION_FAILED', 'Failed to apply migrations', error);
});
