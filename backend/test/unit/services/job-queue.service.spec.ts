import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { AppConfig } from '@configs';
const APP_CONFIG_MOCK: AppConfig = { shutdownTimeout: 10000, drainDelay: 0, mode: 'api' };
jest.mock('@configs', () => {
  const actual: typeof import('@configs') = jest.requireActual('@configs');
  return { ...actual, appConfig: APP_CONFIG_MOCK, databaseConfig: { ...actual.databaseConfig } };
});

import Fastify, { FastifyInstance } from 'fastify';
import { ConstructorOptions, Job, PgBoss } from 'pg-boss';

import { databaseConfig, queueConfig } from '@configs';
import { JOB_DEFINITIONS } from '@src/jobs';
import HealthServicePlugin from '@src/services/health.service';
import JobQueuePlugin, { JobQueueService, PgBossFactory } from '@src/services/job-queue.service';
import { HealthReport } from '@src/types';
import { JobDefinition } from '@src/types/job.types';
import { closeTestApp } from '@test/utils/fastify-test-app.utils';

/** Jest mock of the pg-boss methods the service uses. */
type BossMock = {
  on: jest.Mock;
  start: jest.Mock;
  stop: jest.Mock;
  createQueue: jest.Mock;
  send: jest.Mock;
  work: jest.Mock;
  schedule: jest.Mock;
};

/** Build a pg-boss mock whose calls all succeed. */
function createBossMock(): BossMock {
  return {
    on: jest.fn(),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    createQueue: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue('job-id'),
    work: jest.fn().mockResolvedValue('worker-id'),
    schedule: jest.fn().mockResolvedValue(undefined),
  };
}

/** A promise resolved or rejected from outside. */
type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void };

/** Create a {@link Deferred}. */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise: Promise<T> = new Promise<T>((done: (value: T) => void, fail: (reason: unknown) => void): void => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Let pending promise callbacks and immediates run until the predicate holds. */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) {
    await new Promise<void>((resolve: () => void): NodeJS.Immediate => setImmediate(resolve));
  }
  expect(predicate()).toBe(true);
}

