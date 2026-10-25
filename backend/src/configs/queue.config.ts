import config from 'config';

/**
 * Configuration interface for the job queue (pg-boss).
 *
 * pg-boss rides the application database (see `database.config.ts`) and keeps
 * its tables in a dedicated schema, so they never mix with the TypeORM ones.
 *
 * @property schema - PostgreSQL schema owned by pg-boss
 * @property poolSize - Maximum number of connections pg-boss holds in this process
 */
export type QueueConfig = {
  schema: string;
  poolSize: number;
};

/** Default schema owned by pg-boss. */
const DEFAULT_SCHEMA = 'pgboss';

/** Default size of the pg-boss connection pool. */
const DEFAULT_POOL_SIZE = 4;

/** The configuration key used to look up queue settings in the config store. */
const CONFIG_KEY = 'Queue';

/**
 * Resolved queue configuration loaded from the application config store.
 *
 * @example
 * ```typescript
 * import { queueConfig } from '@configs';
 *
 * new PgBoss({ schema: queueConfig.schema, max: queueConfig.poolSize, ... });
 * ```
 */
export const queueConfig: QueueConfig = {
  schema: config.has(`${CONFIG_KEY}.schema`) ? config.get(`${CONFIG_KEY}.schema`) : DEFAULT_SCHEMA,
  poolSize: config.has(`${CONFIG_KEY}.poolSize`) ? config.get(`${CONFIG_KEY}.poolSize`) : DEFAULT_POOL_SIZE,
};
