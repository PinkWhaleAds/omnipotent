import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { ConstructorOptions, Job, PgBoss } from 'pg-boss';

import { appConfig, databaseConfig, queueConfig } from '@configs';
import { databasePassword } from '@src/database/iam-auth';
import { JOB_DEFINITIONS } from '@src/jobs';
import { JobDefinition } from '@src/types/job.types';
import { httpError, LoggerBuilder, Logger } from '@utils';

/** First delay before retrying a failed start. */
const INITIAL_RETRY_DELAY_IN_MS = 1000;

/** Longest delay between two start attempts. */
const MAX_RETRY_DELAY_IN_MS = 30000;

/** Builds the pg-boss instance; injectable for tests. */
export type PgBossFactory = (options: ConstructorOptions) => PgBoss;

/**
 * Thin wrapper around pg-boss, the PostgreSQL-backed job queue.
 *
 * Jobs live in the application database (schema `queueConfig.schema`), so
 * enqueuing can never be lost to a broker outage the database survives.
 *
 * @example
 * ```typescript
 * await fastify.jobQueue.send('sync.ad-group', { adGroupId });
 * ```
 */
export class JobQueueService {
  /** @internal The pg-boss instance. */
  private readonly boss: PgBoss;

  /** @internal Whether `start()` succeeded and `stop()` was not called since. */
  private started = false;

  /** @internal Logger scoped to this class. */
  private readonly logger: Logger = LoggerBuilder.getChildLogger('JobQueueService');

  /**
   * Create the queue client (not started).
   *
   * @param factory - Builds the pg-boss instance
   */
  constructor(factory: PgBossFactory = (options: ConstructorOptions): PgBoss => new PgBoss(options)) {
    this.boss = factory({
      host: databaseConfig.host,
      port: databaseConfig.port,
      user: databaseConfig.user,
      // The configured password, or a fresh RDS IAM token for each new connection (`iamAuth`).
      password: databasePassword(databaseConfig),
      database: databaseConfig.name,
      ssl: databaseConfig.ssl ? { rejectUnauthorized: true } : undefined,
      schema: queueConfig.schema,
      // With IAM authentication the process connects as the application role, which may not create
      // schemas: the migration step creates the queue schema for it (src/database/app-role.ts).
      createSchema: !databaseConfig.iamAuth,
      max: queueConfig.poolSize,
    });
    // pg-boss reports background failures as `error` events; an EventEmitter
    // without a listener would turn them into an uncaught exception.
    this.boss.on('error', (error: Error): void => {
      this.logger.error('pg-boss reported an error', { code: 'QUEUE::ERROR', error });
    });
  }

  /**
   * Whether the queue is started and usable.
   *
   * @returns `true` between a successful {@link start} and {@link stop}
   */
  public get isStarted(): boolean {
    return this.started;
  }

  /**
   * Start pg-boss (creating or migrating its schema on the first run).
   *
   * @returns A promise that resolves once started
   */
  public async start(): Promise<void> {
    await this.boss.start();
    this.started = true;
  }

  /**
   * Create the queue of a job type and, when `work` is set, start running its handler and run its start hook.
   *
   * @param definition - The job type
   * @param fastify - Fastify instance handed to the handler factory
   * @param work - Whether this process runs the handler (worker mode)
   * @returns A promise that resolves once the queue exists (and the worker is registered)
   */
  public async register(definition: JobDefinition, fastify: FastifyInstance, work: boolean): Promise<void> {
    await this.boss.createQueue(definition.name, definition.policy);
    if (!work) return;

    const handler: (data: unknown, job: { id: string; retryCount: number }) => Promise<void> =
      definition.createHandler(fastify);
    await this.boss.work(definition.name, async (jobs: Job<unknown>[]): Promise<void> => {
      for (const job of jobs) {
        await handler(job.data, { id: job.id, retryCount: job.retryCount });
      }
    });
    if (definition.cron) await this.boss.schedule(definition.name, definition.cron);
    if (definition.onWorkerStart) {
      await definition.onWorkerStart(fastify).catch((error: unknown): void => {
        this.logger.warn(`The start of the ${definition.name} jobs failed`, { error });
      });
    }
  }

  /**
   * Enqueue a job.
   *
   * @param name - Queue name
   * @param data - Job payload (serialized as JSON)
   * @returns The job id, or `null` when pg-boss deduplicated it
   * @throws Error with status 503 when the queue is not started
   */
  public async send(name: string, data: object): Promise<string | null> {
    if (!this.started) throw httpError(503, 'The job queue is not available yet', { code: 'job_queue_unavailable' });
    return this.boss.send(name, data);
  }

  /**
   * Stop pg-boss, letting active jobs finish within its grace period.
   *
   * @returns A promise that resolves once stopped
   */
  public async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    await this.boss.stop({ graceful: true });
  }
}

/**
 * Fastify plugin that decorates the instance with a {@link JobQueueService}.
 *
 * - Starts pg-boss in the background, retrying with a capped backoff: like the
 *   database, a queue that cannot start at boot is a readiness failure.
 * - Once started, creates the queue of every job in `src/jobs`, and in
 *   `worker` mode starts their handlers.
 * - Registers the `queue` readiness check and stops pg-boss on close.
 *
 * Depends on `HealthServicePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 * @param options - Plugin options
 * @param options.definitions - Job types to register (all of `src/jobs` by default)
 * @param options.factory - pg-boss factory, injectable for tests
 */
async function jobQueuePlugin(
  fastify: FastifyInstance,
  options: { definitions?: JobDefinition[]; factory?: PgBossFactory }
): Promise<void> {
  const logger: Logger = LoggerBuilder.getChildLogger('JobQueuePlugin');
  const queue: JobQueueService = new JobQueueService(options.factory);
  const definitions: JobDefinition[] = options.definitions ?? JOB_DEFINITIONS;
  const work: boolean = appConfig.mode === 'worker';
  let retryTimer: NodeJS.Timeout | undefined;
  let closing = false;

  fastify.decorate('jobQueue', queue);

  fastify.healthService.register('queue', 'readiness', (): void => {
    if (!queue.isStarted) throw new Error('Job queue not started yet');
  });

  /**
   * Start the queue and register the jobs; on failure, schedule another attempt.
   *
   * @param delay - Delay before the attempt after this one, should this one fail
   * @returns A promise that resolves once this attempt is over
   */
  const start: (delay: number) => Promise<void> = async (delay: number): Promise<void> => {
    try {
      await queue.start();
      for (const definition of definitions) await queue.register(definition, fastify, work);
      logger.info(`Job queue started with ${definitions.length} job type(s)${work ? ', workers running' : ''}`);
    } catch (error: unknown) {
      if (closing) return;
      await queue.stop().catch((): void => undefined);
      logger.warn(`Job queue start failed, retrying in ${delay}ms`, { error });
      retryTimer = setTimeout((): void => {
        void start(Math.min(delay * 2, MAX_RETRY_DELAY_IN_MS));
      }, delay);
      retryTimer.unref();
    }
  };

  void start(INITIAL_RETRY_DELAY_IN_MS);

  fastify.addHook('onClose', async (): Promise<void> => {
    closing = true;
    clearTimeout(retryTimer);
    await queue.stop();
  });
}

export default fastifyPlugin(jobQueuePlugin, {
  name: 'JobQueuePlugin',
  dependencies: ['HealthServicePlugin'],
});