describe('Unit::Services::JobQueueService', () => {
  const FASTIFY: FastifyInstance = {} as FastifyInstance;
  let boss: BossMock;
  let factory: jest.Mock;

  /** A job type whose handler is a jest mock. */
  function definition(overrides: Partial<JobDefinition> = {}): { definition: JobDefinition; handler: jest.Mock } {
    const handler: jest.Mock = jest.fn().mockResolvedValue(undefined);
    return {
      handler,
      definition: {
        name: 'sync.ad-group',
        policy: { retryLimit: 3, retryDelay: 10, retryBackoff: true },
        createHandler: jest.fn().mockReturnValue(handler),
        ...overrides,
      },
    };
  }

  beforeEach((): void => {
    jest.clearAllMocks();
    APP_CONFIG_MOCK.mode = 'api';
    boss = createBossMock();
    factory = jest.fn((_options: ConstructorOptions): PgBoss => boss as unknown as PgBoss);
  });

  describe('constructor', () => {
    afterEach((): void => {
      Object.assign(databaseConfig, { ssl: false, iamAuth: false, region: '' });
    });

    it('should build pg-boss from the database and queue configuration', (): void => {
      new JobQueueService(factory as PgBossFactory);

      expect(factory).toHaveBeenCalledWith({
        host: databaseConfig.host,
        port: databaseConfig.port,
        user: databaseConfig.user,
        password: databaseConfig.password,
        database: databaseConfig.name,
        ssl: undefined,
        schema: queueConfig.schema,
        createSchema: true,
        max: queueConfig.poolSize,
      });
    });

    it('should verify the server certificate when the database requires TLS', (): void => {
      databaseConfig.ssl = true;

      new JobQueueService(factory as PgBossFactory);

      expect(factory).toHaveBeenCalledWith(expect.objectContaining({ ssl: { rejectUnauthorized: true } }));
    });

    it('should sign in with RDS IAM tokens, in the queue schema made by the migrations, with IAM authentication', (): void => {
      Object.assign(databaseConfig, { iamAuth: true, region: 'eu-north-1' });

      new JobQueueService(factory as PgBossFactory);

      expect(factory).toHaveBeenCalledWith(
        expect.objectContaining({ password: expect.any(Function), createSchema: false })
      );
    });

    it('should log the errors pg-boss reports in the background', (): void => {
      new JobQueueService(factory as PgBossFactory);
      const error: Error = new Error('connection terminated');

      expect(boss.on).toHaveBeenCalledWith('error', expect.any(Function));
      boss.on.mock.calls[0][1](error);

      expect(loggerMock.error).toHaveBeenCalledWith('pg-boss reported an error', { code: 'QUEUE::ERROR', error });
    });

    it('should build a real pg-boss instance by default', async (): Promise<void> => {
      const service: JobQueueService = new JobQueueService();

      await service.start();

      expect(service.isStarted).toBe(true);
    });
  });

  describe('start', () => {
    it('should start pg-boss and report the queue as started', async (): Promise<void> => {
      const service: JobQueueService = new JobQueueService(factory as PgBossFactory);
      expect(service.isStarted).toBe(false);

      await service.start();

      expect(boss.start).toHaveBeenCalledTimes(1);
      expect(service.isStarted).toBe(true);
    });

    it('should stay not started when pg-boss fails to start', async (): Promise<void> => {
      boss.start.mockRejectedValue(new Error('ECONNREFUSED'));
      const service: JobQueueService = new JobQueueService(factory as PgBossFactory);

      await expect(service.start()).rejects.toThrow('ECONNREFUSED');
      expect(service.isStarted).toBe(false);
    });
  });

  describe('register', () => {
    it('should only create the queue with its policy when not working', async (): Promise<void> => {
      const { definition: job } = definition();
      const service: JobQueueService = new JobQueueService(factory as PgBossFactory);

      await service.register(job, FASTIFY, false);

      expect(boss.createQueue).toHaveBeenCalledWith('sync.ad-group', {
        retryLimit: 3,
        retryDelay: 10,
        retryBackoff: true,
      });
      expect(job.createHandler).not.toHaveBeenCalled();
      expect(boss.work).not.toHaveBeenCalled();
      expect(boss.schedule).not.toHaveBeenCalled();
    });

    it('should register a worker running the handler for each job of a batch', async (): Promise<void> => {
      const { definition: job, handler } = definition();
      const service: JobQueueService = new JobQueueService(factory as PgBossFactory);

      await service.register(job, FASTIFY, true);

      expect(job.createHandler).toHaveBeenCalledWith(FASTIFY);
      expect(boss.work).toHaveBeenCalledWith('sync.ad-group', expect.any(Function));
      expect(boss.schedule).not.toHaveBeenCalled();

      const work: (jobs: Job<unknown>[]) => Promise<void> = boss.work.mock.calls[0][1];
      await work([
        { id: 'job-1', data: { adGroupId: 'a' }, retryCount: 0 },
        { id: 'job-2', data: { adGroupId: 'b' }, retryCount: 2 },
      ] as unknown as Job<unknown>[]);

      expect(handler).toHaveBeenNthCalledWith(1, { adGroupId: 'a' }, { id: 'job-1', retryCount: 0 });
      expect(handler).toHaveBeenNthCalledWith(2, { adGroupId: 'b' }, { id: 'job-2', retryCount: 2 });
    });

    it('should fail the batch when the handler throws', async (): Promise<void> => {
      const { definition: job, handler } = definition();
      handler.mockRejectedValueOnce(new Error('platform down'));
      const service: JobQueueService = new JobQueueService(factory as PgBossFactory);
      await service.register(job, FASTIFY, true);

      const work: (jobs: Job<unknown>[]) => Promise<void> = boss.work.mock.calls[0][1];

      await expect(
        work([
          { id: 'job-1', data: {}, retryCount: 0 },
          { id: 'job-2', data: {}, retryCount: 0 },
        ] as unknown as Job<unknown>[])
      ).rejects.toThrow('platform down');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should schedule a job type that declares a cron', async (): Promise<void> => {
      const { definition: job } = definition({ name: 'report.daily', cron: '0 3 * * *', policy: undefined });
      const service: JobQueueService = new JobQueueService(factory as PgBossFactory);

      await service.register(job, FASTIFY, true);

      expect(boss.createQueue).toHaveBeenCalledWith('report.daily', undefined);
      expect(boss.schedule).toHaveBeenCalledWith('report.daily', '0 3 * * *');
    });

    it('should run the start hook of a job type in a worker only, once its handler is registered', async (): Promise<void> => {
      const onWorkerStart: jest.Mock = jest.fn(async (): Promise<void> => {
        expect(boss.work).toHaveBeenCalled();
      });
      const { definition: job } = definition({ name: 'geo.import', onWorkerStart });
      const service: JobQueueService = new JobQueueService(factory as PgBossFactory);

      await service.register(job, FASTIFY, false);
      expect(onWorkerStart).not.toHaveBeenCalled();

      await service.register(job, FASTIFY, true);
      expect(onWorkerStart).toHaveBeenCalledWith(FASTIFY);
    });

    it('should log a failed start hook without failing the registration', async (): Promise<void> => {
      const error = new Error('database busy');
      const { definition: job } = definition({
        name: 'geo.import',
        onWorkerStart: jest.fn().mockRejectedValue(error),
      });
      const service: JobQueueService = new JobQueueService(factory as PgBossFactory);

      await expect(service.register(job, FASTIFY, true)).resolves.toBeUndefined();

      expect(loggerMock.warn).toHaveBeenCalledWith('The start of the geo.import jobs failed', { error });
    });
  });

  describe('send', () => {
    it('should answer 503 before the queue is started', async (): Promise<void> => {
      const service: JobQueueService = new JobQueueService(factory as PgBossFactory);

      await expect(service.send('sync.ad-group', { adGroupId: 'a' })).rejects.toMatchObject({
        statusCode: 503,
        message: 'The job queue is not available yet',
        errorCode: 'job_queue_unavailable',
      });
      expect(boss.send).not.toHaveBeenCalled();
    });

    it('should enqueue the job once started', async (): Promise<void> => {
      const service: JobQueueService = new JobQueueService(factory as PgBossFactory);
      await service.start();

      const id: string | null = await service.send('sync.ad-group', { adGroupId: 'a' });

      expect(id).toBe('job-id');
      expect(boss.send).toHaveBeenCalledWith('sync.ad-group', { adGroupId: 'a' });
    });

    it('should return null when pg-boss deduplicates the job', async (): Promise<void> => {
      boss.send.mockResolvedValue(null);
      const service: JobQueueService = new JobQueueService(factory as PgBossFactory);
      await service.start();

      expect(await service.send('sync.ad-group', {})).toBeNull();
    });
  });

  describe('stop', () => {
    it('should do nothing when the queue is not started', async (): Promise<void> => {
      const service: JobQueueService = new JobQueueService(factory as PgBossFactory);

      await service.stop();

      expect(boss.stop).not.toHaveBeenCalled();
    });

    it('should stop pg-boss gracefully once started', async (): Promise<void> => {
      const service: JobQueueService = new JobQueueService(factory as PgBossFactory);
      await service.start();

      await service.stop();

      expect(boss.stop).toHaveBeenCalledWith({ graceful: true });
      expect(service.isStarted).toBe(false);
    });

    it('should stop only once when called twice', async (): Promise<void> => {
      const service: JobQueueService = new JobQueueService(factory as PgBossFactory);
      await service.start();

      await service.stop();
      await service.stop();

      expect(boss.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe('plugin', () => {
    let app: FastifyInstance;

    /** Build an app with the health service and the job queue plugin. */
    async function buildApp(definitions?: JobDefinition[]): Promise<FastifyInstance> {
      const instance: FastifyInstance = Fastify();
      await instance.register(HealthServicePlugin);
      await instance.register(JobQueuePlugin, { definitions, factory: factory as PgBossFactory });
      await instance.ready();
      return instance;
    }

    /** Status of the `queue` readiness check. */
    async function queueCheck(): Promise<HealthReport['checks'][number] | undefined> {
      const report: HealthReport = await app.healthService.report('readiness');
      return report.checks.find((check: { name: string }): boolean => check.name === 'queue');
    }

    afterEach(async (): Promise<void> => {
      await closeTestApp(app);
      jest.useRealTimers();
    });

    it('should decorate the instance with the job queue', async (): Promise<void> => {
      app = await buildApp([]);

      expect(app.jobQueue).toBeInstanceOf(JobQueueService);
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('should report the queue as not ready until it is started', async (): Promise<void> => {
      const starting: Deferred<undefined> = deferred<undefined>();
      boss.start.mockReturnValue(starting.promise);
      app = await buildApp([]);

      expect(await queueCheck()).toEqual({ name: 'queue', status: 'error', message: 'Job queue not started yet' });

      starting.resolve(undefined);
      await waitFor((): boolean => app.jobQueue.isStarted);

      expect(await queueCheck()).toEqual({ name: 'queue', status: 'ok' });
    });

    it('should create the queues without working them in api mode', async (): Promise<void> => {
      const { definition: job } = definition();
      app = await buildApp([job]);

      await waitFor((): boolean => loggerMock.info.mock.calls.length > 0);

      expect(boss.createQueue).toHaveBeenCalledWith('sync.ad-group', job.policy);
      expect(boss.work).not.toHaveBeenCalled();
      expect(loggerMock.info).toHaveBeenCalledWith('Job queue started with 1 job type(s)');
    });

    it('should start the workers in worker mode', async (): Promise<void> => {
      APP_CONFIG_MOCK.mode = 'worker';
      const { definition: job } = definition({ cron: '*/5 * * * *' });
      app = await buildApp([job]);

      await waitFor((): boolean => loggerMock.info.mock.calls.length > 0);

      expect(job.createHandler).toHaveBeenCalledWith(app);
      expect(boss.work).toHaveBeenCalledWith('sync.ad-group', expect.any(Function));
      expect(boss.schedule).toHaveBeenCalledWith('sync.ad-group', '*/5 * * * *');
      expect(loggerMock.info).toHaveBeenCalledWith('Job queue started with 1 job type(s), workers running');
    });

    it('should register every job of src/jobs by default', async (): Promise<void> => {
      app = await buildApp();

      await waitFor((): boolean => loggerMock.info.mock.calls.length > 0);

      expect(loggerMock.info).toHaveBeenCalledWith(`Job queue started with ${JOB_DEFINITIONS.length} job type(s)`);
      // The socle declares no job; each phase adds its queue names here with its JobDefinition.
      expect(boss.createQueue.mock.calls.map((call: unknown[]): unknown => call[0])).toEqual(
        JOB_DEFINITIONS.map((job: { name: string }): string => job.name)
      );
    });

    it('should stop pg-boss when the server closes', async (): Promise<void> => {
      app = await buildApp([]);
      await waitFor((): boolean => app.jobQueue.isStarted);

      await app.close();

      expect(boss.stop).toHaveBeenCalledWith({ graceful: true });
    });

    describe('start failures', () => {
      beforeEach((): void => {
        // Promise callbacks and immediates stay real so Fastify can boot; only the retry timer is driven by hand.
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      });

      it('should retry with a doubling delay until pg-boss starts', async (): Promise<void> => {
        const outage: Error = new Error('ECONNREFUSED');
        boss.start.mockRejectedValueOnce(outage).mockRejectedValueOnce(outage).mockRejectedValueOnce(outage);
        app = await buildApp([]);

        await waitFor((): boolean => loggerMock.warn.mock.calls.length === 1);
        expect(loggerMock.warn).toHaveBeenLastCalledWith('Job queue start failed, retrying in 1000ms', {
          error: outage,
        });
        expect(app.jobQueue.isStarted).toBe(false);

        await jest.advanceTimersByTimeAsync(999);
        expect(boss.start).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(1);
        await waitFor((): boolean => loggerMock.warn.mock.calls.length === 2);
        expect(boss.start).toHaveBeenCalledTimes(2);
        expect(loggerMock.warn).toHaveBeenLastCalledWith('Job queue start failed, retrying in 2000ms', {
          error: outage,
        });

        await jest.advanceTimersByTimeAsync(2000);
        await waitFor((): boolean => loggerMock.warn.mock.calls.length === 3);
        expect(loggerMock.warn).toHaveBeenLastCalledWith('Job queue start failed, retrying in 4000ms', {
          error: outage,
        });

        await jest.advanceTimersByTimeAsync(4000);
        await waitFor((): boolean => app.jobQueue.isStarted);
        expect(boss.start).toHaveBeenCalledTimes(4);
        expect(loggerMock.info).toHaveBeenCalledWith('Job queue started with 0 job type(s)');
      });

      it('should cap the delay between two attempts at 30 s', async (): Promise<void> => {
        boss.start.mockRejectedValue(new Error('ECONNREFUSED'));
        app = await buildApp([]);
        const delays: number[] = [1000, 2000, 4000, 8000, 16000, 30000, 30000];

        for (const [index, delay] of delays.entries()) {
          await waitFor((): boolean => loggerMock.warn.mock.calls.length === index + 1);
          expect(loggerMock.warn).toHaveBeenLastCalledWith(
            `Job queue start failed, retrying in ${delay}ms`,
            expect.anything()
          );
          await jest.advanceTimersByTimeAsync(delay);
        }
        expect(boss.start).toHaveBeenCalledTimes(delays.length + 1);
      });

      it('should stop a half-started queue before retrying, even if stopping fails', async (): Promise<void> => {
        const failure: Error = new Error('permission denied for schema pgboss');
        const { definition: job } = definition();
        boss.createQueue.mockRejectedValueOnce(failure);
        boss.stop.mockRejectedValueOnce(new Error('already stopped'));
        app = await buildApp([job]);

        await waitFor((): boolean => loggerMock.warn.mock.calls.length === 1);
        expect(boss.stop).toHaveBeenCalledWith({ graceful: true });
        expect(app.jobQueue.isStarted).toBe(false);
        expect(loggerMock.warn).toHaveBeenCalledWith('Job queue start failed, retrying in 1000ms', { error: failure });

        await jest.advanceTimersByTimeAsync(1000);
        await waitFor((): boolean => app.jobQueue.isStarted);
        expect(boss.createQueue).toHaveBeenCalledTimes(2);
      });

      it('should cancel the pending retry when the server closes', async (): Promise<void> => {
        boss.start.mockRejectedValue(new Error('ECONNREFUSED'));
        app = await buildApp([]);
        await waitFor((): boolean => loggerMock.warn.mock.calls.length === 1);

        await app.close();
        await jest.advanceTimersByTimeAsync(60000);

        expect(boss.start).toHaveBeenCalledTimes(1);
        expect(boss.stop).not.toHaveBeenCalled();
      });

      it('should not retry an attempt that fails once the server is closing', async (): Promise<void> => {
        const starting: Deferred<undefined> = deferred<undefined>();
        boss.start.mockReturnValue(starting.promise);
        app = await buildApp([]);

        await app.close();
        starting.reject(new Error('pool ended'));
        await jest.advanceTimersByTimeAsync(60000);

        expect(loggerMock.warn).not.toHaveBeenCalled();
        expect(boss.start).toHaveBeenCalledTimes(1);
      });
    });
  });
});
