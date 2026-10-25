import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { FastifyMock, FASTIFY_INSTANCE_MOCK } from '@test/unit/mocks/fastify.mock';
jest.mock('fastify', () => FastifyMock);

import FastifyMultipart from '@fastify/multipart';

import { Controllers, ProbeControllers } from '@modules';
import AccessLogPlugin from '@src/plugins/access-log.plugin';
import AuthPlugin from '@src/plugins/auth.plugin';
import DatabasePlugin from '@src/plugins/database.plugin';
import McpPlugin from '@src/plugins/mcp.plugin';
import RateLimitPlugin from '@src/plugins/rate-limit.plugin';
import SwaggerPlugin from '@src/plugins/swagger.plugin';
import ValidationPlugin from '@src/plugins/validation.plugin';
import { HttpServer } from '@src/server/http-server';
import AccessServicePlugin from '@src/services/access.service';
import HealthServicePlugin from '@src/services/health.service';
import JobQueuePlugin from '@src/services/job-queue.service';
import SecretStorePlugin from '@src/services/secret-store.service';
import StorageServicePlugin from '@src/services/storage.service';
import TokenVerifierPlugin from '@src/services/token-verifier.service';
import { callPrivateMethod, callPrivateMethodAsync, setPrivateProperty } from '@test/utils';

