import Fastify, { FastifyInstance, LightMyRequestResponse } from 'fastify';

import CorsPlugin from '@src/plugins/cors.plugin';
import { closeTestApp } from '@test/utils/fastify-test-app.utils';

describe('Unit::CorsPlugin', () => {
  let app: FastifyInstance;

  /** An app with the plugin and one route, allowing the given origins. */
  async function buildApp(origins?: string[]): Promise<FastifyInstance> {
    const instance: FastifyInstance = Fastify();
    await instance.register(CorsPlugin, origins === undefined ? {} : { origins });
    instance.get('/campaigns', async (): Promise<{ items: [] }> => ({ items: [] }));
    await instance.ready();
    return instance;
  }

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  it('should answer the preflight of an allowed origin', async (): Promise<void> => {
    app = await buildApp(['http://localhost:5173']);

    const response: LightMyRequestResponse = await app.inject({
      method: 'OPTIONS',
      url: '/campaigns',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization,x-organization-id',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-headers']).toBe('Authorization, Content-Type, x-organization-id');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('should let the front read how long to wait after a 429, and the rate limit left', async (): Promise<void> => {
    app = await buildApp(['http://localhost:5173']);

    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/campaigns',
      headers: { origin: 'http://localhost:5173' },
    });

    expect(response.headers['access-control-expose-headers']).toBe(
      'Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset'
    );
  });

  it('should not allow another origin', async (): Promise<void> => {
    app = await buildApp(['http://localhost:5173']);

    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/campaigns',
      headers: { origin: 'https://evil.example' },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('should add no CORS header when no origin is configured', async (): Promise<void> => {
    app = await buildApp();

    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/campaigns',
      headers: { origin: 'http://localhost:5173' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
