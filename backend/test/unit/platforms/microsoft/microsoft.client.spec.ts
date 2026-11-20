import {
  checkMicrosoftResponse,
  describeMicrosoftError,
  MicrosoftAdsClient,
} from '@src/platforms/microsoft/microsoft.client';
import { PlatformError } from '@src/platforms/platform-adapter';
import type { PlatformFailure, PlatformHttp, PlatformRequest } from '@src/platforms/platform-http';

/**
 * A failed call.
 *
 * @param data - Its body
 * @param statusCode - Its status, `null` without response
 * @param requestId - The id its headers carry
 * @returns The failure
 */
function failure(data: unknown, statusCode: number | null = 400, requestId: string | null = null): PlatformFailure {
  return { statusCode, data, requestId, error: null };
}

/**
 * An error of our HTTP client.
 *
 * @param statusCode - Its status
 * @param code - Microsoft's code
 * @returns The error
 */
function platformError(statusCode: number | null, code?: string): PlatformError {
  return new PlatformError('microsoft', 'refused', {
    statusCode,
    retryable: false,
    invalidCredentials: false,
    requestId: null,
    code,
  });
}

describe('Unit::Platforms::Microsoft::Client', () => {
  describe('describeMicrosoftError', () => {
    it("should read Customer Management's fault: every error, its codes, and the body's tracking id", (): void => {
      expect(
        describeMicrosoftError(
          failure({
            TrackingId: 't-body',
            OperationErrors: [
              { Code: 1410, ErrorCode: 'ClientLinkAlreadyExists', Message: 'Already linked.', Details: 'Pending.' },
              { Code: 1410, ErrorCode: 'ClientLinkAlreadyExists', Message: 'Already linked.', Details: 'Pending.' },
            ],
          })
        )
      ).toEqual({
        // The same error twice is said once.
        message: 'Already linked. (Pending.) [1410 ClientLinkAlreadyExists]',
        code: '1410',
        codes: ['1410', 'ClientLinkAlreadyExists', '1410', 'ClientLinkAlreadyExists'],
        requestId: 't-body',
        retryable: false,
        invalidCredentials: false,
        ownCredentials: false,
      });
    });

    it('should prefer the tracking id of the headers, and name where an error is', (): void => {
      expect(
        describeMicrosoftError(
          failure(
            {
              TrackingId: 't-body',
              Errors: [
                { Code: 105, Message: 'Invalid token.', Details: 'Invalid token.', FieldPath: 'DeveloperToken' },
              ],
            },
            400,
            't-header'
          )
        )
      ).toMatchObject({
        message: 'Invalid token. at DeveloperToken [105]',
        requestId: 't-header',
        // Our developer token: no client account is to blame.
        ownCredentials: true,
        invalidCredentials: false,
      });
    });

    it('should flatten the batch errors, nested lists and empty items, and see a lost account in them', (): void => {
      expect(
        describeMicrosoftError(
          failure({
            BatchErrors: [
              null,
              [{ Code: 2003, Message: 'No access.' }],
              { BatchErrors: [{ ErrorCode: 'UserIsNotAuthorized', Message: 'Not authorized.' }] },
            ],
          })
        )
      ).toEqual({
        message: 'No access. [2003]; Not authorized. [UserIsNotAuthorized]',
        code: '2003',
        codes: ['2003', 'UserIsNotAuthorized'],
        requestId: null,
        retryable: false,
        invalidCredentials: true,
        ownCredentials: false,
      });
    });

    it('should read a fault carried by the body itself', (): void => {
      expect(describeMicrosoftError(failure({ Code: 0, Message: 'Internal error.' }, 500))).toMatchObject({
        message: 'Internal error. [0]',
        code: '0',
        retryable: true,
      });
    });

    it('should word an error that says nothing, and name it by its symbol when it has no number', (): void => {
      expect(
        describeMicrosoftError(failure({ OperationErrors: [{ Code: null, ErrorCode: 'CallRateExceeded' }] }))
      ).toMatchObject({
        message: 'Microsoft Advertising error [CallRateExceeded]',
        code: 'CallRateExceeded',
        retryable: true,
      });
      expect(describeMicrosoftError(failure({ Message: 'An error has occurred.' }))).toMatchObject({
        message: 'An error has occurred.',
        code: null,
        codes: [],
      });
    });

    it('should see a 401 that outlived a new token as ours, whatever the body', (): void => {
      expect(describeMicrosoftError(failure({ Errors: [{ Code: 1, Message: 'Denied.' }] }, 401))).toMatchObject({
        ownCredentials: true,
      });
      expect(describeMicrosoftError(failure('Unauthorized', 401, 't-1'))).toEqual({
        message: 'Microsoft Advertising answered HTTP 401',
        code: null,
        requestId: 't-1',
        retryable: false,
        invalidCredentials: false,
        ownCredentials: true,
      });
    });

    it('should allow a retry after a status or a code that says so', (): void => {
      expect(describeMicrosoftError(failure(null, 503))).toMatchObject({ retryable: true, ownCredentials: false });
      expect(describeMicrosoftError(failure({ Errors: [{ Code: 117, Message: 'Too many.' }] }))).toMatchObject({
        retryable: true,
      });
    });

    it.each([
      ['an error', new TypeError('fetch failed'), 'fetch failed'],
      ['anything else', 'aborted', 'aborted'],
    ])(
      'should say what was thrown when no response came back: %s',
      (_label: string, thrown: unknown, message: string): void => {
        expect(describeMicrosoftError({ statusCode: null, data: null, requestId: null, error: thrown })).toEqual({
          message,
          code: null,
          requestId: null,
          retryable: true,
          invalidCredentials: false,
          ownCredentials: false,
        });
      }
    );
  });

  describe('checkMicrosoftResponse', () => {
    it.each([
      ['a body that is not an object', 'ok'],
      ['an answer without errors', { ClientLinks: [] }],
      ['partial errors that are all empty', { PartialErrors: [null, null] }],
    ])('should pass %s', (_label: string, data: unknown): void => {
      expect(checkMicrosoftResponse({ statusCode: 200, data, requestId: 't-1' })).toBeNull();
    });

    it('should fail an answer carrying a partial error, with its tracking id', (): void => {
      expect(
        checkMicrosoftResponse({
          statusCode: 200,
          data: { TrackingId: 't-body', PartialErrors: [null, { Code: 1471, Message: 'Prepaid.' }] },
          requestId: null,
        })
      ).toEqual({
        message: 'Prepaid. [1471]',
        code: '1471',
        codes: ['1471'],
        requestId: 't-body',
        retryable: false,
        invalidCredentials: false,
        ownCredentials: false,
      });
    });

    it("should fail an answer carrying Customer Management's operation errors", (): void => {
      expect(
        checkMicrosoftResponse({
          statusCode: 200,
          data: { OperationErrors: [{ Code: 1410, Message: 'Already linked.' }] },
          requestId: null,
        })
      ).toMatchObject({ code: '1410', requestId: null });
    });
  });

  describe('MicrosoftAdsClient', () => {
    let http: { request: jest.Mock };
    let auth: { developerToken: jest.Mock; invalidate: jest.Mock };
    let client: MicrosoftAdsClient;

    /**
     * The requests sent.
     *
     * @returns One per call
     */
    function sent(): PlatformRequest[] {
      return http.request.mock.calls.map(([, request]: [string | null, PlatformRequest]): PlatformRequest => request);
    }

    beforeEach((): void => {
      http = { request: jest.fn().mockResolvedValue({}) };
      auth = { developerToken: jest.fn().mockResolvedValue('dev-1'), invalidate: jest.fn() };
      client = new MicrosoftAdsClient(http as unknown as PlatformHttp, '255113635', auth);
    });

    it("should search a customer's accounts, page after page, with our developer token", async (): Promise<void> => {
      const first: object[] = Array.from({ length: 100 }, (_: unknown, index: number): object => ({ Id: index }));
      http.request.mockResolvedValueOnce({ Accounts: first }).mockResolvedValueOnce({ Accounts: [{ Id: 100 }] });

      await expect(client.accountsOf('255113635')).resolves.toHaveLength(101);

      expect(http.request).toHaveBeenCalledWith(null, {
        method: 'POST',
        path: '/Accounts/Search',
        body: {
          Predicates: [{ Field: 'CustomerId', Operator: 'Equals', Value: '255113635' }],
          PageInfo: { Index: 0, Size: 100 },
        },
        headers: { DeveloperToken: 'dev-1' },
      });
      expect((sent()[1].body as { PageInfo: unknown }).PageInfo).toEqual({ Index: 1, Size: 100 });
    });

    it('should read no account when Microsoft answers none', async (): Promise<void> => {
      http.request.mockResolvedValue({ Accounts: null });

      await expect(client.accountsOf('255113635')).resolves.toEqual([]);
    });

    it('should search the links of our manager account, by number', async (): Promise<void> => {
      http.request.mockResolvedValueOnce({ ClientLinks: [{ ClientEntityNumber: 'F100AB12' }] });

      await expect(client.clientLinks()).resolves.toEqual([{ ClientEntityNumber: 'F100AB12' }]);
      expect(sent()[0]).toMatchObject({
        method: 'POST',
        path: '/ClientLinks/Search',
        body: {
          Predicates: [{ Field: 'DirectManagingCustomerId', Operator: 'Equals', Value: '255113635' }],
          Ordering: [{ Field: 'Number', Order: 'Ascending' }],
        },
      });
      http.request.mockResolvedValueOnce({});
      await expect(client.clientLinks()).resolves.toEqual([]);
    });

    it('should refuse to read past the pages it allows, rather than miss some', async (): Promise<void> => {
      const full: object[] = Array.from({ length: 100 }, (): object => ({}));
      http.request.mockResolvedValue({ ClientLinks: full });

      await expect(client.clientLinks()).rejects.toThrow('more than 10000 items');
      expect(http.request).toHaveBeenCalledTimes(100);
    });

    it('should send and change links', async (): Promise<void> => {
      await client.addClientLinks([{ ClientEntityNumber: 'F100AB12' }]);
      await client.updateClientLinks([{ ClientEntityNumber: 'F100AB12', Status: 'LinkCanceled' }]);

      expect(sent()).toEqual([
        {
          method: 'POST',
          path: '/ClientLinks',
          body: { ClientLinks: [{ ClientEntityNumber: 'F100AB12' }] },
          headers: { DeveloperToken: 'dev-1' },
        },
        {
          method: 'PUT',
          path: '/ClientLinks',
          body: { ClientLinks: [{ ClientEntityNumber: 'F100AB12', Status: 'LinkCanceled' }] },
          headers: { DeveloperToken: 'dev-1' },
        },
      ]);
    });

    it('should read one account with its mode', async (): Promise<void> => {
      http.request.mockResolvedValueOnce({ Account: { Id: 900000001, AccountMode: 'Expert' } });

      await expect(client.account('900000001')).resolves.toEqual({ Id: 900000001, AccountMode: 'Expert' });
      expect(sent()[0]).toMatchObject({
        path: '/Account/Query',
        body: { AccountId: '900000001', ReturnAdditionalFields: 'AccountMode' },
      });
      http.request.mockResolvedValueOnce({ Account: null });
      await expect(client.account('900000001')).resolves.toEqual({});
    });

    it.each([
      ['a 401', platformError(401)],
      ['an expired token', platformError(400, '109')],
      ['an expired token, by its name', platformError(400, 'AuthenticationTokenExpired')],
    ])(
      'should drop a token Microsoft refuses on %s, and send once more',
      async (_label: string, refused: PlatformError): Promise<void> => {
        http.request.mockRejectedValueOnce(refused).mockResolvedValueOnce({ Account: { Id: 1 } });

        await expect(client.account('1')).resolves.toEqual({ Id: 1 });
        expect(auth.invalidate).toHaveBeenCalledTimes(1);
        expect(http.request).toHaveBeenCalledTimes(2);
      }
    );

    it('should not try a third time when the new token is refused too', async (): Promise<void> => {
      http.request.mockRejectedValue(platformError(401));

      await expect(client.account('1')).rejects.toMatchObject({ options: { statusCode: 401 } });
      expect(http.request).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['another refusal', platformError(400)],
      ['anything else', new Error('boom')],
    ])('should let %s through at once', async (_label: string, thrown: Error): Promise<void> => {
      http.request.mockRejectedValue(thrown);

      await expect(client.account('1')).rejects.toBe(thrown);
      expect(auth.invalidate).not.toHaveBeenCalled();
      expect(http.request).toHaveBeenCalledTimes(1);
    });
  });
});
