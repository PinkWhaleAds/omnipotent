import {
  MicrosoftCredentialsStore,
  MicrosoftOAuthTokens,
  parseAppSecret,
  parseOAuthSecret,
  requestTokens,
  tokenSecret,
} from '@src/platforms/microsoft/microsoft.auth';
import { MICROSOFT_ADS_API, MicrosoftOAuthSecret } from '@src/platforms/microsoft/microsoft.types';
import { PlatformError } from '@src/platforms/platform-adapter';

/** The clock of the specs, epoch milliseconds. */
const NOW = Date.UTC(2026, 10, 20, 10, 0, 0);

/** A minute and a day, in milliseconds. */
const MINUTE = 60_000;
const DAY = 86_400_000;

/** Our Entra application and developer token, as the secret store holds them. */
const APP_JSON: string = JSON.stringify({ clientId: 'app-1', clientSecret: 'app-s', developerToken: 'dev-1' });

/**
 * The tokens of our service user, as the secret store holds them.
 *
 * @param overrides - What to change: by default an access token valid for an hour, renewed an hour ago
 * @returns The secret
 */
function oauth(overrides: Partial<MicrosoftOAuthSecret> = {}): string {
  return JSON.stringify({
    refreshToken: 'r-1',
    accessToken: 'a-1',
    accessTokenExpiresAt: new Date(NOW + 60 * MINUTE).toISOString(),
    refreshedAt: new Date(NOW - 60 * MINUTE).toISOString(),
    userEmail: 'service@test',
    ...overrides,
  });
}

/**
 * A response of the token endpoint.
 *
 * @param body - Its JSON body, or text
 * @param status - Its status
 * @returns The response
 */
function tokenResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

/**
 * The failure a call ends on.
 *
 * @param call - The call
 * @returns The error it threw
 */
async function failureOf(call: Promise<unknown>): Promise<PlatformError> {
  return call.then(
    (): never => {
      throw new Error('expected a failure');
    },
    (thrown: PlatformError): PlatformError => thrown
  );
}

