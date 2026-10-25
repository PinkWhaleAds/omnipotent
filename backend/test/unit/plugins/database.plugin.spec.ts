import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

/** The part of a TypeORM data source the plugin touches. */
type FakeDataSource = {
  isInitialized: boolean;
  initialize: jest.Mock;
  destroy: jest.Mock;
  query: jest.Mock;
};
const dataSource: FakeDataSource = {
  isInitialized: false,
  initialize: jest.fn(),
  destroy: jest.fn(),
  query: jest.fn(),
};
const createDataSourceMock: jest.Mock = jest.fn((): FakeDataSource => dataSource);
jest.mock('@src/database/data-source', () => ({
  createDataSource: createDataSourceMock,
}));

import Fastify, { FastifyInstance } from 'fastify';

import DatabasePlugin from '@src/plugins/database.plugin';
import HealthServicePlugin from '@src/services/health.service';
import { HealthCheckResult, HealthReport } from '@src/types';
import { closeTestApp } from '@test/utils/fastify-test-app.utils';

describe('Unit::Plugins::DatabasePlugin', () => {
  let app: FastifyInstance;

  /** Builds an app with the real health service and the plugin under test. */
  async function buildApp(): Promise<FastifyInstance> {
    const instance: FastifyInstance = Fastify();
    await instance.register(HealthServicePlugin);
    await instance.register(DatabasePlugin);
    await instance.ready();
    return instance;
  }

  /** Lets the pending connection attempt settle. */
  async function settle(): Promise<void> {
    await jest.advanceTimersByTimeAsync(0);
  }

  /** The outcome of the `postgres` readiness check. */
  async function postgresCheck(): Promise<HealthCheckResult | undefined> {
    const report: HealthReport = await app.healthService.report('readiness');
    return report.checks.find((check: HealthCheckResult): boolean => check.name === 'postgres');
  }

  /** Makes the next `initialize()` calls fail `failures` times, then succeed. */
  function failConnections(failures: number): void {
    for (let attempt = 0; attempt < failures; attempt++) {
      dataSource.initialize.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    }
  }

  beforeEach((): void => {
    jest.clearAllMocks();
    // Only the retry timer is faked: Fastify and inject need real immediates and ticks.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'queueMicrotask'] });
    dataSource.isInitialized = false;
    dataSource.initialize.mockImplementation(async (): Promise<FakeDataSource> => {
      dataSource.isInitialized = true;
      return dataSource;
    });
    dataSource.destroy.mockImplementation(async (): Promise<void> => {
      dataSource.isInitialized = false;
    });
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
    jest.useRealTimers();
  });

  it('should decorate the instance with the data source', async (): Promise<void> => {
    app = await buildApp();

    expect(createDataSourceMock).toHaveBeenCalledTimes(1);
    expect(app.db).toBe(dataSource);
  });

  it('should connect in the background', async (): Promise<void> => {
    app = await buildApp();
    await settle();

    expect(dataSource.initialize).toHaveBeenCalledTimes(1);
    expect(loggerMock.info).toHaveBeenCalledWith('Connected to the database');
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  describe('postgres readiness check', () => {
    it('should fail until the connection is established', async (): Promise<void> => {
      dataSource.initialize.mockReturnValue(new Promise((): void => {}));
      app = await buildApp();

      expect(await postgresCheck()).toEqual({
        name: 'postgres',
        status: 'error',
        message: 'Database connection not established yet',
      });
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('should run SELECT 1 once connected', async (): Promise<void> => {
      app = await buildApp();
      await settle();

      expect(await postgresCheck()).toEqual({ name: 'postgres', status: 'ok' });
      expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('should fail when SELECT 1 fails', async (): Promise<void> => {
      dataSource.query.mockRejectedValue(new Error('Connection terminated unexpectedly'));
      app = await buildApp();
      await settle();

      expect(await postgresCheck()).toEqual({
        name: 'postgres',
        status: 'error',
        message: 'Connection terminated unexpectedly',
      });
    });
  });

  describe('retries', () => {
    it('should retry with a doubling delay capped at 30 seconds', async (): Promise<void> => {
      failConnections(7);
      app = await buildApp();
      await settle();

      const expectedDelays: number[] = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
      for (const [attempt, delay] of expectedDelays.entries()) {
        expect(dataSource.initialize).toHaveBeenCalledTimes(attempt + 1);
        expect(loggerMock.warn).toHaveBeenLastCalledWith(`Database connection failed, retrying in ${delay}ms`, {
          error: expect.objectContaining({ message: 'ECONNREFUSED' }),
        });

        // Nothing happens before the delay is over.
        await jest.advanceTimersByTimeAsync(delay - 1);
        expect(dataSource.initialize).toHaveBeenCalledTimes(attempt + 1);
        await jest.advanceTimersByTimeAsync(1);
      }

      expect(dataSource.initialize).toHaveBeenCalledTimes(8);
      expect(loggerMock.warn).toHaveBeenCalledTimes(7);
      expect(loggerMock.info).toHaveBeenCalledWith('Connected to the database');
      expect(jest.getTimerCount()).toBe(0);
    });

    it('should not keep the process alive while waiting to retry', async (): Promise<void> => {
      const setTimeoutSpy: jest.SpyInstance = jest.spyOn(global, 'setTimeout');
      failConnections(1);
      app = await buildApp();
      await settle();

      const retryCall: number = setTimeoutSpy.mock.calls.findIndex(
        ([, delay]: [unknown, number]): boolean => delay === 1000
      );
      expect(retryCall).toBeGreaterThanOrEqual(0);
      const timer: NodeJS.Timeout = setTimeoutSpy.mock.results[retryCall].value;
      expect(timer.hasRef()).toBe(false);
      setTimeoutSpy.mockRestore();
    });

    it('should cancel a pending retry when closing', async (): Promise<void> => {
      failConnections(1);
      app = await buildApp();
      await settle();
      expect(jest.getTimerCount()).toBe(1);

      await app.close();
      await jest.advanceTimersByTimeAsync(60000);

      expect(dataSource.initialize).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('should not schedule a retry for an attempt failing once closing', async (): Promise<void> => {
      let failPendingAttempt: (error: Error) => void = (): void => {};
      dataSource.initialize.mockReturnValueOnce(
        new Promise((_resolve: (value: unknown) => void, reject: (error: Error) => void): void => {
          failPendingAttempt = reject;
        })
      );
      app = await buildApp();

      await app.close();
      failPendingAttempt(new Error('Connection aborted'));
      await settle();

      expect(loggerMock.warn).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('onClose', () => {
    it('should destroy the data source once connected', async (): Promise<void> => {
      app = await buildApp();
      await settle();

      await app.close();

      expect(dataSource.destroy).toHaveBeenCalledTimes(1);
    });

    it('should not destroy a data source that never connected', async (): Promise<void> => {
      failConnections(1);
      app = await buildApp();
      await settle();

      await app.close();

      expect(dataSource.destroy).not.toHaveBeenCalled();
    });
  });
});
