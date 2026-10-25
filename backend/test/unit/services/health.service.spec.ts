import { HealthService } from '@services';
import { HealthReport } from '@src/types';

describe('Unit::Services::HealthService', () => {
  let service: HealthService;

  beforeEach((): void => {
    service = new HealthService();
  });

  describe('readiness gate', () => {
    it('should not be ready before setReady is called', async (): Promise<void> => {
      expect(service.isReady()).toBe(false);

      const report: HealthReport = await service.report('readiness');

      expect(report.status).toBe('error');
      expect(report.checks).toEqual([
        { name: 'app', status: 'error', message: 'Application is not accepting traffic' },
      ]);
    });

    it('should be ready once setReady(true) is called', async (): Promise<void> => {
      service.setReady(true);

      expect(service.isReady()).toBe(true);
      const report: HealthReport = await service.report('readiness');
      expect(report).toEqual({ status: 'ok', checks: [{ name: 'app', status: 'ok' }] });
    });

    it('should stop being ready once setReady(false) is called', async (): Promise<void> => {
      service.setReady(true);
      service.setReady(false);

      const report: HealthReport = await service.report('readiness');
      expect(report.status).toBe('error');
    });

    it('should report ok for liveness even when not ready', async (): Promise<void> => {
      const report: HealthReport = await service.report('liveness');

      expect(report).toEqual({ status: 'ok', checks: [] });
    });
  });

  describe('register', () => {
    it('should report a passing check as ok', async (): Promise<void> => {
      service.setReady(true);
      service.register('postgres', 'readiness', (): void => {});

      const report: HealthReport = await service.report('readiness');

      expect(report.status).toBe('ok');
      expect(report.checks).toContainEqual({ name: 'postgres', status: 'ok' });
    });

    it('should report a throwing check as error with its message', async (): Promise<void> => {
      service.setReady(true);
      service.register('postgres', 'readiness', (): void => {
        throw new Error('ECONNREFUSED');
      });

      const report: HealthReport = await service.report('readiness');

      expect(report.status).toBe('error');
      expect(report.checks).toContainEqual({ name: 'postgres', status: 'error', message: 'ECONNREFUSED' });
    });

    it('should report a rejecting async check as error', async (): Promise<void> => {
      service.setReady(true);
      service.register('redis', 'readiness', async (): Promise<void> => {
        await Promise.reject(new Error('timeout'));
      });

      const report: HealthReport = await service.report('readiness');

      expect(report.checks).toContainEqual({ name: 'redis', status: 'error', message: 'timeout' });
    });

    it('should stringify a non-Error rejection reason', async (): Promise<void> => {
      service.setReady(true);

      service.register('weird', 'readiness', (): void => {
        throw 'boom';
      });

      const report: HealthReport = await service.report('readiness');

      expect(report.checks).toContainEqual({ name: 'weird', status: 'error', message: 'boom' });
    });

    it('should replace a check registered under the same name', async (): Promise<void> => {
      service.register('dep', 'liveness', (): void => {
        throw new Error('first');
      });
      service.register('dep', 'liveness', (): void => {});

      const report: HealthReport = await service.report('liveness');

      expect(report.checks).toEqual([{ name: 'dep', status: 'ok' }]);
    });

    it('should keep liveness and readiness checks separate', async (): Promise<void> => {
      service.setReady(true);
      service.register('deadlock', 'liveness', (): void => {});
      service.register('postgres', 'readiness', (): void => {});

      const liveness: HealthReport = await service.report('liveness');
      const readiness: HealthReport = await service.report('readiness');

      expect(liveness.checks.map((c: { name: string }): string => c.name)).toEqual(['deadlock']);
      expect(readiness.checks.map((c: { name: string }): string => c.name)).toEqual(['app', 'postgres']);
    });
  });

  describe('report', () => {
    it('should run every check when no kind is given', async (): Promise<void> => {
      service.setReady(true);
      service.register('deadlock', 'liveness', (): void => {});
      service.register('postgres', 'readiness', (): void => {});

      const report: HealthReport = await service.report();

      expect(report.status).toBe('ok');
      expect(report.checks.map((c: { name: string }): string => c.name).sort()).toEqual([
        'app',
        'deadlock',
        'postgres',
      ]);
    });

    it('should be error when any check of the aggregate fails', async (): Promise<void> => {
      service.setReady(true);
      service.register('deadlock', 'liveness', (): void => {
        throw new Error('stuck');
      });

      const report: HealthReport = await service.report();

      expect(report.status).toBe('error');
    });
  });
});