describe('Unit::Platforms::Microsoft::Auth', () => {
  describe('parseAppSecret', () => {
    it('should read the three fields of our application', (): void => {
      expect(parseAppSecret(APP_JSON)).toEqual({ clientId: 'app-1', clientSecret: 'app-s', developerToken: 'dev-1' });
    });

    it.each([
      ['text that is not JSON', 'oops', 'the application secret is not JSON'],
      ['a JSON null', 'null', 'the application secret has no clientId'],
      ['no developer token', '{"clientId":"a","clientSecret":"b"}', 'has no developerToken'],
      ['an empty secret', '{"clientId":"a","clientSecret":"","developerToken":"d"}', 'has no clientSecret'],
    ])('should refuse %s, without quoting it', (_label: string, json: string, message: string): void => {
      expect((): unknown => parseAppSecret(json)).toThrow(message);
      expect((): unknown => parseAppSecret(json)).not.toThrow('oops');
    });
  });

  describe('parseOAuthSecret', () => {
    it('should read the tokens pnpm microsoft:connect writes', (): void => {
      expect(parseOAuthSecret(oauth())).toMatchObject({ refreshToken: 'r-1', accessToken: 'a-1' });
    });

    it.each([
      ['text that is not JSON', 'oops', 'the tokens secret is not JSON'],
      ['a JSON null', 'null', 'the tokens secret has no refresh token'],
      ['an empty refresh token', '{"refreshToken":""}', 'the tokens secret has no refresh token'],
    ])('should refuse %s', (_label: string, json: string, message: string): void => {
      expect((): unknown => parseOAuthSecret(json)).toThrow(message);
    });
  });

  describe('tokenSecret', () => {
    it('should keep the new refresh token and the lifetime Microsoft gives', (): void => {
      expect(
        tokenSecret(
          { access_token: 'a-2', refresh_token: 'r-2', expires_in: 1_800 },
          { refreshToken: 'r-1', userEmail: 'service@test' },
          NOW
        )
      ).toEqual({
        refreshToken: 'r-2',
        accessToken: 'a-2',
        accessTokenExpiresAt: new Date(NOW + 30 * MINUTE).toISOString(),
        refreshedAt: new Date(NOW).toISOString(),
        userEmail: 'service@test',
      });
    });

    it('should keep the previous refresh token, and assume an hour, when Microsoft says neither', (): void => {
      expect(tokenSecret({ access_token: 'a-2' }, { refreshToken: 'r-1' }, NOW)).toEqual({
        refreshToken: 'r-1',
        accessToken: 'a-2',
        accessTokenExpiresAt: new Date(NOW + 60 * MINUTE).toISOString(),
        refreshedAt: new Date(NOW).toISOString(),
        userEmail: null,
      });
    });
  });

  describe('requestTokens', () => {
    it('should post the form to the token endpoint, and answer the tokens', async (): Promise<void> => {
      const fetchFn: jest.Mock = jest.fn().mockResolvedValue(tokenResponse({ access_token: 'a-2' }));

      await expect(requestTokens(fetchFn, { grant_type: 'refresh_token', refresh_token: 'r-1' })).resolves.toEqual({
        access_token: 'a-2',
      });
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(MICROSOFT_ADS_API.tokenUrl);
      expect(init).toMatchObject({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token&refresh_token=r-1',
      });
    });

    it('should blame our own credentials, and allow a retry, when the endpoint does not answer', async (): Promise<void> => {
      const error: PlatformError = await failureOf(
        requestTokens(jest.fn().mockRejectedValue(new TypeError('fetch failed')), {})
      );

      expect(error).toBeInstanceOf(PlatformError);
      expect(error.message).toBe('Microsoft Advertising authentication failed: fetch failed');
      expect(error.options).toMatchObject({
        statusCode: null,
        retryable: true,
        invalidCredentials: false,
        ownCredentials: true,
        code: 'token_endpoint',
      });
    });

    it.each([
      ['a refused consent', { error: 'invalid_grant', error_description: 'AADSTS70000' }, 400, false, 'invalid_grant'],
      ['a refused client', { error: 'invalid_client' }, 401, false, 'invalid_client'],
      ['too many calls, without a word', 'oops', 429, true, 'token_endpoint'],
      ['an outage', { error: 'temporarily_unavailable' }, 503, true, 'temporarily_unavailable'],
    ])(
      'should read %s',
      async (_label: string, body: unknown, status: number, retryable: boolean, code: string): Promise<void> => {
        const error: PlatformError = await failureOf(
          requestTokens(jest.fn().mockResolvedValue(tokenResponse(body, status)), {})
        );

        expect(error.options).toMatchObject({ statusCode: status, retryable, ownCredentials: true, code });
      }
    );

    it('should say only a new consent mends a refused refresh token', async (): Promise<void> => {
      const error: PlatformError = await failureOf(
        requestTokens(jest.fn().mockResolvedValue(tokenResponse({ error: 'invalid_grant' }, 400)), {})
      );

      expect(error.message).toBe(
        'Microsoft Advertising refused the consent of our service user (invalid_grant): run pnpm microsoft:connect'
      );
    });

    it('should say the status when the refusal says nothing', async (): Promise<void> => {
      const error: PlatformError = await failureOf(
        requestTokens(jest.fn().mockResolvedValue(tokenResponse('null', 500)), {})
      );

      expect(error.message).toBe('Microsoft Advertising authentication failed: HTTP 500');
    });

    it('should refuse an answer that carries no access token, and allow a retry', async (): Promise<void> => {
      const error: PlatformError = await failureOf(
        requestTokens(jest.fn().mockResolvedValue(tokenResponse({ refresh_token: 'r-2' })), {})
      );

      expect(error.message).toBe('The Microsoft token endpoint returned no access token');
      expect(error.options).toMatchObject({ statusCode: 200, retryable: true, code: 'token_endpoint' });
    });
  });

  describe('MicrosoftOAuthTokens', () => {
    let stored: string;
    let store: { readApp: jest.Mock; readOAuth: jest.Mock; writeOAuth: jest.Mock };
    let withLock: jest.Mock;
    let fetchFn: jest.Mock;
    let now: number;
    let tokens: MicrosoftOAuthTokens;

    /**
     * The forms the token endpoint received.
     *
     * @returns One form per exchange
     */
    function exchanges(): Record<string, string>[] {
      return fetchFn.mock.calls.map(([, init]: [string, RequestInit]): Record<string, string> =>
        Object.fromEntries(new URLSearchParams(init.body as string))
      );
    }

    beforeEach((): void => {
      now = NOW;
      stored = oauth();
      store = {
        readApp: jest.fn(async (): Promise<string> => APP_JSON),
        readOAuth: jest.fn(async (): Promise<string> => stored),
        writeOAuth: jest.fn(async (value: string): Promise<void> => {
          stored = value;
        }),
      };
      withLock = jest.fn(async <T>(_key: string, work: () => Promise<T>): Promise<T> => work());
      fetchFn = jest.fn(async (): Promise<Response> =>
        tokenResponse({ access_token: 'a-new', refresh_token: 'r-new', expires_in: 3_600 })
      );
      tokens = new MicrosoftOAuthTokens(
        store as MicrosoftCredentialsStore,
        withLock,
        fetchFn as unknown as typeof fetch,
        (): number => now
      );
    });

    it('should use the access token of the secret while it is fresh, and keep it in memory', async (): Promise<void> => {
      await expect(tokens.accessToken()).resolves.toBe('a-1');
      await expect(tokens.accessToken()).resolves.toBe('a-1');

      expect(store.readOAuth).toHaveBeenCalledTimes(1);
      expect(withLock).not.toHaveBeenCalled();
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('should renew under the lock, and write the new tokens back', async (): Promise<void> => {
      stored = oauth({ accessToken: null, accessTokenExpiresAt: null });

      await expect(tokens.accessToken()).resolves.toBe('a-new');

      expect(withLock).toHaveBeenCalledWith(MICROSOFT_ADS_API.refreshLockKey, expect.any(Function));
      // Once before the lock, once under it: another process may have renewed meanwhile.
      expect(store.readOAuth).toHaveBeenCalledTimes(2);
      expect(exchanges()).toEqual([
        {
          client_id: 'app-1',
          client_secret: 'app-s',
          grant_type: 'refresh_token',
          refresh_token: 'r-1',
          scope: MICROSOFT_ADS_API.scope,
        },
      ]);
      expect(JSON.parse(stored)).toEqual({
        refreshToken: 'r-new',
        accessToken: 'a-new',
        accessTokenExpiresAt: new Date(NOW + 60 * MINUTE).toISOString(),
        refreshedAt: new Date(NOW).toISOString(),
        userEmail: 'service@test',
      });
    });

    it('should take the tokens another process renewed while it waited for the lock', async (): Promise<void> => {
      store.readOAuth
        .mockResolvedValueOnce(oauth({ accessToken: null }))
        .mockResolvedValueOnce(oauth({ accessToken: 'a-other' }));

      await expect(tokens.accessToken()).resolves.toBe('a-other');

      expect(withLock).toHaveBeenCalledTimes(1);
      expect(fetchFn).not.toHaveBeenCalled();
      expect(store.writeOAuth).not.toHaveBeenCalled();
    });

    it.each([
      ['no access token', { accessToken: null }],
      ['an empty access token', { accessToken: '' }],
      ['no expiry', { accessTokenExpiresAt: null }],
      ['a token that expires within five minutes', { accessTokenExpiresAt: new Date(NOW + 4 * MINUTE).toISOString() }],
      ['tokens renewed more than seven days ago', { refreshedAt: new Date(NOW - 8 * DAY).toISOString() }],
    ])(
      'should renew a secret holding %s',
      async (_label: string, overrides: Partial<MicrosoftOAuthSecret>): Promise<void> => {
        stored = oauth(overrides);

        await expect(tokens.accessToken()).resolves.toBe('a-new');
        expect(fetchFn).toHaveBeenCalledTimes(1);
      }
    );

    it('should read the secret again once the token kept in memory nears its end', async (): Promise<void> => {
      await expect(tokens.accessToken()).resolves.toBe('a-1');
      now = NOW + 56 * MINUTE;

      await expect(tokens.accessToken()).resolves.toBe('a-new');
      expect(store.readOAuth).toHaveBeenCalledTimes(3);
    });

    it('should share one exchange between callers asking at the same time', async (): Promise<void> => {
      stored = oauth({ accessToken: null });

      await expect(Promise.all([tokens.accessToken(), tokens.accessToken()])).resolves.toEqual(['a-new', 'a-new']);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      // The exchange over, a later caller is served from memory.
      await expect(tokens.accessToken()).resolves.toBe('a-new');
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('should drop a refused token, and never take it from the secret again', async (): Promise<void> => {
      await expect(tokens.accessToken()).resolves.toBe('a-1');

      tokens.invalidate();
      // The secret still holds it: nobody renewed it.
      await expect(tokens.accessToken()).resolves.toBe('a-new');
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('should drop nothing when no token is kept', async (): Promise<void> => {
      tokens.invalidate();

      await expect(tokens.accessToken()).resolves.toBe('a-1');
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('should go on with the new tokens when they cannot be written, and say so', async (): Promise<void> => {
      const warn: jest.Mock = jest.fn();
      Reflect.set(tokens, 'logger', { warn });
      stored = oauth({ accessToken: null });
      store.writeOAuth.mockRejectedValue(new Error('AccessDenied'));

      await expect(tokens.accessToken()).resolves.toBe('a-new');
      expect(warn).toHaveBeenCalledWith('The new Microsoft Advertising tokens could not be saved', {
        error: 'AccessDenied',
      });
    });

    it('should give our developer token', async (): Promise<void> => {
      await expect(tokens.developerToken()).resolves.toBe('dev-1');
    });

    it('should allow a retry when a secret cannot be read', async (): Promise<void> => {
      store.readOAuth.mockRejectedValue('throttled');

      const error: PlatformError = await failureOf(tokens.accessToken());

      expect(error.message).toBe('The Microsoft Advertising tokens secret cannot be read: throttled');
      expect(error.options).toMatchObject({ retryable: true, ownCredentials: true, code: 'secret_unreadable' });
    });

    it.each([
      [
        'the tokens',
        (): void => void store.readOAuth.mockResolvedValue('oops'),
        'The Microsoft Advertising tokens secret is malformed (the tokens secret is not JSON): run pnpm microsoft:connect',
      ],
      [
        'the application',
        (): void => void store.readApp.mockResolvedValue('{}'),
        'The Microsoft Advertising application secret is malformed (the application secret has no clientId): it holds clientId, clientSecret, developerToken',
      ],
    ])(
      'should say how to mend a malformed secret of %s',
      async (_label: string, arrange: () => void, message: string): Promise<void> => {
        arrange();
        stored = oauth({ accessToken: null });

        const error: PlatformError = await failureOf(tokens.accessToken());

        expect(error.message).toBe(message);
        expect(error.options).toMatchObject({ retryable: false, ownCredentials: true, code: 'secret_malformed' });
      }
    );

    it('should let a refusal of the token endpoint through, untouched', async (): Promise<void> => {
      stored = oauth({ accessToken: null });
      fetchFn.mockResolvedValue(tokenResponse({ error: 'invalid_grant' }, 400));

      await expect(tokens.accessToken()).rejects.toMatchObject({
        options: { code: 'invalid_grant', retryable: false },
      });
      expect(store.writeOAuth).not.toHaveBeenCalled();
    });

    it("should go through Node's own fetch and clock when none is given", async (): Promise<void> => {
      const spy: jest.SpyInstance = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(tokenResponse({ access_token: 'a-global' }));
      stored = oauth({ accessToken: null });

      await expect(new MicrosoftOAuthTokens(store as MicrosoftCredentialsStore, withLock).accessToken()).resolves.toBe(
        'a-global'
      );
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });
});
