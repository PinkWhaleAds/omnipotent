import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import Fastify, { FastifyInstance, FastifyRequest, LightMyRequestResponse } from 'fastify';

import ErrorHandlerPlugin from '@src/plugins/error-handler.plugin';
import RateLimitPlugin, {
  DEFAULT_RATE_LIMIT,
  rateLimitError,
  rateLimitKey,
  RateLimitPluginOptions,
  ROUTE_RATE_LIMITS,
} from '@src/plugins/rate-limit.plugin';
import { ErrorResponse, errorResponseSchema } from '@src/types';
import { JANE, JOHN } from '@test/unit/mocks/auth.fixtures';
import { errorCodeOf, statusCodeOf, toJsonSchema } from '@utils';

describe('Unit::RateLimitPlugin', () => {
  let app: FastifyInstance;

  /**
   * An app with the rate limit, a stand-in for the authentication (`x-user: jane|john`), and a few routes: a shared
   * one, one with its own limit, one never limited, and one with a documented response.
   */
  async function buildApp(options: RateLimitPluginOptions): Promise<FastifyInstance> {
    const instance: FastifyInstance = Fastify();
    await instance.register(ErrorHandlerPlugin);
    await instance.register(RateLimitPlugin, options);
    instance.addHook('onRequest', async (request: FastifyRequest): Promise<void> => {
      if (request.headers['x-user'] === 'jane') request.auth = JANE;
      if (request.headers['x-user'] === 'john') request.auth = JOHN;
    });
    instance.get('/campaigns', async (): Promise<object> => ({ ok: true }));
    instance.get('/advertisers', async (): Promise<object> => ({ ok: true }));
    instance.route({ method: ['POST'], url: '/ai/generations', handler: async (): Promise<object> => ({ ok: true }) });
    instance.get('/livez', async (): Promise<object> => ({ status: 'ok' }));
    instance.get('/status', async (): Promise<object> => ({ ok: true }));
    instance.get('/search', {
      schema: { response: { 200: { type: 'object', properties: { ok: { type: 'boolean' } } } } },
      handler: async (): Promise<object> => ({ ok: true }),
    });
    await instance.ready();
    return instance;
  }

  /** Send a GET or POST as a user (or anonymously). */
  async function call(method: 'GET' | 'POST', url: string, user?: string): Promise<LightMyRequestResponse> {
    return app.inject({ method, url, headers: user ? { 'x-user': user } : {}, remoteAddress: '198.51.100.7' });
  }

  afterEach(async (): Promise<void> => {
    await app?.close();
  });

  it('should refuse the request over the limit with 429 rate_limited, its delay and Retry-After', async (): Promise<void> => {
    app = await buildApp({ defaultLimit: { max: 2, windowMs: 60_000 }, limits: {} });

    expect((await call('GET', '/campaigns', 'jane')).statusCode).toBe(200);
    const second: LightMyRequestResponse = await call('GET', '/advertisers', 'jane');
    expect(second.statusCode).toBe(200);
    expect(second.headers['x-ratelimit-limit']).toBe('2');
    expect(second.headers['x-ratelimit-remaining']).toBe('0');
    // The routes without their own limit share one counter.
    const refused: LightMyRequestResponse = await call('GET', '/campaigns', 'jane');

    expect(refused.statusCode).toBe(429);
    expect(refused.headers['retry-after']).toBe('60');
    const body: ErrorResponse = JSON.parse(refused.body);
    expect(body).toEqual({
      statusCode: 429,
      error: 'Too Many Requests',
      code: 'rate_limited',
      params: { retryAfter: 60, max: 2 },
      message: 'Too many requests: retry in 60 seconds',
      requestId: expect.any(String),
    });
  });

  it('should count each user apart, and anonymous callers by address', async (): Promise<void> => {
    app = await buildApp({ defaultLimit: { max: 1, windowMs: 60_000 }, limits: {} });

    expect((await call('GET', '/campaigns', 'jane')).statusCode).toBe(200);
    expect((await call('GET', '/campaigns', 'john')).statusCode).toBe(200);
    expect((await call('GET', '/campaigns')).statusCode).toBe(200);
    expect((await call('GET', '/campaigns', 'jane')).statusCode).toBe(429);
    expect((await call('GET', '/campaigns')).statusCode).toBe(429);
  });

  it('should give a listed route its own limit and counter, and never limit a route set to false', async (): Promise<void> => {
    app = await buildApp({
      defaultLimit: { max: 100, windowMs: 60_000 },
      limits: { 'POST /ai/generations': { max: 1, windowMs: 60_000 }, 'GET /livez': false },
    });

    expect((await call('POST', '/ai/generations', 'jane')).statusCode).toBe(200);
    expect((await call('POST', '/ai/generations', 'jane')).statusCode).toBe(429);
    expect((await call('GET', '/campaigns', 'jane')).statusCode).toBe(200);
    for (let index = 0; index < 3; index += 1) {
      const probe: LightMyRequestResponse = await call('GET', '/livez');
      expect(probe.statusCode).toBe(200);
      expect(probe.headers['x-ratelimit-limit']).toBeUndefined();
    }
  });

  it('should limit a HEAD route as its GET', async (): Promise<void> => {
    app = await buildApp({ defaultLimit: { max: 100, windowMs: 60_000 }, limits: { 'GET /campaigns': false } });

    const head: LightMyRequestResponse = await app.inject({ method: 'HEAD', url: '/campaigns' });

    expect(head.statusCode).toBe(200);
    expect(head.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('should answer the 429 of a route with a response schema in the error shape', async (): Promise<void> => {
    app = await buildApp({ defaultLimit: { max: 1, windowMs: 60_000 }, limits: {} });

    await call('GET', '/search', 'jane');
    const refused: LightMyRequestResponse = await call('GET', '/search', 'jane');

    expect(refused.statusCode).toBe(429);
    expect(JSON.parse(refused.body)).toEqual(
      expect.objectContaining({ code: 'rate_limited', params: { retryAfter: 60, max: 1 } })
    );
  });

  it('should add the 429 to the response schemas, not to the never limited routes', async (): Promise<void> => {
    const routes: { url: string; schema?: { response?: Record<number, unknown> } }[] = [];
    const instance: FastifyInstance = Fastify();
    await instance.register(ErrorHandlerPlugin);
    await instance.register(RateLimitPlugin, { limits: { 'GET /livez': false } });
    instance.addHook('onRoute', (route: { url: string; schema?: { response?: Record<number, unknown> } }): void => {
      routes.push(route);
    });
    const response = { 200: { type: 'object' } };
    instance.get('/campaigns', { schema: { response } }, async (): Promise<object> => ({}));
    instance.get('/livez', { schema: { response } }, async (): Promise<object> => ({}));
    await instance.ready();
    app = instance;

    const schemaOf = (url: string): Record<number, unknown> | undefined =>
      routes.find((route: { url: string }): boolean => route.url === url)?.schema?.response;
    expect(schemaOf('/campaigns')).toEqual({
      200: { type: 'object' },
      429: expect.objectContaining({
        required: (toJsonSchema(errorResponseSchema) as { required: string[] }).required,
      }),
    });
    expect(schemaOf('/livez')).toEqual({ 200: { type: 'object' } });
    // The shared response map is left as it was.
    expect(response).toEqual({ 200: { type: 'object' } });
  });

  it('should apply the limits of the application by default', async (): Promise<void> => {
    app = await buildApp({});

    const status: LightMyRequestResponse = await call('GET', '/status');
    const campaigns: LightMyRequestResponse = await call('GET', '/campaigns', 'jane');

    expect(status.headers['x-ratelimit-limit']).toBe('60');
    expect(campaigns.headers['x-ratelimit-limit']).toBe(String(DEFAULT_RATE_LIMIT.max));
    expect((await call('GET', '/livez')).headers['x-ratelimit-limit']).toBeUndefined();
  });

  describe('rateLimitKey', () => {
    it('should count a user by id and an anonymous caller by address (an IPv6 one by its /64)', (): void => {
      expect(rateLimitKey({ auth: JANE } as FastifyRequest)).toBe(`user:${JANE.userId}`);
      expect(rateLimitKey({ ip: '198.51.100.7', headers: {} } as unknown as FastifyRequest)).toBe('ip:198.51.100.7');
      expect(rateLimitKey({ ip: '2001:db8:1:2:3:4:5:6', headers: {} } as unknown as FastifyRequest)).toBe(
        'ip:2001:db8:1:2::'
      );
    });
  });

  describe('rateLimitError', () => {
    it('should wait at least one second', (): void => {
      const error: Error = rateLimitError({} as FastifyRequest, {
        statusCode: 429,
        ban: false,
        after: '0 seconds',
        max: 5,
        ttl: 0,
      });

      expect(statusCodeOf(error)).toBe(429);
      expect(errorCodeOf(error)).toEqual({ code: 'rate_limited', params: { retryAfter: 1, max: 5 } });
    });
  });

  describe('ROUTE_RATE_LIMITS', () => {
    it('should never limit the probes and limit the public and MCP routes below the default', (): void => {
      expect(ROUTE_RATE_LIMITS['GET /livez']).toBe(false);
      expect(ROUTE_RATE_LIMITS['GET /readyz']).toBe(false);
      expect(ROUTE_RATE_LIMITS['GET /healthz']).toBe(false);
      for (const route of ['GET /status', 'POST /mcp']) {
        const limit = ROUTE_RATE_LIMITS[route];
        expect(limit && limit.max / limit.windowMs).toBeLessThan(DEFAULT_RATE_LIMIT.max / DEFAULT_RATE_LIMIT.windowMs);
      }
    });
  });
});
