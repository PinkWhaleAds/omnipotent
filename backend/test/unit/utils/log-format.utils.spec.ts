import { PassThrough } from 'node:stream';

import winston from 'winston';

import { isSensitiveKey, redactText, REDACTED, sanitizeLogFormat, sanitizeLogInfo, sanitizeValue } from '@utils';

/** A real winston logger writing JSON lines to memory, with the format of the application. */
type Capture = { logger: winston.Logger; lines: () => Record<string, any>[] };

/**
 * Build a real winston logger with the production pipeline: the sanitizing format, then timestamp + JSON.
 *
 * @returns The logger and the lines it wrote
 */
function capture(): Capture {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on('data', (chunk: Buffer): void => {
    chunks.push(chunk.toString('utf8'));
  });
  const logger: winston.Logger = winston.createLogger({
    level: 'debug',
    format: sanitizeLogFormat,
    defaultMeta: { service: 'omnipotent' },
    transports: [
      new winston.transports.Stream({
        stream,
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      }),
    ],
  });
  return {
    logger,
    lines: (): Record<string, any>[] =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line: string): Record<string, any> => JSON.parse(line)),
  };
}

/**
 * The error of a refused HTTP call, shaped as the axios errors the platform adapters throw
 * (`config`, `request`, `response`, `status`, `isAxiosError`): it carries our bearer token in its
 * request configuration, the secrets of the call in its body, and the platform's answer. Built by
 * hand so the logging format is tested without depending on axios, which arrives with the first
 * adapter.
 *
 * @returns The error
 */
function httpCallFailure(): Error {
  const config = {
    method: 'post',
    url: 'https://api.example.com/v1/campaigns?access_token=query-secret',
    headers: { Authorization: 'Bearer platform-secret-token', 'Content-Type': 'application/json' },
    data: '{"client_secret":"body-secret"}',
  };
  const response = {
    status: 401,
    statusText: 'Unauthorized',
    headers: { 'set-cookie': 'session=cookie-secret' },
    config,
    request: { socket: 'socket' },
    data: { error: 'invalid_token', refresh_token: 'echoed-secret' },
  };
  const error: Error = new Error('Request failed with status code 401');
  error.name = 'AxiosError';
  return Object.assign(error, {
    code: 'ERR_BAD_REQUEST',
    config,
    request: { path: '/v1/campaigns' },
    response,
    status: 401,
    isAxiosError: true,
  });
}

