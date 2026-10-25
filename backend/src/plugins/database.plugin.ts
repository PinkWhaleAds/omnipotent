import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource } from 'typeorm';

import { createDataSource } from '@src/database/data-source';
import { LoggerBuilder, Logger } from '@utils';

/** First delay before retrying a failed connection. */
const INITIAL_RETRY_DELAY_IN_MS = 1000;

/** Longest delay between two connection attempts. */
const MAX_RETRY_DELAY_IN_MS = 30000;

/**
 * Registers the application database on the Fastify instance.
 *
 * - Decorates `fastify.db` with the TypeORM data source right away, so services
 *   can be built; they only touch it when serving a request.
 * - Connects in the background and keeps retrying with a capped backoff: a
 *   database that is down at boot is a readiness failure, not a reason to crash
 *   (see "Health checks" in `CLAUDE.md`).
 * - Registers the `postgres` readiness check, failing until connected and
 *   whenever `SELECT 1` fails, so the pod receives no traffic it cannot serve.
 * - Closes the pool when Fastify closes.
 *
 * Depends on `HealthServicePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 * @returns A promise that resolves once the decorator and hooks are registered
 *
 * @example
 * ```typescript
 * await fastify.register(HealthServicePlugin);
 * await fastify.register(DatabasePlugin);
 * const users: Repository<UserEntity> = fastify.db.getRepository(UserEntity);
 * ```
 */
async function DatabasePlugin(fastify: FastifyInstance): Promise<void> {
  const logger: Logger = LoggerBuilder.getChildLogger('DatabasePlugin');
  const dataSource: DataSource = createDataSource();
  let retryTimer: NodeJS.Timeout | undefined;
  let closing = false;

  fastify.decorate('db', dataSource);

  fastify.healthService.register('postgres', 'readiness', async (): Promise<void> => {
    if (!dataSource.isInitialized) throw new Error('Database connection not established yet');
    await dataSource.query('SELECT 1');
  });

  /**
   * Try to connect; on failure, schedule the next attempt with a doubled delay.
   *
   * @param delay - Delay before the attempt after this one, should this one fail
   * @returns A promise that resolves once this attempt is over
   */
  const connect: (delay: number) => Promise<void> = async (delay: number): Promise<void> => {
    try {
      await dataSource.initialize();
      logger.info('Connected to the database');
    } catch (error: unknown) {
      if (closing) return;
      logger.warn(`Database connection failed, retrying in ${delay}ms`, { error });
      retryTimer = setTimeout((): void => {
        void connect(Math.min(delay * 2, MAX_RETRY_DELAY_IN_MS));
      }, delay);
      // A pending retry must never keep the process alive during shutdown.
      retryTimer.unref();
    }
  };

  void connect(INITIAL_RETRY_DELAY_IN_MS);

  fastify.addHook('onClose', async (): Promise<void> => {
    closing = true;
    clearTimeout(retryTimer);
    if (dataSource.isInitialized) await dataSource.destroy();
  });
}

export default fastifyPlugin(DatabasePlugin, {
  name: 'DatabasePlugin',
  dependencies: ['HealthServicePlugin'],
});
