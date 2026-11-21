import { FastifySchemaValidationError } from 'fastify';
import { z } from 'zod';

import { RouteValidator, toJsonSchema, toValidationError, zodBodyValidator } from '@utils';

describe('Unit::Utils::Validation', () => {
  /**
   * The validator of a body route declared with the JSON Schema of a Zod schema.
   *
   * @param schema - The Zod schema of the body
   * @returns The validator Fastify would call
   */
  function validatorOf(schema: z.ZodType): RouteValidator {
    return zodBodyValidator({
      schema: toJsonSchema(schema, 'input'),
      method: 'POST',
      url: '/things',
      httpPart: 'body',
    });
  }

  /**
   * The AJV error of the first issue Zod finds in a value.
   *
   * @param schema - The Zod schema
   * @param value - The value
   * @returns The error
   */
  function errorOf(schema: z.ZodType, value: unknown): FastifySchemaValidationError {
    const result = schema.safeParse(value, { reportInput: true });
    if (result.success) throw new Error('The value was expected to be refused');
    return toValidationError(result.error.issues[0]);
  }

  describe('zodBodyValidator', () => {
    const bodySchema = z.object({
      name: z.string().trim().min(1).max(4),
      share: z.number().int().min(1).max(100),
      amount: z.number().positive().nullable().optional(),
      tags: z.array(z.string()).default([]),
    });

    it('should give the parsed body: trimmed, with its defaults, without unknown fields', (): void => {
      const validate: RouteValidator = validatorOf(bodySchema);

      expect(validate({ name: '  Acme ', share: 25, extra: true })).toEqual({
        value: { name: 'Acme', share: 25, tags: [] },
      });
    });

    it('should give the first issue as an AJV error, without coercing anything', (): void => {
      const validate: RouteValidator = validatorOf(bodySchema);

      expect(validate({ name: 'Acme', share: '25' })).toEqual({
        error: [
          {
            keyword: 'type',
            instancePath: '/share',
            schemaPath: '#',
            params: {},
            message: 'Invalid input: expected number, received string',
          },
        ],
      });
      expect(validate({ name: '   ', share: 25 })).toMatchObject({ error: [{ keyword: 'minLength' }] });
      expect(validate({ name: 'Acme', share: 25, amount: 0 })).toMatchObject({
        error: [{ keyword: 'exclusiveMinimum', instancePath: '/amount' }],
      });
    });

    it('should count lengths in Unicode code points: an emoji counts 1', (): void => {
      const validate: RouteValidator = validatorOf(bodySchema);

      expect(validate({ name: '😀😀😀😀', share: 25 })).toEqual({ value: { name: '😀😀😀😀', share: 25, tags: [] } });
      expect(validate({ name: '😀😀😀😀a', share: 25 })).toMatchObject({ error: [{ keyword: 'maxLength' }] });
    });

    it('should refuse a missing body as a whole', (): void => {
      expect(validatorOf(bodySchema)(null)).toMatchObject({ error: [{ keyword: 'type', instancePath: '' }] });
    });

    it.each<[string, unknown]>([
      ['a JSON Schema written by hand', { type: 'object' }],
      ['an output-side JSON Schema', toJsonSchema(z.object({}))],
    ])('should refuse to build the validator of %s', (_label: string, schema: unknown): void => {
      expect(() => zodBodyValidator({ schema, method: 'PUT', url: '/things/:id', httpPart: 'body' })).toThrow(
        "The body of PUT /things/:id has no Zod schema: declare it with toJsonSchema(zodSchema, 'input')"
      );
    });
  });

  describe('toValidationError', () => {
    it.each<[string, z.ZodType, unknown, string, string]>([
      ['a missing field', z.object({ a: z.object({ b: z.string() }) }), { a: {} }, 'required', '/a/b'],
      ['a missing non-optional field', z.object({ a: z.string().optional().nonoptional() }), {}, 'required', '/a'],
      ['a value of the wrong type', z.object({ a: z.string() }), { a: 1 }, 'type', '/a'],
      ['a decimal for an integer', z.number().int(), 1.5, 'type', ''],
      ['a short text', z.string().min(2), 'a', 'minLength', ''],
      ['a long text', z.string().max(2), 'abc', 'maxLength', ''],
      ['a text of the wrong length', z.string().length(2), 'abc', 'maxLength', ''],
      ['a short list', z.array(z.string()).min(1), [], 'minItems', ''],
      ['a long list', z.array(z.string()).max(1), ['a', 'b'], 'maxItems', ''],
      ['a small set', z.set(z.string()).min(1), new Set(), 'minItems', ''],
      ['a small number', z.number().min(1), 0, 'minimum', ''],
      ['a large number', z.number().max(1), 2, 'maximum', ''],
      ['a number not above its bound', z.number().positive(), 0, 'exclusiveMinimum', ''],
      ['a number not below its bound', z.number().lt(5), 5, 'exclusiveMaximum', ''],
      ['an integer out of the safe range', z.number().int(), 2 ** 60, 'maximum', ''],
      ['an early date', z.date().min(new Date(1)), new Date(0), 'minimum', ''],
      ['a text breaking its pattern', z.string().regex(/^[A-Z]{3}$/), 'eur', 'pattern', ''],
      ['a text with the wrong start', z.string().startsWith('adv_'), 'tag', 'pattern', ''],
      ['a text with the wrong end', z.string().endsWith('.js'), 'tag', 'pattern', ''],
      ['a text missing a part', z.string().includes('@'), 'tag', 'pattern', ''],
      ['a malformed uuid', z.uuid(), 'nope', 'pattern', ''],
      ['a malformed day', z.iso.date(), '2026-13-01', 'pattern', ''],
      ['a malformed email', z.email(), 'nope', 'pattern', ''],
      ['a malformed URL', z.url(), 'nope', 'format', ''],
      ['a URL of another protocol', z.url({ protocol: /^https?$/ }), 'javascript:alert(1)', 'format', ''],
      ['a URL that is not https', z.url({ protocol: /^https$/ }), 'http://acme.test/feed.xml', 'format', ''],
      ['a URL of another host', z.url({ hostname: /^acme\.test$/ }), 'https://evil.test', 'format', ''],
      ['an amount with too many decimals', z.number().multipleOf(0.01), 0.001, 'multipleOf', ''],
      ['an unknown option', z.object({ a: z.enum(['x', 'y']) }), { a: 'z' }, 'enum', '/a'],
      ['another literal', z.literal('x'), 'y', 'enum', ''],
      ['a missing option', z.object({ a: z.enum(['x', 'y']) }), {}, 'required', '/a'],
      ['a missing literal', z.object({ a: z.literal('x') }), {}, 'required', '/a'],
      [
        'an unknown field of a strict object, naming it',
        z.strictObject({ a: z.object({}).strict() }),
        { a: { b: 1 } },
        'additionalProperties',
        '/a/b',
      ],
      [
        'an unknown field at the root, naming it',
        z.strictObject({ a: z.string() }),
        { a: 'x', nope: 1 },
        'additionalProperties',
        '/nope',
      ],
      ['a record key breaking its rule', z.record(z.string().min(2), z.string()), { a: 'x' }, 'propertyNames', '/a'],
      [
        'a refinement',
        z.object({ a: z.string().refine((value: string): boolean => value === 'x') }),
        { a: 'y' },
        'custom',
        '/a',
      ],
    ])(
      'should name %s by its JSON Schema rule',
      (_label: string, schema: z.ZodType, value: unknown, keyword: string, instancePath: string): void => {
        expect(errorOf(schema, value)).toMatchObject({ keyword, instancePath });
      }
    );

    it('should keep the message of the issue, never its input', (): void => {
      const schema = z.object({ apiKey: z.string().regex(/^sk-/, 'An API key starts with sk-') });

      expect(errorOf(schema, { apiKey: 'secret-key' })).toEqual({
        keyword: 'pattern',
        instancePath: '/apiKey',
        schemaPath: '#',
        params: {},
        message: 'An API key starts with sk-',
      });
    });

    it('should name an element of a map breaking its rule', (): void => {
      const issue: z.core.$ZodIssue = {
        code: 'invalid_element',
        origin: 'map',
        key: 'a',
        issues: [],
        path: ['tags', 'a'],
        message: 'Invalid element',
      };

      expect(toValidationError(issue)).toMatchObject({ keyword: 'items', instancePath: '/tags/a' });
    });

    describe('unions', () => {
      const account = z.object({
        account: z.discriminatedUnion('platform', [
          z.object({ platform: z.literal('openai'), apiKey: z.string() }),
          z.object({ platform: z.literal('google'), customerId: z.string() }),
        ]),
      });

      it.each<[string, unknown, string, string]>([
        ['a missing discriminator', { account: {} }, 'required', '/account/platform'],
        ['an unknown discriminator', { account: { platform: 'bing' } }, 'enum', '/account/platform'],
        ['a field of the option chosen', { account: { platform: 'google' } }, 'required', '/account/customerId'],
      ])('should name %s', (_label: string, value: unknown, keyword: string, instancePath: string): void => {
        expect(errorOf(account, value)).toMatchObject({ keyword, instancePath });
      });

      it('should follow the option that accepted the type of the value, with the fewest issues', (): void => {
        const schema = z.object({
          a: z.union([
            z.number(),
            z.object({ x: z.string(), y: z.string() }),
            z.object({ x: z.number(), z: z.boolean() }),
          ]),
        });

        expect(errorOf(schema, { a: { x: 'one' } })).toMatchObject({ keyword: 'required', instancePath: '/a/y' });
        expect(errorOf(schema, { a: { x: 1 } })).toMatchObject({ keyword: 'required', instancePath: '/a/z' });
      });

      it('should name a missing value', (): void => {
        expect(errorOf(z.object({ a: z.union([z.string(), z.number()]) }), {})).toMatchObject({
          keyword: 'required',
          instancePath: '/a',
        });
      });

      it('should name a value of a type no option takes', (): void => {
        expect(errorOf(z.object({ a: z.union([z.string(), z.number()]) }), { a: true })).toMatchObject({
          keyword: 'type',
          instancePath: '/a',
          message: 'Invalid input',
        });
      });

      it('should name a value several exclusive options take', (): void => {
        expect(errorOf(z.xor([z.string(), z.string().min(1)]), 'ab')).toMatchObject({ keyword: 'oneOf' });
      });
    });
  });
});
