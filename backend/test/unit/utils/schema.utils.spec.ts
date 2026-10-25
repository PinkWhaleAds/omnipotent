import Fastify, { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { errorResponses, NO_CONTENT_RESPONSE, toJsonSchema, zodSchemaOf } from '@utils';

describe('Unit::Utils::Schema', () => {
  const querySchema = z.object({
    page: z.number().int().min(1).default(1),
    search: z.string().optional(),
  });

  describe('toJsonSchema', () => {
    it('should target JSON Schema draft-07', (): void => {
      const schema: Record<string, unknown> = toJsonSchema(z.string()) as Record<string, unknown>;

      expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
      expect(schema.type).toBe('string');
    });

    it('should describe the output side by default: a field with a default is required', (): void => {
      const schema: { required?: string[] } = toJsonSchema(querySchema) as { required?: string[] };

      expect(schema.required).toEqual(['page']);
    });

    it('should describe the input side on request: a field with a default may be omitted', (): void => {
      const schema: { required?: string[]; properties: Record<string, { default?: unknown }> } = toJsonSchema(
        querySchema,
        'input'
      ) as { required?: string[]; properties: Record<string, { default?: unknown }> };

      expect(schema.required ?? []).not.toContain('page');
      expect(schema.properties.page.default).toBe(1);
    });
  });

  describe('zodSchemaOf', () => {
    it('should give the Zod schema an input-side JSON Schema was written from', (): void => {
      expect(zodSchemaOf(toJsonSchema(querySchema, 'input'))).toBe(querySchema);
    });

    it.each<[string, unknown]>([
      ['an output-side JSON Schema', toJsonSchema(querySchema)],
      ['a JSON Schema written by hand', { type: 'object' }],
      ['null', null],
      ['a string', 'object'],
    ])('should give nothing for %s', (_label: string, jsonSchema: unknown): void => {
      expect(zodSchemaOf(jsonSchema)).toBeUndefined();
    });
  });

  describe('URL protocols', () => {
    const urlSchema = z.object({ url: z.url({ protocol: /^https?$/ }).max(2048) });

    it('should keep the format and add the allowed protocol as a case-insensitive pattern', (): void => {
      const schema = toJsonSchema(urlSchema, 'input') as { properties: { url: Record<string, unknown> } };

      expect(schema.properties.url).toEqual({
        type: 'string',
        format: 'uri',
        maxLength: 2048,
        pattern: '^(?:[hH][tT][tT][pP][sS]?):',
      });
    });

    it('should add no pattern to a URL without protocol, nor to another string', (): void => {
      const schema = toJsonSchema(z.object({ url: z.url(), name: z.string() }), 'input') as {
        properties: Record<string, Record<string, unknown>>;
      };

      expect(schema.properties.url).not.toHaveProperty('pattern');
      expect(schema.properties.name).toEqual({ type: 'string' });
    });

    it.each<[string, number]>([
      ['https://acme.test/shoes', 200],
      ['HTTP://acme.test', 200],
      ['javascript:alert(1)', 400],
      ['ftp://acme.test/file', 400],
      ['data:text/html,hello', 400],
    ])('should make a Fastify route answer %s with %d, as Zod would', async (url: string, status: number) => {
      const app: FastifyInstance = Fastify();
      app.post('/check', { schema: { body: toJsonSchema(urlSchema, 'input') } }, async (): Promise<object> => ({}));

      const response = await app.inject({ method: 'POST', url: '/check', payload: { url } });

      expect(response.statusCode).toBe(status);
      expect(urlSchema.safeParse({ url }).success).toBe(status === 200);
      await app.close();
    });
  });

  describe('errorResponses', () => {
    it('should document every status with the error response shape', (): void => {
      const responses: Record<number, object> = errorResponses(400, 404);

      expect(Object.keys(responses)).toEqual(['400', '404']);
      expect(responses[400]).toBe(responses[404]);
      expect(responses[404]).toMatchObject({
        type: 'object',
        properties: {
          statusCode: { type: 'number' },
          error: { type: 'string' },
          code: { type: 'string' },
          params: { type: 'object' },
          message: { type: 'string' },
          requestId: { type: 'string' },
        },
        required: ['statusCode', 'error', 'code', 'params', 'message', 'requestId'],
      });
    });

    it('should document nothing without status', (): void => {
      expect(errorResponses()).toEqual({});
    });
  });

  describe('NO_CONTENT_RESPONSE', () => {
    it('should describe an empty body', (): void => {
      expect(NO_CONTENT_RESPONSE).toEqual({ type: 'null', description: 'No content' });
    });
  });
});
