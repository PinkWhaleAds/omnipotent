import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

const ENV_MOCK: { IS_DEV_ENV: boolean } = {
  ...jest.requireActual('@constants/common.constants'),
  IS_DEV_ENV: false,
};
jest.mock('@constants', () => ENV_MOCK);

import { FastifyInstance, FastifyPluginAsync, LightMyRequestResponse } from 'fastify';
import { createFastifyAppWithRegistration, closeTestApp } from '@test/utils/fastify-test-app.utils';

import ErrorHandlerPlugin from '@src/plugins/error-handler.plugin';
import { ErrorResponse } from '@src/types';
import { httpError } from '@utils';

describe('Unit::ErrorHandlerPlugin', () => {
  let app: FastifyInstance;

  /** Registers the plugin plus the routes each test needs to trigger a failure. */
  async function buildApp(routes: FastifyPluginAsync): Promise<FastifyInstance> {
    const instance: FastifyInstance = await createFastifyAppWithRegistration(ErrorHandlerPlugin, [routes]);
    await instance.ready();
    return instance;
  }

  beforeEach((): void => {
    jest.clearAllMocks();
    ENV_MOCK.IS_DEV_ENV = false;
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  describe('setNotFoundHandler', () => {
    it('should answer 404 with the error response shape', async (): Promise<void> => {
      app = await buildApp(async (): Promise<void> => {});

      const response: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/nope' });

      expect(response.statusCode).toBe(404);
      const body: ErrorResponse = JSON.parse(response.body);
      expect(body).toEqual({
        statusCode: 404,
        error: 'Not Found',
        code: 'route_not_found',
        params: { method: 'GET', url: '/nope' },
        message: 'Route GET /nope not found',
        requestId: expect.any(String),
      });
    });
  });

  describe('setErrorHandler', () => {
    it('should hide the message of an unexpected 5xx outside development', async (): Promise<void> => {
      app = await buildApp(async (instance: FastifyInstance): Promise<void> => {
        instance.get('/boom', async (): Promise<void> => {
          throw new Error('postgres://user:hunter2@db:5432 refused the connection');
        });
      });

      const response: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/boom' });

      expect(response.statusCode).toBe(500);
      const body: ErrorResponse = JSON.parse(response.body);
      expect(body).toEqual({
        statusCode: 500,
        error: 'Internal Server Error',
        code: 'internal_error',
        params: {},
        message: 'Internal Server Error',
        requestId: expect.any(String),
      });
      // The detail is not lost — it goes to the logs, correlated by requestId.
      expect(loggerMock.error).toHaveBeenCalledWith('GET /boom failed with 500', {
        code: 'REQUEST::FAILED',
        requestId: body.requestId,
        error: expect.objectContaining({ message: expect.stringContaining('hunter2') }),
      });
    });

    it('should expose the real message of a 5xx in development', async (): Promise<void> => {
      ENV_MOCK.IS_DEV_ENV = true;
      app = await buildApp(async (instance: FastifyInstance): Promise<void> => {
        instance.get('/boom', async (): Promise<void> => {
          throw new Error('the real reason');
        });
      });

      const response: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/boom' });

      expect(JSON.parse(response.body).message).toBe('the real reason');
    });

    it('should log the path of a failed request without its query string', async (): Promise<void> => {
      app = await buildApp(async (instance: FastifyInstance): Promise<void> => {
        instance.get('/email/unsubscribe', async (): Promise<void> => {
          throw httpError(400, 'Bad link', { code: 'unsubscribe_token_invalid' });
        });
      });

      await app.inject({ method: 'GET', url: '/email/unsubscribe?token=secret-token' });

      expect(loggerMock.warn).toHaveBeenCalledWith('GET /email/unsubscribe rejected with 400: Bad link', {
        requestId: expect.any(String),
      });
      expect(JSON.stringify(loggerMock.warn.mock.calls)).not.toContain('secret-token');
    });

    it('should pass a 4xx message through and log it as a warning', async (): Promise<void> => {
      app = await buildApp(async (instance: FastifyInstance): Promise<void> => {
        instance.get('/teapot', async (): Promise<void> => {
          const error: Error & { statusCode?: number } = new Error('I only brew tea');
          error.statusCode = 418;
          throw error;
        });
      });

      const response: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/teapot' });

      expect(response.statusCode).toBe(418);
      const body: ErrorResponse = JSON.parse(response.body);
      expect(body.error).toBe("I'm a Teapot");
      expect(body.message).toBe('I only brew tea');
      expect(loggerMock.warn).toHaveBeenCalledWith('GET /teapot rejected with 418: I only brew tea', {
        requestId: expect.any(String),
      });
      expect(loggerMock.error).not.toHaveBeenCalled();
    });

    it('should turn a schema validation failure into a 400', async (): Promise<void> => {
      app = await buildApp(async (instance: FastifyInstance): Promise<void> => {
        instance.route({
          method: 'POST',
          url: '/foos',
          schema: {
            body: {
              type: 'object',
              required: ['name'],
              properties: { name: { type: 'string' } },
            },
          },
          handler: async (): Promise<void> => {},
        });
      });

      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/foos',
        payload: { nope: 1 },
      });

      expect(response.statusCode).toBe(400);
      const body: ErrorResponse = JSON.parse(response.body);
      expect(body.error).toBe('Bad Request');
      expect(body.code).toBe('validation_failed');
      expect(body.params).toEqual({ field: 'name', rule: 'required', location: 'body' });
      expect(body.message).toContain('name');
      expect(body.requestId).toEqual(expect.any(String));
    });

    it('should name a nested field refused by its schema', async (): Promise<void> => {
      app = await buildApp(async (instance: FastifyInstance): Promise<void> => {
        instance.route({
          method: 'POST',
          url: '/foos',
          schema: {
            body: {
              type: 'object',
              properties: { bidding: { type: 'object', properties: { amount: { type: 'number' } } } },
            },
          },
          handler: async (): Promise<void> => {},
        });
      });

      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/foos',
        payload: { bidding: { amount: 'ten' } },
      });

      expect(JSON.parse(response.body).params).toEqual({ field: 'bidding.amount', rule: 'type', location: 'body' });
    });

    it('should keep the code of a validation failure that names no field, rule or location', async (): Promise<void> => {
      app = await buildApp(async (instance: FastifyInstance): Promise<void> => {
        instance.get('/odd', async (): Promise<void> => {
          const error: Error & { statusCode?: number; validation?: object[] } = new Error('Odd input');
          error.statusCode = 400;
          error.validation = [{}];
          throw error;
        });
      });

      const response: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/odd' });

      expect(JSON.parse(response.body)).toMatchObject({
        code: 'validation_failed',
        params: { field: null, rule: null, location: null },
      });
    });

    it('should answer the code and values of an httpError', async (): Promise<void> => {
      app = await buildApp(async (instance: FastifyInstance): Promise<void> => {
        instance.post('/launch', async (): Promise<void> => {
          throw httpError(409, 'Only a draft can be launched', {
            code: 'campaign_not_draft',
            params: { status: 'active' },
          });
        });
      });

      const response: LightMyRequestResponse = await app.inject({ method: 'POST', url: '/launch' });

      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body)).toMatchObject({
        code: 'campaign_not_draft',
        params: { status: 'active' },
        message: 'Only a draft can be launched',
      });
    });

    it('should give a plain 4xx the code of its status', async (): Promise<void> => {
      app = await buildApp(async (instance: FastifyInstance): Promise<void> => {
        instance.get('/gone', async (): Promise<void> => {
          const error: Error & { statusCode?: number } = new Error('Gone missing');
          error.statusCode = 404;
          throw error;
        });
      });

      const response: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/gone' });

      expect(JSON.parse(response.body)).toMatchObject({ code: 'not_found', params: {} });
    });

    it('should fall back to a generic message when a 4xx carries none', async (): Promise<void> => {
      app = await buildApp(async (instance: FastifyInstance): Promise<void> => {
        instance.get('/blank', async (): Promise<void> => {
          const error: Error & { statusCode?: number } = new Error('');
          error.statusCode = 409;
          throw error;
        });
      });

      const response: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/blank' });

      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).message).toBe('Internal Server Error');
    });

    it('should label a non-standard status code generically', async (): Promise<void> => {
      app = await buildApp(async (instance: FastifyInstance): Promise<void> => {
        instance.get('/weird', async (): Promise<void> => {
          const error: Error & { statusCode?: number } = new Error('client closed request');
          error.statusCode = 499;
          throw error;
        });
      });

      const response: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/weird' });

      expect(response.statusCode).toBe(499);
      expect(JSON.parse(response.body)).toMatchObject({ statusCode: 499, error: 'Error' });
    });

    it('should fall back to a generic message when the error carries none', async (): Promise<void> => {
      app = await buildApp(async (instance: FastifyInstance): Promise<void> => {
        instance.get('/silent', async (): Promise<void> => {
          const error: Error & { statusCode?: number } = new Error('');
          error.statusCode = 503;
          throw error;
        });
      });

      const response: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/silent' });

      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.body).message).toBe('Internal Server Error');
    });
  });
});
