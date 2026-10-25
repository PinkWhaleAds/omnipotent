import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { setupFastifyAppForTest, closeTestApp } from '@test/utils/fastify-test-app.utils';

import HealthController from '@modules/health/health.controller';
import HealthServicePlugin from '@src/services/health.service';
import { PublicHealthReport } from '@src/types';

describe('Unit::HealthController', () => {
  let app: FastifyInstance;

  beforeEach(async (): Promise<void> => {
    jest.clearAllMocks();
    app = await setupFastifyAppForTest(HealthController, [HealthServicePlugin]);
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  /** Injects a GET on the given probe URL. */
  async function probe(url: string): Promise<LightMyRequestResponse> {
    return app.inject({ method: 'GET', url });
  }

  describe('getLivez', () => {
    it('should return 200 even before the app is ready', async (): Promise<void> => {
      const response: LightMyRequestResponse = await probe('/livez');

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ status: 'ok', checks: [] });
    });

    it('should return 503 when a liveness check fails', async (): Promise<void> => {
      app.healthService.register('deadlock', 'liveness', (): void => {
        throw new Error('event loop stuck');
      });

      const response: LightMyRequestResponse = await probe('/livez');

      expect(response.statusCode).toBe(503);
      const body: PublicHealthReport = JSON.parse(response.body);
      // The probes are public: the reason only goes to the logs.
      expect(body.checks).toContainEqual({ name: 'deadlock', status: 'error' });
      expect(response.body).not.toContain('event loop stuck');
      expect(loggerMock.warn).toHaveBeenCalledWith('Health check deadlock failed', {
        probe: 'liveness',
        check: 'deadlock',
        reason: 'event loop stuck',
      });
    });
  });

  describe('getReadyz', () => {
    it('should return 503 while the app is not ready', async (): Promise<void> => {
      const response: LightMyRequestResponse = await probe('/readyz');

      expect(response.statusCode).toBe(503);
      const body: PublicHealthReport = JSON.parse(response.body);
      expect(body).toEqual({ status: 'error', checks: [{ name: 'app', status: 'error' }] });
    });

    it('should return 200 once the app is ready', async (): Promise<void> => {
      app.healthService.setReady(true);

      const response: LightMyRequestResponse = await probe('/readyz');

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ status: 'ok', checks: [{ name: 'app', status: 'ok' }] });
    });

    it('should return 503 again once the app stops being ready', async (): Promise<void> => {
      app.healthService.setReady(true);
      app.healthService.setReady(false);

      const response: LightMyRequestResponse = await probe('/readyz');

      expect(response.statusCode).toBe(503);
    });

    it('should return 503 when a readiness dependency fails', async (): Promise<void> => {
      app.healthService.setReady(true);
      app.healthService.register('postgres', 'readiness', (): void => {
        throw new Error('ECONNREFUSED');
      });

      const response: LightMyRequestResponse = await probe('/readyz');

      expect(response.statusCode).toBe(503);
      const body: PublicHealthReport = JSON.parse(response.body);
      expect(body.checks).toContainEqual({ name: 'postgres', status: 'error' });
      expect(response.body).not.toContain('ECONNREFUSED');
      expect(loggerMock.warn).toHaveBeenCalledWith('Health check postgres failed', {
        probe: 'readiness',
        check: 'postgres',
        reason: 'ECONNREFUSED',
      });
    });
  });

  describe('getHealthz', () => {
    it('should aggregate liveness and readiness checks', async (): Promise<void> => {
      app.healthService.setReady(true);
      app.healthService.register('deadlock', 'liveness', (): void => {});
      app.healthService.register('postgres', 'readiness', (): void => {});

      const response: LightMyRequestResponse = await probe('/healthz');

      expect(response.statusCode).toBe(200);
      const body: PublicHealthReport = JSON.parse(response.body);
      expect(body.checks.map((check: { name: string }): string => check.name).sort()).toEqual([
        'app',
        'deadlock',
        'postgres',
      ]);
    });

    it('should return 503 when the app is not ready', async (): Promise<void> => {
      const response: LightMyRequestResponse = await probe('/healthz');

      expect(response.statusCode).toBe(503);
      expect(loggerMock.warn).toHaveBeenCalledWith('Health check app failed', {
        probe: 'all',
        check: 'app',
        reason: 'Application is not accepting traffic',
      });
    });
  });
});
