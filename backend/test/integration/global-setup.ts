import config from 'config';
import { Client } from 'pg';

/**
 * Recreate the integration database from scratch.
 *
 * Runs outside jest's module system (no path aliases), so it reads the
 * connection settings with node-config directly. It connects to the server's
 * maintenance database (`postgres`) to drop and create `<Database.name>_it`;
 * each suite then applies the migrations (see `connectIntegrationDatabase`).
 *
 * @returns A promise that resolves once the empty database exists
 */
export default async function globalSetup(): Promise<void> {
  const name = `${config.get<string>('Database.name')}_it`;
  const admin: Client = new Client({
    host: config.get<string>('Database.host'),
    port: config.get<number>('Database.port'),
    user: config.get<string>('Database.user'),
    password: config.get<string>('Database.password'),
    database: 'postgres',
  });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
}
