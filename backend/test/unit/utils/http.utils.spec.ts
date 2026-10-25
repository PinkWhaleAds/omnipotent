import { FastifyRequest } from 'fastify';

import { AuthContext } from '@src/types';
import { IDS, JANE } from '@test/unit/mocks/auth.fixtures';
import {
  actorOf,
  clientIpOf,
  defaultErrorCode,
  errorCodeOf,
  httpError,
  organizationIdOf,
  pathOf,
  statusCodeOf,
  trustNearestProxies,
} from '@utils';

describe('Unit::Utils::Http', () => {
  describe('httpError', () => {
    it('should build an error carrying the status code', (): void => {
      const error: Error & { statusCode?: number } = httpError(404, 'Foo not found');

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Foo not found');
      expect(error.statusCode).toBe(404);
      expect(error.cause).toBeUndefined();
    });

    it('should keep the underlying error as the cause', (): void => {
      const cause: Error = new Error('ECONNREFUSED');

      const error: Error = httpError(503, 'Database unreachable', { cause });

      expect(error.cause).toBe(cause);
    });

    it('should not set a cause when it is null', (): void => {
      const error: Error = httpError(400, 'Bad input', { cause: null });

      expect(error.cause).toBeUndefined();
    });

    it('should carry the code and values given', (): void => {
      const error: Error = httpError(409, 'Only a draft can be launched', {
        code: 'campaign_not_draft',
        params: { status: 'active' },
      });

      expect(errorCodeOf(error)).toEqual({ code: 'campaign_not_draft', params: { status: 'active' } });
    });

    it('should carry the code of its status when none is given', (): void => {
      expect(errorCodeOf(httpError(404, 'Foo not found'))).toEqual({ code: 'not_found', params: {} });
    });
  });

  describe('defaultErrorCode', () => {
    it.each([
      [400, 'bad_request'],
      [409, 'conflict'],
      [503, 'unavailable'],
      [418, 'error'],
    ])('should name status %i %s', (status: number, code: string): void => {
      expect(defaultErrorCode(status)).toBe(code);
    });
  });

  describe('errorCodeOf', () => {
    it('should keep empty values when an error carries a code without them', (): void => {
      expect(errorCodeOf({ errorCode: 'name_taken' })).toEqual({ code: 'name_taken', params: {} });
    });

    it.each([
      ['an error without code', new Error('boom')],
      ['null', null],
      ['a string', 'boom'],
    ])('should answer undefined for %s', (_case: string, error: unknown): void => {
      expect(errorCodeOf(error)).toBeUndefined();
    });
  });

  describe('statusCodeOf', () => {
    it('should read the status code of an httpError', (): void => {
      expect(statusCodeOf(httpError(409, 'Conflict'))).toBe(409);
    });

    it('should read the status code of any error carrying a numeric one', (): void => {
      expect(statusCodeOf({ statusCode: 400, message: 'Validation failed' })).toBe(400);
    });

    it.each([
      ['an error without status code', new Error('boom')],
      ['a non-numeric status code', { statusCode: '404' }],
      ['null', null],
      ['undefined', undefined],
      ['a string', 'boom'],
    ])('should answer undefined for %s', (_case: string, error: unknown): void => {
      expect(statusCodeOf(error)).toBeUndefined();
    });
  });

  describe('actorOf', () => {
    it('should return the authenticated caller', (): void => {
      const request: FastifyRequest = { auth: JANE } as FastifyRequest;

      const actor: AuthContext = actorOf(request);

      expect(actor).toBe(JANE);
    });

    it('should throw a 401 when the route was not authenticated', (): void => {
      const request: FastifyRequest = {} as FastifyRequest;

      let thrown: unknown;
      try {
        actorOf(request);
      } catch (error: unknown) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe('Authentication required');
      expect(statusCodeOf(thrown)).toBe(401);
      expect(errorCodeOf(thrown)).toEqual({ code: 'not_authenticated', params: {} });
    });
  });

  describe('organizationIdOf', () => {
    it('should return the X-Organization-Id header', (): void => {
      const request: FastifyRequest = {
        headers: { 'x-organization-id': IDS.organization },
      } as unknown as FastifyRequest;

      expect(organizationIdOf(request)).toBe(IDS.organization);
    });

    it.each([
      ['absent', {}],
      ['empty', { 'x-organization-id': '' }],
      ['repeated', { 'x-organization-id': [IDS.organization, IDS.otherOrganization] }],
    ])(
      'should throw a 400 when the header is %s (a route that does not declare it)',
      (_case: string, headers: object): void => {
        const request: FastifyRequest = { headers } as unknown as FastifyRequest;

        expect((): string => organizationIdOf(request)).toThrow(
          expect.objectContaining({
            statusCode: 400,
            message: 'The x-organization-id header is required',
            errorCode: 'organization_header_missing',
            errorParams: { header: 'x-organization-id' },
          })
        );
      }
    );
  });

  describe('trustNearestProxies', () => {
    it('should trust the nearest hops only', (): void => {
      const trust = trustNearestProxies(2);

      expect([0, 1, 2].map((hop: number): boolean => trust('10.0.0.1', hop))).toEqual([true, true, false]);
      expect(trustNearestProxies(0)('10.0.0.1', 0)).toBe(false);
    });
  });

  describe('pathOf', () => {
    it('should drop the query string of a URL', (): void => {
      expect(pathOf('/email/unsubscribe?token=abc')).toBe('/email/unsubscribe');
      expect(pathOf('/campaigns/1')).toBe('/campaigns/1');
    });
  });

  describe('clientIpOf', () => {
    const requestWith = (header?: string): FastifyRequest =>
      ({ ip: '10.0.1.5', headers: header === undefined ? {} : { 'cloudfront-viewer-address': header } }) as never;

    it.each([
      ['198.51.100.7:46532', '198.51.100.7'],
      ['2001:db8::1:46532', '2001:db8::1'],
    ])('should read the CloudFront viewer address %s when trusted', (header: string, expected: string): void => {
      expect(clientIpOf(requestWith(header), true)).toBe(expected);
    });

    it.each([['garbage'], ['not-an-ip:443'], ['']])(
      'should fall back on request.ip for an unreadable header %p',
      (header: string): void => {
        expect(clientIpOf(requestWith(header), true)).toBe('10.0.1.5');
      }
    );

    it('should ignore the header unless trusted (the configuration by default)', (): void => {
      expect(clientIpOf(requestWith('198.51.100.7:46532'))).toBe('10.0.1.5');
      expect(clientIpOf(requestWith(), true)).toBe('10.0.1.5');
    });
  });
});
