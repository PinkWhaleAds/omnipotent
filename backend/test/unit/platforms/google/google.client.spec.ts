import { describeGoogleAdsError, GoogleAdsClient } from '@src/platforms/google/google.client';
import { PlatformError } from '@src/platforms/platform-adapter';
import { PlatformErrorDescription, PlatformFailure, PlatformHttp } from '@src/platforms/platform-http';

/** The type Google gives the detail listing its errors. */
const FAILURE_TYPE = 'type.googleapis.com/google.ads.googleads.v25.errors.GoogleAdsFailure';

/**
 * A failed call.
 *
 * @param data - Its body
 * @param overrides - Status, request id, error
 * @returns The failure
 */
function failure(data: unknown, overrides: Partial<PlatformFailure> = {}): PlatformFailure {
  return { statusCode: 400, data, requestId: null, error: null, ...overrides };
}

/**
 * The body of a failed call listing Google Ads errors.
 *
 * @param errors - The errors
 * @param envelope - The rest of the envelope
 * @returns The body
 */
function googleErrors(errors: object[], envelope: object = {}): object {
  return {
    error: {
      code: 400,
      message: 'Request contains an invalid argument.',
      status: 'INVALID_ARGUMENT',
      // A detail without a type, another detail, then the one that lists the errors.
      details: [{}, { '@type': 'type.googleapis.com/other' }, { '@type': FAILURE_TYPE, errors, requestId: 'r-body' }],
      ...envelope,
    },
  };
}

/**
 * A failure of the HTTP client.
 *
 * @param statusCode - Its status
 * @returns The error
 */
function refused(statusCode: number): PlatformError {
  return new PlatformError('google_ads', 'Refused', {
    statusCode,
    retryable: false,
    invalidCredentials: false,
    requestId: null,
  });
}

