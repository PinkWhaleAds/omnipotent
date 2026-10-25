import Fastify, { FastifyInstance } from 'fastify';

import { StatusService } from '@services';
import StatusServicePlugin from '@src/services/status.service';
import { StatusResult } from '@src/types';

describe('Unit::Services::StatusService', () => {
  describe('getStatus', () => {
    it('should return an object with app_name, app_version, and timestamp', (): void => {
      const service: StatusService = new StatusService();
      const result: StatusResult = service.getStatus();

      expect(result).toHaveProperty('app_name');
      expect(result).toHaveProperty('app_version');
      expect(result).toHaveProperty('timestamp');
      expect(typeof result.app_name).toBe('string');
      expect(typeof result.app_version).toBe('string');
      expect(typeof result.timestamp).toBe('number');
    });

    it('should return a recent timestamp', (): void => {
      const before: number = Date.now();
      const service: StatusService = new StatusService();
      const result: StatusResult = service.getStatus();
      const after: number = Date.now();

      expect(result.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('StatusServicePlugin', () => {
    it('should decorate the instance with a StatusService', async (): Promise<void> => {
      const app: FastifyInstance = Fastify();
      await app.register(StatusServicePlugin);
      await app.ready();

      expect(app.statusService).toBeInstanceOf(StatusService);

      await app.close();
    });
  });
});