describe('Unit::Utils::LogFormat', () => {
  describe('with a real winston logger', () => {
    it('should log an AxiosError without its Authorization header nor any secret', (): void => {
      const { logger, lines } = capture();

      logger.error('Platform call failed', { campaignId: 'c-1', error: httpCallFailure() });

      const [line] = lines();
      const text: string = JSON.stringify(line);
      for (const secret of ['platform-secret-token', 'query-secret', 'body-secret', 'cookie-secret', 'echoed-secret']) {
        expect(text).not.toContain(secret);
      }
      expect(line).toEqual(
        expect.objectContaining({
          level: 'error',
          message: 'Platform call failed',
          service: 'omnipotent',
          campaignId: 'c-1',
          timestamp: expect.any(String),
        })
      );
      expect(line.error).toEqual({
        name: 'AxiosError',
        message: 'Request failed with status code 401',
        stack: expect.stringContaining('Request failed with status code 401'),
        code: 'ERR_BAD_REQUEST',
        isAxiosError: true,
        status: 401,
        method: 'POST',
        url: 'https://api.example.com/v1/campaigns',
        response: {
          status: 401,
          statusText: 'Unauthorized',
          data: { error: 'invalid_token', refresh_token: REDACTED },
        },
      });
    });

    it('should log a plain Error with its message and stack', (): void => {
      const { logger, lines } = capture();
      const error = new Error('connection refused');

      logger.error('Sync failed', { error });

      const [line] = lines();
      expect(line.message).toBe('Sync failed');
      expect(line.error).toEqual({ name: 'Error', message: 'connection refused', stack: error.stack });
    });

    it('should keep the cause chain and the own fields of an error', (): void => {
      const { logger, lines } = capture();
      const root = Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' });
      const error = Object.assign(new Error('Statistics read failed', { cause: root }), {
        statusCode: 502,
        params: { platform: 'google' },
      });

      logger.warn('Statistics read failed', { error });

      const [line] = lines();
      expect(line.error).toEqual({
        name: 'Error',
        message: 'Statistics read failed',
        stack: expect.any(String),
        statusCode: 502,
        params: { platform: 'google' },
        cause: { name: 'Error', message: 'ECONNRESET', stack: expect.any(String), code: 'ECONNRESET' },
      });
    });

    it('should fold the arguments winston leaves aside (tag, message, error)', (): void => {
      const { logger, lines } = capture();
      const error = new Error('boom');

      logger.error('REQUEST::FAILED', 'GET /x failed with 500', error);

      const [line] = lines();
      expect(line.message).toBe('REQUEST::FAILED GET /x failed with 500');
      expect(line.error).toEqual({ name: 'Error', message: 'boom', stack: error.stack });
    });

    it('should turn an error given as metadata into `error`, even through a child logger', (): void => {
      const { logger, lines } = capture();
      const error = httpCallFailure();

      logger.child({ class: 'HttpServer' }).error('Failed to initialize fastify:', error);

      const [line] = lines();
      expect(JSON.stringify(line)).not.toContain('platform-secret-token');
      expect(line).toEqual(
        expect.objectContaining({
          class: 'HttpServer',
          message: 'Failed to initialize fastify: Request failed with status code 401',
          error: expect.objectContaining({ name: 'AxiosError', method: 'POST' }),
        })
      );
      expect(line).not.toHaveProperty('config');
      expect(line).not.toHaveProperty('stack');
    });

    it('should keep the message and stack of an error logged alone', (): void => {
      const { logger, lines } = capture();
      const error = new Error('alone');

      logger.error(error);

      const [line] = lines();
      expect(line).toEqual(expect.objectContaining({ level: 'error', message: 'alone', stack: error.stack }));
    });

    it('should mask sensitive keys at any depth and tokens in texts', (): void => {
      const { logger, lines } = capture();

      logger.info('Unsubscribe GET /email/unsubscribe?token=abc.def&lang=fr', {
        headers: { authorization: 'Bearer abcdefghijkl', cookie: 'a=b', 'x-api-key': 'k' },
        nested: { deeper: { password: 'p', apiKey: 'k', private_key: 'pk', clientSecret: 's', inputTokens: 12 } },
        url: 'postgres://user:hunter2@db:5432/app',
      });

      const [line] = lines();
      expect(line.message).toBe(`Unsubscribe GET /email/unsubscribe?token=${REDACTED}&lang=fr`);
      expect(line.headers).toEqual({ authorization: REDACTED, cookie: REDACTED, 'x-api-key': REDACTED });
      expect(line.nested).toEqual({
        deeper: {
          password: REDACTED,
          apiKey: REDACTED,
          private_key: REDACTED,
          clientSecret: REDACTED,
          inputTokens: 12,
        },
      });
      expect(line.url).toBe(`postgres://${REDACTED}@db:5432/app`);
    });

    it('should merge objects given after the message when winston did not', (): void => {
      const { logger, lines } = capture();

      // A `%d` in the message stops winston from merging the metadata.
      logger.warn('GET /a%d rejected', { requestId: 'req-1' }, { requestId: 'ignored', extra: 2 }, null, 42);

      const [line] = lines();
      expect(line).toEqual(expect.objectContaining({ message: 'GET /a%d rejected 42', requestId: 'req-1', extra: 2 }));
    });

    it('should list a second error in `errors`', (): void => {
      const { logger, lines } = capture();

      logger.error('Two failures', { error: new Error('first') }, new Error('second'), new Error('third'));

      const [line] = lines();
      expect(line.error.message).toBe('first');
      expect(line.errors.map((error: { message: string }): string => error.message)).toEqual(['second', 'third']);
    });
  });

  describe('sanitizeValue', () => {
    const sanitize = (value: unknown): unknown => sanitizeValue(value, 0, new WeakSet());

    it('should write dates, binaries, big integers, functions and symbols as plain data', (): void => {
      expect(
        sanitize({
          at: new Date('2026-10-15T10:00:00.000Z'),
          invalid: new Date('nope'),
          file: Buffer.from('abc'),
          raw: new ArrayBuffer(4),
          big: BigInt(12),
          fn: (): void => undefined,
          symbol: Symbol('s'),
          empty: null,
          missing: undefined,
        })
      ).toEqual({
        at: '2026-10-15T10:00:00.000Z',
        invalid: null,
        file: '[Binary 3 bytes]',
        raw: '[Binary 4 bytes]',
        big: '12',
        empty: null,
        missing: undefined,
      });
    });

    it('should use toJSON, stop cycles and deep nesting, and cut long lists and texts', (): void => {
      const cyclic: Record<string, unknown> = { name: 'loop' };
      cyclic.self = cyclic;
      let deep: Record<string, unknown> = { level: 12 };
      for (let level = 11; level >= 0; level -= 1) deep = { level, child: deep };
      const value = sanitize({
        url: new URL('https://shop.example/feed.xml?sig=abc'),
        cyclic,
        deep,
        list: Array.from({ length: 60 }, (_item: unknown, index: number): number => index),
        text: 'x'.repeat(9000),
      }) as Record<string, any>;

      expect(value.url).toBe(`https://shop.example/feed.xml?sig=${REDACTED}`);
      expect(value.cyclic).toEqual({ name: 'loop', self: '[Circular]' });
      expect(JSON.stringify(value.deep)).toContain('[Truncated]');
      expect(value.list).toHaveLength(51);
      expect(value.list[50]).toBe('[10 more]');
      expect(value.text).toBe(`${'x'.repeat(8192)}… [9000 characters]`);
    });

    it('should serialize the errors of an AggregateError and an error without stack', (): void => {
      const bare = new Error('bare');
      bare.stack = undefined;
      const aggregate = new AggregateError([bare], 'all failed');

      expect(sanitize(aggregate)).toEqual({
        name: 'AggregateError',
        message: 'all failed',
        stack: expect.any(String),
        errors: [{ name: 'Error', message: 'bare' }],
      });
    });

    it('should keep a `config` or `request` that is not an object', (): void => {
      expect(sanitize({ config: 'production', request: 'req-1' })).toEqual({ config: 'production', request: 'req-1' });
    });

    it('should leave out the configuration of an axios error without method nor URL', (): void => {
      const error = Object.assign(new Error('odd'), { config: { headers: { Authorization: 'Bearer zzzzzzzzzz' } } });

      expect(sanitize(error)).toEqual({ name: 'Error', message: 'odd', stack: expect.any(String) });
    });
  });

  describe('sanitizeLogInfo', () => {
    it('should keep the level symbol and drop the arguments symbol', (): void => {
      const level: symbol = Symbol.for('level');
      const splat: symbol = Symbol.for('splat');
      const info = { level: 'info', message: 'hello', [level]: 'info', [splat]: [] } as never;

      const output = sanitizeLogInfo(info) as unknown as Record<string | symbol, unknown>;

      expect(output[level]).toBe('info');
      expect(output[splat]).toBeUndefined();
      expect(Object.keys(output)).toEqual(['level', 'message']);
    });

    it('should log an error alone without stack', (): void => {
      const error = Object.assign(new Error('no stack'), { level: 'error' });
      error.stack = undefined;

      expect(sanitizeLogInfo(error as never)).toEqual({ level: 'error', message: 'no stack' });
    });

    it('should add an error to an entry whose `errors` is not a list', (): void => {
      const splat: symbol = Symbol.for('splat');
      const second = new Error('second');
      const info = { level: 'error', message: 'm', error: 'first', errors: 'odd', [splat]: ['x', second] } as never;

      expect(sanitizeLogInfo(info)).toEqual(
        expect.objectContaining({
          message: 'm x',
          error: 'first',
          errors: [expect.objectContaining({ message: 'second' })],
        })
      );
    });
  });

  describe('isSensitiveKey', () => {
    it.each([
      'authorization',
      'Cookie',
      'set-cookie',
      'api_key',
      'apiKey',
      'password',
      'smtpPassword',
      'privateKey',
      'client_secret',
      'refresh_token',
      'access_token',
      'accessToken',
      'secret',
      'token',
      'secretAccessKey',
    ])('should mask %s', (key: string): void => {
      expect(isSensitiveKey(key)).toBe(true);
    });

    it.each(['inputTokens', 'maxTokens', 'secretName', 'accessKeyId', 'message', 'campaignId'])(
      'should keep %s',
      (key: string): void => {
        expect(isSensitiveKey(key)).toBe(false);
      }
    );
  });

  describe('redactText', () => {
    it('should mask bearer tokens, URL credentials and signed query parameters', (): void => {
      expect(redactText('Authorization: Bearer abcdefgh.ijk')).toBe(`Authorization: Bearer ${REDACTED}`);
      expect(redactText('https://bucket.s3/a?X-Amz-Signature=abc&X-Amz-Credential=def&x=1')).toBe(
        `https://bucket.s3/a?X-Amz-Signature=${REDACTED}&X-Amz-Credential=${REDACTED}&x=1`
      );
      expect(redactText('the bearer of bad news')).toBe('the bearer of bad news');
    });

    it('should stay fast on long runs that almost match', (): void => {
      const started: number = Date.now();
      redactText(`${'a'.repeat(4000)}://${'b'.repeat(4000)}`);
      redactText(`x://${'b:'.repeat(4000)}`);
      expect(Date.now() - started).toBeLessThan(500);
    });
  });
});