describe('Unit::Platforms::Google::Client', () => {
  describe('describeGoogleAdsError', () => {
    it('should list every Google Ads error, with its faulty value and its code', (): void => {
      const described: PlatformErrorDescription = describeGoogleAdsError(
        failure(
          googleErrors([
            {
              errorCode: { managerLinkError: 'ALREADY_MANAGED_IN_HIERARCHY' },
              message: 'The client is already managed in the hierarchy.',
              trigger: { stringValue: '9725630707' },
            },
            { errorCode: { managerLinkError: 'ALREADY_MANAGED_BY_THIS_MANAGER' } },
            { message: 'Without a code.' },
          ])
        )
      );

      expect(described).toEqual({
        message:
          'The client is already managed in the hierarchy. ("9725630707") [managerLinkError.ALREADY_MANAGED_IN_HIERARCHY]; ' +
          'Google Ads error [managerLinkError.ALREADY_MANAGED_BY_THIS_MANAGER]; Without a code.',
        code: 'ALREADY_MANAGED_IN_HIERARCHY',
        codes: ['ALREADY_MANAGED_IN_HIERARCHY', 'ALREADY_MANAGED_BY_THIS_MANAGER'],
        requestId: 'r-body',
        retryable: false,
        invalidCredentials: false,
        ownCredentials: false,
      });
    });

    it("should prefer the header's request id over the body's", (): void => {
      expect(describeGoogleAdsError(failure(googleErrors([]), { requestId: 'r-header' })).requestId).toBe('r-header');
    });

    it('should fall back on the envelope, with its gRPC status', (): void => {
      expect(
        describeGoogleAdsError(
          failure({ error: { message: 'Not allowed', status: 'PERMISSION_DENIED' } }, { statusCode: 403 })
        )
      ).toMatchObject({
        message: 'Not allowed [PERMISSION_DENIED]',
        code: 'PERMISSION_DENIED',
        codes: [],
        requestId: null,
      });
    });

    it('should keep the message of an envelope that names no status', (): void => {
      expect(describeGoogleAdsError(failure({ error: { message: 'Bad' } }))).toMatchObject({
        message: 'Bad',
        code: null,
      });
    });

    it.each([
      ['a text body', 'Service Unavailable', 503, 'Google Ads answered HTTP 503'],
      ['a body without envelope', { other: true }, 400, 'Google Ads answered HTTP 400'],
    ])('should say the status of %s', (_label: string, data: unknown, statusCode: number, message: string): void => {
      expect(describeGoogleAdsError(failure(data, { statusCode })).message).toBe(message);
    });

    it.each([
      ['an Error', new TypeError('fetch failed'), 'fetch failed'],
      ['anything else', 'timeout', 'timeout'],
    ])(
      'should say what was thrown when no response came back, from %s',
      (_label: string, error: unknown, message: string): void => {
        expect(describeGoogleAdsError(failure(null, { statusCode: null, error }))).toMatchObject({
          message,
          retryable: true,
        });
      }
    );

    it.each([
      ['a 429', failure(null, { statusCode: 429 })],
      ['a 5xx', failure(null, { statusCode: 502 })],
      ['a transient gRPC status', failure({ error: { status: 'UNAVAILABLE' } }, { statusCode: 400 })],
      [
        'a transient Google Ads code',
        failure(googleErrors([{ errorCode: { databaseError: 'CONCURRENT_MODIFICATION' } }])),
      ],
    ])('should call %s temporary', (_label: string, given: PlatformFailure): void => {
      expect(describeGoogleAdsError(given).retryable).toBe(true);
    });

    it("should say we lost access to the client's account, and never blame our credentials for it", (): void => {
      expect(
        describeGoogleAdsError(failure(googleErrors([{ errorCode: { authorizationError: 'CUSTOMER_NOT_ENABLED' } }])))
      ).toMatchObject({ invalidCredentials: true, ownCredentials: false });
    });

    it.each([
      ['a 401, which survived a new token', failure(null, { statusCode: 401 })],
      ['the gRPC status of an unknown caller', failure({ error: { status: 'UNAUTHENTICATED' } }, { statusCode: 400 })],
      [
        'a project not approved',
        failure(googleErrors([{ errorCode: { authorizationError: 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION' } }]), {
          statusCode: 403,
        }),
      ],
    ])('should blame our own credentials for %s, never the account', (_label: string, given: PlatformFailure): void => {
      expect(describeGoogleAdsError(given)).toMatchObject({ ownCredentials: true, invalidCredentials: false });
    });
  });

  describe('GoogleAdsClient', () => {
    let http: { request: jest.Mock };
    let onUnauthenticated: jest.Mock;
    let client: GoogleAdsClient;

    beforeEach((): void => {
      http = { request: jest.fn() };
      onUnauthenticated = jest.fn();
      client = new GoogleAdsClient(http as unknown as PlatformHttp, '7719345054', onUnauthenticated);
    });

    it('should read every page of a search, through our manager account, the first page alone costing', async (): Promise<void> => {
      http.request
        .mockResolvedValueOnce({ results: [{ customer: { id: '1' } }], nextPageToken: 'p2' })
        .mockResolvedValueOnce({ nextPageToken: '' });

      await expect(client.search('acc-1', '9725630707', 'SELECT customer.id FROM customer')).resolves.toEqual([
        { customer: { id: '1' } },
      ]);
      expect(http.request).toHaveBeenNthCalledWith(1, 'acc-1', {
        method: 'POST',
        path: '/customers/9725630707/googleAds:search',
        body: { query: 'SELECT customer.id FROM customer' },
        operations: 1,
        headers: { 'login-customer-id': '7719345054' },
      });
      expect(http.request).toHaveBeenNthCalledWith(
        2,
        'acc-1',
        expect.objectContaining({ body: { query: 'SELECT customer.id FROM customer', pageToken: 'p2' }, operations: 0 })
      );
    });

    it('should drop a token Google refused, and try once more with a new one', async (): Promise<void> => {
      http.request.mockRejectedValueOnce(refused(401)).mockResolvedValueOnce({ results: [] });

      await expect(client.search(null, '7719345054', 'SELECT 1')).resolves.toEqual([]);
      expect(onUnauthenticated).toHaveBeenCalledTimes(1);
      expect(http.request).toHaveBeenCalledTimes(2);
    });

    it('should let any other failure through, untried', async (): Promise<void> => {
      const denied: PlatformError = refused(403);
      http.request.mockRejectedValueOnce(denied);

      await expect(client.search(null, '7719345054', 'SELECT 1')).rejects.toBe(denied);
      expect(onUnauthenticated).not.toHaveBeenCalled();
    });

    it('should let through a failure that is not the platform', async (): Promise<void> => {
      const broken = new Error('bug');
      http.request.mockRejectedValueOnce(broken);

      await expect(client.search(null, '7719345054', 'SELECT 1')).rejects.toBe(broken);
    });
  });
});