describe('Unit::HttpServer', () => {
  let server: HttpServer;

  beforeEach((): void => {
    jest.clearAllMocks();

    server = new HttpServer();
  });

  describe('listenApp', () => {
    it('should call given callback when there is no error', async (): Promise<void> => {
      FASTIFY_INSTANCE_MOCK.listen.mockResolvedValueOnce('address');

      const callback: jest.Mock = jest.fn();
      await callPrivateMethodAsync(server, 'listenApp', callback);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should throw if fastify listen has an error', async (): Promise<void> => {
      const error: Error = new Error('fail listen');
      FASTIFY_INSTANCE_MOCK.listen.mockRejectedValueOnce(error);

      const callback: jest.Mock = jest.fn();
      await expect(callPrivateMethodAsync(server, 'listenApp', callback)).rejects.toThrow(error);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should throw if fastify register has an error', async (): Promise<void> => {
      const error: Error = new Error('fail register');
      FASTIFY_INSTANCE_MOCK.register.mockRejectedValueOnce(error);

      const callback: jest.Mock = jest.fn();
      await expect(callPrivateMethodAsync(server, 'listenApp', callback)).rejects.toThrow(error);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('initFastifyInstance', () => {
    /** The plugins registered on the Fastify instance, in order. */
    function registeredPlugins(): unknown[] {
      return FASTIFY_INSTANCE_MOCK.register.mock.calls.map(([plugin]: [unknown]): unknown => plugin);
    }

    it('should register everything in api mode', async (): Promise<void> => {
      server = new HttpServer('api');

      await callPrivateMethodAsync(server, 'initFastifyInstance');

      const plugins: unknown[] = registeredPlugins();
      expect(plugins).toEqual(
        expect.arrayContaining([
          SwaggerPlugin,
          DatabasePlugin,
          JobQueuePlugin,
          StorageServicePlugin,
          SecretStorePlugin,
          AccessServicePlugin,
          TokenVerifierPlugin,
          AuthPlugin,
          McpPlugin,
          Controllers,
        ])
      );
      expect(plugins).not.toContain(ProbeControllers);
      // Swagger must see the routes, so it comes before the controllers.
      expect(plugins.indexOf(SwaggerPlugin)).toBeLessThan(plugins.indexOf(Controllers));
      // The validator compiler only applies to the routes registered after it: Swagger's, MCP's, the controllers.
      expect(plugins).toContain(ValidationPlugin);
      expect(plugins.indexOf(ValidationPlugin)).toBeLessThan(plugins.indexOf(SwaggerPlugin));
      expect(plugins.indexOf(ValidationPlugin)).toBeLessThan(plugins.indexOf(McpPlugin));
      // The health service owns the readiness checks the database and the queue register.
      expect(plugins.indexOf(HealthServicePlugin)).toBeLessThan(plugins.indexOf(DatabasePlugin));
      expect(plugins.indexOf(HealthServicePlugin)).toBeLessThan(plugins.indexOf(JobQueuePlugin));
      // Every domain service of a phase checks a role, so permissions come before the controllers.
      expect(plugins.indexOf(AccessServicePlugin)).toBeLessThan(plugins.indexOf(Controllers));
      // The auth plugin reads the token verifier, and the access service to resolve the caller.
      expect(plugins.indexOf(TokenVerifierPlugin)).toBeLessThan(plugins.indexOf(AuthPlugin));
      expect(plugins.indexOf(AccessServicePlugin)).toBeLessThan(plugins.indexOf(AuthPlugin));
      // Uploads read multipart bodies.
      expect(plugins).toContain(FastifyMultipart);
      expect(plugins.indexOf(FastifyMultipart)).toBeLessThan(plugins.indexOf(Controllers));
      // Every request is logged; the rate limit applies to the routes registered after it, Swagger's included.
      expect(plugins).toContain(AccessLogPlugin);
      expect(plugins.indexOf(RateLimitPlugin)).toBeLessThan(plugins.indexOf(SwaggerPlugin));
      expect(plugins.indexOf(RateLimitPlugin)).toBeLessThan(plugins.indexOf(AuthPlugin));
      expect(plugins[plugins.length - 1]).toBe(Controllers);
    });

    it('should default to the configured mode', async (): Promise<void> => {
      await callPrivateMethodAsync(server, 'initFastifyInstance');

      expect(registeredPlugins()).toContain(Controllers);
    });

    it('should only register the infrastructure and the probe routes in worker mode', async (): Promise<void> => {
      server = new HttpServer('worker');

      await callPrivateMethodAsync(server, 'initFastifyInstance');

      const plugins: unknown[] = registeredPlugins();
      expect(plugins).toEqual(
        expect.arrayContaining([ValidationPlugin, AccessLogPlugin, HealthServicePlugin, DatabasePlugin, JobQueuePlugin])
      );
      expect(plugins.indexOf(ValidationPlugin)).toBeLessThan(plugins.indexOf(ProbeControllers));
      expect(plugins[plugins.length - 1]).toBe(ProbeControllers);
      for (const apiOnly of [
        RateLimitPlugin,
        SwaggerPlugin,
        FastifyMultipart,
        TokenVerifierPlugin,
        AuthPlugin,
        McpPlugin,
      ]) {
        expect(plugins).not.toContain(apiOnly);
      }
      expect(plugins).not.toContain(Controllers);
    });

    it('should listen in worker mode', async (): Promise<void> => {
      server = new HttpServer('worker');
      FASTIFY_INSTANCE_MOCK.listen.mockResolvedValueOnce('address');

      const callback: jest.Mock = jest.fn();
      await callPrivateMethodAsync(server, 'listenApp', callback);

      expect(FASTIFY_INSTANCE_MOCK.listen).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('markReady / markNotReady', () => {
    it('should forward the readiness state to the health service', (): void => {
      FASTIFY_INSTANCE_MOCK.hasDecorator.mockReturnValue(true);

      server.markReady();
      expect(FASTIFY_INSTANCE_MOCK.healthService.setReady).toHaveBeenCalledWith(true);

      server.markNotReady();
      expect(FASTIFY_INSTANCE_MOCK.healthService.setReady).toHaveBeenCalledWith(false);
    });

    it('should do nothing when the health service is not decorated yet', (): void => {
      FASTIFY_INSTANCE_MOCK.hasDecorator.mockReturnValue(false);

      server.markNotReady();

      expect(FASTIFY_INSTANCE_MOCK.healthService.setReady).not.toHaveBeenCalled();
    });
  });

  describe('closeApp', () => {
    it('should call fastify.close', (): void => {
      const spyClose: jest.Mock = jest.fn();
      setPrivateProperty(server, 'fastify', { close: spyClose });

      callPrivateMethod(server, 'closeApp', (): void => {});
      expect(spyClose).toHaveBeenCalledTimes(1);
    });
  });
});
