import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import Fastify, { FastifyInstance, FastifyRequest, LightMyRequestResponse } from 'fastify';
import { z } from 'zod';

import ErrorHandlerPlugin from '@src/plugins/error-handler.plugin';
import ValidationPlugin from '@src/plugins/validation.plugin';
import { closeTestApp } from '@test/utils/fastify-test-app.utils';
import { toJsonSchema } from '@utils';

describe('Unit::ValidationPlugin', () => {
  const ID = 'f0000000-0000-4000-8000-000000000001';

  const bodySchema = z.object({
    name: z.string().trim().min(1).max(4),
    share: z.number().int().min(1).max(100),
    website: z.url({ protocol: /^https?$/ }).optional(),
    tags: z.array(z.string()).default([]),
  });

  const querySchema = z.object({
    q: z.string().max(4),
    limit: z.number().int().min(1).default(20),
    platforms: z.array(z.enum(['openai', 'google'])).optional(),
  });

  let app: FastifyInstance;

  /**
   * Builds an app with the plugin and routes echoing what they receive.
   *
   * @returns The app, ready
   */
  async function buildApp(): Promise<FastifyInstance> {
    const instance: FastifyInstance = Fastify();
    await instance.register(ErrorHandlerPlugin);
    await instance.register(ValidationPlugin);
    instance.post(
      '/things/:id',
      {
        schema: {
          params: toJsonSchema(z.object({ id: z.uuid() }), 'input'),
          body: toJsonSchema(bodySchema, 'input'),
        },
      },
      async (request: FastifyRequest): Promise<unknown> => request.body
    );
    instance.get(
      '/things',
      { schema: { querystring: toJsonSchema(querySchema, 'input') } },
      async (request: FastifyRequest): Promise<unknown> => request.query
    );
    instance.get(
      '/scoped',
      {
        schema: {
          // Written with capitals, as Fastify accepts a headers schema: Node reads header names in lower case.
          headers: {
            type: 'object',
            properties: { 'X-Organization-Id': { type: 'string', format: 'uuid' } },
            required: ['X-Organization-Id'],
          },
        },
      },
      async (request: FastifyRequest): Promise<unknown> => ({ organizationId: request.headers['x-organization-id'] })
    );
    instance.get('/open', { schema: { headers: { type: 'object' } } }, async (): Promise<unknown> => ({ ok: true }));
    await instance.ready();
    return instance;
  }

  /**
   * Assert a response is the 400 `validation_failed` of a field.
   *
   * @param response - The response
   * @param params - The field, rule and location expected
   */
  function expectRefused(response: LightMyRequestResponse, params: Record<string, string | null>): void {
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({ code: 'validation_failed', params });
  }

  beforeEach(async (): Promise<void> => {
    app = await buildApp();
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  describe('bodies, parsed by their Zod schema', () => {
    it('should hand the handler the parsed body: trimmed, with its defaults, without unknown fields', async () => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: `/things/${ID}`,
        payload: { name: '  Acme  ', share: 25, extra: 1 },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ name: 'Acme', share: 25, tags: [] });
    });

    it.each<[string, object, string | null, string]>([
      ['a name of spaces', { name: '   ', share: 25 }, 'name', 'minLength'],
      ['a name of 5 emojis (5 code points)', { name: '😀😀😀😀😀', share: 25 }, 'name', 'maxLength'],
      ['a share sent as a text', { name: 'Acme', share: '25' }, 'share', 'type'],
      ['a missing share', { name: 'Acme' }, 'share', 'required'],
      ['a javascript: URL', { name: 'Acme', share: 25, website: 'javascript:alert(1)' }, 'website', 'format'],
      ['a tag of the wrong type', { name: 'Acme', share: 25, tags: ['a', 2] }, 'tags.1', 'type'],
      ['a list for an object', [], null, 'type'],
    ])('should refuse %s', async (_label: string, payload: object, field: string | null, rule: string) => {
      const response: LightMyRequestResponse = await app.inject({ method: 'POST', url: `/things/${ID}`, payload });

      expectRefused(response, { field, rule, location: 'body' });
    });

    it('should accept 4 emojis, 8 UTF-16 units but 4 code points', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: `/things/${ID}`,
        payload: { name: '😀😀😀😀', share: 25 },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should say which field breaks which rule, in English', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: `/things/${ID}`,
        payload: { name: 'Acme', share: 0 },
      });

      expect(JSON.parse(response.body)).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
        code: 'validation_failed',
        params: { field: 'share', rule: 'minimum', location: 'body' },
        message: 'body/share Too small: expected number to be >=1',
      });
    });

    it('should refuse a request without body as a whole', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({ method: 'POST', url: `/things/${ID}` });

      expectRefused(response, { field: null, rule: 'type', location: 'body' });
    });

    it('should check the params first, with AJV', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/things/nope',
        payload: { name: '   ' },
      });

      expectRefused(response, { field: 'id', rule: 'pattern', location: 'params' });
    });

    it('should refuse to build a route whose body has no Zod schema', async (): Promise<void> => {
      const instance: FastifyInstance = Fastify();
      await instance.register(ValidationPlugin);
      instance.post('/raw', { schema: { body: { type: 'object' } } }, async (): Promise<unknown> => ({}));

      await expect(instance.ready()).rejects.toThrow(
        "The body of POST /raw has no Zod schema: declare it with toJsonSchema(zodSchema, 'input')"
      );
    });
  });

  describe('querystrings, params and headers, checked by AJV', () => {
    it('should turn the querystring into the numbers and lists of its schema, with its defaults', async () => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: '/things?q=shoe&platforms=google',
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ q: 'shoe', limit: 20, platforms: ['google'] });
      expect(JSON.parse((await app.inject({ method: 'GET', url: '/things?q=a&limit=5' })).body)).toMatchObject({
        limit: 5,
      });
    });

    it('should count lengths in Unicode code points, as Zod: an emoji counts 1', async (): Promise<void> => {
      const fourEmojis: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `/things?q=${encodeURIComponent('😀😀😀😀')}`,
      });
      const more: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `/things?q=${encodeURIComponent('😀😀😀😀a')}`,
      });

      expect(fourEmojis.statusCode).toBe(200);
      expectRefused(more, { field: 'q', rule: 'maxLength', location: 'querystring' });
    });

    it('should read the header names of a headers schema in lower case, as Fastify does', async () => {
      const scoped: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: '/scoped',
        headers: { 'X-Organization-Id': ID },
      });
      const missing: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/scoped' });
      const open: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/open' });

      expect(JSON.parse(scoped.body)).toEqual({ organizationId: ID });
      expectRefused(missing, { field: 'x-organization-id', rule: 'required', location: 'headers' });
      expect(open.statusCode).toBe(200);
    });
  });
});
