const CONFIG_MOCK: { accessLog: boolean; level: string } = { accessLog: true, level: 'warn' };
jest.mock('@configs/logger.config', () => ({ loggerConfig: CONFIG_MOCK }));

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';

import AccessLogPlugin from '@src/plugins/access-log.plugin';
import ErrorHandlerPlugin from '@src/plugins/error-handler.plugin';
import { IDS, JANE } from '@test/unit/mocks/auth.fixtures';
import { LoggerMock } from '@test/unit/mocks/logger.mock';
import { LoggerBuilder } from '@utils';

describe('Unit::AccessLogPlugin', () => {
  let app: FastifyInstance;
  let logger: LoggerMock;

  /** An app logging to a mock, with an authenticated route, a public one, a probe and a failing route. */
  async function buildApp(options: { logger?: unknown } = { logger }): Promise<FastifyInstance> {
    const instance: FastifyInstance = Fastify();
    await instance.register(ErrorHandlerPlugin);
    await instance.register(AccessLogPlugin, options as never);
    instance.addHook('onRequest', async (request: FastifyRequest): Promise<void> => {
      if (request.headers.authorization) request.auth = JANE;
    });
    instance.get('/campaigns/:id', async (): Promise<object> => ({ ok: true }));
    instance.get('/email/unsubscribe', async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      reply.code(204).send();
    });
    instance.get('/readyz', async (): Promise<object> => ({ status: 'ok' }));
    await instance.ready();
    return instance;
  }

  beforeEach((): void => {
    jest.clearAllMocks();
    CONFIG_MOCK.accessLog = true;
    logger = new LoggerMock();
  });

  afterEach(async (): Promise<void> => {
    await app?.close();
  });

  it('should write one line per request with the route pattern, never the URL nor the headers', async (): Promise<void> => {
    app = await buildApp();

    await app.inject({
      method: 'GET',
      url: `/campaigns/${IDS.advertiser}?token=secret`,
      headers: { authorization: 'Bearer secret', 'x-organization-id': IDS.organization },
      remoteAddress: '198.51.100.7',
    });

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('GET /campaigns/:id 200', {
      method: 'GET',
      route: '/campaigns/:id',
      status: 200,
      durationMs: expect.any(Number),
      clientIp: '198.51.100.7',
      userId: JANE.userId,
      organizationId: IDS.organization,
      requestId: expect.any(String),
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('secret');
  });

  it('should log a public route without user, and drop an Organization header that is not an id', async (): Promise<void> => {
    app = await buildApp();

    await app.inject({ method: 'GET', url: '/email/unsubscribe?token=abc', headers: { 'x-organization-id': 'nope' } });

    expect(logger.info).toHaveBeenCalledWith(
      'GET /email/unsubscribe 204',
      expect.objectContaining({ route: '/email/unsubscribe', status: 204, userId: null, organizationId: null })
    );
  });

  it('should log the path of an unmatched request without its query string', async (): Promise<void> => {
    app = await buildApp();

    await app.inject({ method: 'POST', url: `/wp-login.php?pwd=x&${'a'.repeat(300)}` });

    expect(logger.info).toHaveBeenCalledWith(
      'POST /wp-login.php 404',
      expect.objectContaining({ route: null, path: '/wp-login.php', status: 404 })
    );
  });

  it('should leave the probes out', async (): Promise<void> => {
    app = await buildApp();

    await app.inject({ method: 'GET', url: '/readyz' });

    expect(logger.info).not.toHaveBeenCalled();
  });

  it('should write to the access logger by default', async (): Promise<void> => {
    const getAccessLogger: jest.SpyInstance = jest
      .spyOn(LoggerBuilder, 'getAccessLogger')
      .mockReturnValue(logger as never);
    app = await buildApp({});

    await app.inject({ method: 'GET', url: '/email/unsubscribe' });

    expect(getAccessLogger).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledTimes(1);
    getAccessLogger.mockRestore();
  });

  it('should write nothing when the access log is off', async (): Promise<void> => {
    CONFIG_MOCK.accessLog = false;
    app = await buildApp();

    await app.inject({ method: 'GET', url: '/email/unsubscribe' });

    expect(logger.info).not.toHaveBeenCalled();
  });
});
