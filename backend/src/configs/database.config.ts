import config from 'config';

/**
 * Configuration interface for the PostgreSQL connection.
 *
 * The same database holds the application tables (TypeORM) and the job queue
 * (pg-boss, in its own schema — see `queue.config.ts`).
 *
 * @property host - Hostname of the PostgreSQL server
 * @property port - Port of the PostgreSQL server
 * @property user - Role used to connect
 * @property password - Password of that role
 * @property name - Database name
 * @property ssl - Whether to connect over TLS (required by managed databases such as RDS)
 * @property poolSize - Maximum number of pooled connections held by this process
 * @property logging - Whether TypeORM logs every query (local debugging only)
 * @property iamAuth - Sign in with RDS IAM authentication tokens instead of `password` (production:
 *   the API and the worker connect as a non-master role granted `rds_iam`)
 * @property region - AWS region of the database, to sign the IAM tokens (required with `iamAuth`)
 * @property appUser - Role the migration step creates and grants for the API and the worker (empty: none;
 *   see `src/database/app-role.ts`)
 */
export type DatabaseConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  name: string;
  ssl: boolean;
  poolSize: number;
  logging: boolean;
  iamAuth: boolean;
  region: string;
  appUser: string;
};

/** Default size of the connection pool of one process. */
const DEFAULT_POOL_SIZE = 10;

/** The configuration key used to look up database settings in the config store. */
const CONFIG_KEY = 'Database';

/**
 * Resolved database configuration loaded from the application config store.
 *
 * Connection settings are mandatory (`config.get` throws when one is missing):
 * there is no sensible default for where the data lives.
 *
 * @example
 * ```typescript
 * import { databaseConfig } from '@configs';
 *
 * new DataSource({ type: 'postgres', host: databaseConfig.host, ... });
 * ```
 */
export const databaseConfig: DatabaseConfig = {
  host: config.get(`${CONFIG_KEY}.host`),
  port: config.get(`${CONFIG_KEY}.port`),
  user: config.get(`${CONFIG_KEY}.user`),
  password: config.get(`${CONFIG_KEY}.password`),
  name: config.get(`${CONFIG_KEY}.name`),
  ssl: config.has(`${CONFIG_KEY}.ssl`) ? config.get(`${CONFIG_KEY}.ssl`) : false,
  poolSize: config.has(`${CONFIG_KEY}.poolSize`) ? config.get(`${CONFIG_KEY}.poolSize`) : DEFAULT_POOL_SIZE,
  logging: config.has(`${CONFIG_KEY}.logging`) ? config.get(`${CONFIG_KEY}.logging`) : false,
  iamAuth: config.has(`${CONFIG_KEY}.iamAuth`) ? config.get(`${CONFIG_KEY}.iamAuth`) : false,
  region: config.has(`${CONFIG_KEY}.region`) ? config.get(`${CONFIG_KEY}.region`) : '',
  appUser: config.has(`${CONFIG_KEY}.appUser`) ? config.get(`${CONFIG_KEY}.appUser`) : '',
};
