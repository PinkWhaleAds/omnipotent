import { createVerify, generateKeyPairSync } from 'node:crypto';

import {
  base64Url,
  GoogleServiceAccountAuth,
  parseServiceAccountKey,
  signedAssertion,
} from '@src/platforms/google/google.auth';
import { GOOGLE_ADS_API, GoogleServiceAccountKey } from '@src/platforms/google/google.types';
import { PlatformError } from '@src/platforms/platform-adapter';

/** A real key pair, so that the signature is checked rather than assumed. */
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

/** A service account key, as Google Cloud downloads it. */
const KEY: GoogleServiceAccountKey = {
  type: 'service_account',
  client_email: 'ads@project.iam.gserviceaccount.com',
  private_key: privateKey,
  private_key_id: 'kid-1',
};

/** The clock of the specs, epoch milliseconds. */
const NOW = Date.UTC(2026, 10, 20, 10, 0, 0);

/**
 * The payload of a JWT.
 *
 * @param jwt - The token
 * @returns Its header and claims
 */
function decode(jwt: string): { header: Record<string, unknown>; claims: Record<string, unknown> } {
  const [header, claims] = jwt.split('.');
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString()) as Record<string, unknown>,
    claims: JSON.parse(Buffer.from(claims, 'base64url').toString()) as Record<string, unknown>,
  };
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

describe('Unit::Platforms::Google::Auth', () => {
  describe('base64Url', () => {
    it('should write base64 the way a JWS does: no padding, no plus, no slash', (): void => {
      expect(base64Url(Buffer.from([0xfb, 0xff, 0xfe]))).toBe('-__-');
      expect(base64Url('a')).toBe('YQ');
    });
  });

  describe('signedAssertion', () => {
    it('should sign, as the service account, an assertion Google can verify', (): void => {
      const jwt: string = signedAssertion(KEY, GOOGLE_ADS_API.tokenUrl, 1_000);
      const [header, claims, signature] = jwt.split('.');

      expect(decode(jwt)).toEqual({
        header: { alg: 'RS256', typ: 'JWT', kid: 'kid-1' },
        claims: {
          iss: KEY.client_email,
          scope: 'https://www.googleapis.com/auth/adwords',
          aud: GOOGLE_ADS_API.tokenUrl,
          iat: 1_000,
          exp: 4_600,
        },
      });
      expect(
        createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, 'base64url'))
      ).toBe(true);
    });

    it('should name no key id when the key has none', (): void => {
      const { private_key_id: _kid, ...withoutId } = KEY;

      expect(decode(signedAssertion(withoutId, GOOGLE_ADS_API.tokenUrl, 1)).header).toEqual({
        alg: 'RS256',
        typ: 'JWT',
      });
    });
  });

  describe('parseServiceAccountKey', () => {
    it('should read a key', (): void => {
      expect(parseServiceAccountKey(JSON.stringify(KEY))).toEqual(KEY);
    });

    it.each([
      ['text that is not JSON', 'not json', 'the secret is not JSON'],
      ['a JSON null', 'null', 'not a service account key'],
      ['a key without its private key', JSON.stringify({ client_email: 'x' }), 'not a service account key'],
    ])('should refuse %s, without quoting it', (_label: string, json: string, message: string): void => {
      expect(() => parseServiceAccountKey(json)).toThrow(message);
      expect(() => parseServiceAccountKey(json)).not.toThrow(json === 'not json' ? 'not json' : 'never');
    });
  });

  describe('GoogleServiceAccountAuth', () => {
    let fetchFn: jest.Mock;
    let loadKey: jest.Mock;
    let now: number;

    /**
     * The token provider, with a fake network and clock.
     *
     * @returns It
     */
    function auth(): GoogleServiceAccountAuth {
      return new GoogleServiceAccountAuth(loadKey, fetchFn as unknown as typeof fetch, (): number => now);
    }

    /**
     * The failure a token request ends on.
     *
     * @param provider - The token provider
     * @returns The error it threw
     */
    async function failureOf(provider: GoogleServiceAccountAuth): Promise<PlatformError> {
      return (await provider.accessToken().catch((thrown: unknown): unknown => thrown)) as PlatformError;
    }

    beforeEach((): void => {
      now = NOW;
      loadKey = jest.fn().mockResolvedValue(JSON.stringify(KEY));
      fetchFn = jest.fn().mockResolvedValue(tokenResponse({ access_token: 'ya29.first', expires_in: 3_600 }));
    });

    it('should exchange a signed assertion for a token at the token endpoint', async (): Promise<void> => {
      await expect(auth().accessToken()).resolves.toBe('ya29.first');

      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(GOOGLE_ADS_API.tokenUrl);
      const form = new URLSearchParams(init.body as string);
      expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
      expect(decode(form.get('assertion') as string).claims).toMatchObject({ iat: NOW / 1000 });
    });

    it('should keep the token until shortly before it expires, then exchange again', async (): Promise<void> => {
      const provider: GoogleServiceAccountAuth = auth();
      await provider.accessToken();

      now = NOW + (3_600 - 61) * 1000;
      await expect(provider.accessToken()).resolves.toBe('ya29.first');
      expect(fetchFn).toHaveBeenCalledTimes(1);

      fetchFn.mockResolvedValue(tokenResponse({ access_token: 'ya29.second', expires_in: 3_600 }));
      now = NOW + (3_600 - 60) * 1000;
      await expect(provider.accessToken()).resolves.toBe('ya29.second');
      // The key is read at each exchange, so a rotated one is picked up without a restart.
      expect(loadKey).toHaveBeenCalledTimes(2);
    });

    it('should share one exchange between callers asking at the same time', async (): Promise<void> => {
      const provider: GoogleServiceAccountAuth = auth();

      await expect(Promise.all([provider.accessToken(), provider.accessToken()])).resolves.toEqual([
        'ya29.first',
        'ya29.first',
      ]);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('should exchange again once the token is dropped', async (): Promise<void> => {
      const provider: GoogleServiceAccountAuth = auth();
      await provider.accessToken();

      provider.invalidate();
      await provider.accessToken();

      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('should ask the endpoint the key names, and assume an hour when the lifetime is not said', async (): Promise<void> => {
      loadKey.mockResolvedValue(JSON.stringify({ ...KEY, token_uri: 'https://oauth.test/token' }));
      fetchFn.mockResolvedValue(tokenResponse({ access_token: 'ya29.other' }));
      const provider: GoogleServiceAccountAuth = auth();

      await provider.accessToken();
      now = NOW + 3_000 * 1000;
      await provider.accessToken();

      expect(fetchFn.mock.calls[0][0]).toBe('https://oauth.test/token');
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('should renew at once a token whose lifetime is shorter than the margin', async (): Promise<void> => {
      fetchFn.mockResolvedValue(tokenResponse({ access_token: 'ya29.short', expires_in: 30 }));
      const provider: GoogleServiceAccountAuth = auth();

      await provider.accessToken();
      await provider.accessToken();

      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it.each([
      [
        'a key that cannot be read',
        (): void => void loadKey.mockRejectedValue(new Error('secret missing')),
        'secret missing',
      ],
      ['a key the store answers oddly', (): void => void loadKey.mockRejectedValue('gone'), 'gone'],
      [
        'a key whose private key is broken',
        (): void => void loadKey.mockResolvedValue(JSON.stringify({ ...KEY, private_key: 'x' })),
        'cannot be used',
      ],
    ])(
      'should blame our own credentials for %s, without retrying',
      async (_label: string, arrange: () => void, reason: string): Promise<void> => {
        arrange();

        const error: PlatformError = await failureOf(auth());

        expect(error.message).toContain(reason);
        expect(error.options).toMatchObject({
          ownCredentials: true,
          invalidCredentials: false,
          retryable: true,
          statusCode: null,
          code: 'service_account_key',
        });
        expect(fetchFn).not.toHaveBeenCalled();
      }
    );

    it('should blame our own credentials, and allow a retry, when the endpoint does not answer', async (): Promise<void> => {
      fetchFn.mockRejectedValue(new TypeError('fetch failed'));

      await expect(failureOf(auth())).resolves.toMatchObject({
        message: expect.stringContaining('fetch failed'),
        options: { ownCredentials: true, retryable: true, statusCode: null, code: null },
      });
    });

    it.each([
      [
        'its description',
        { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' },
        400,
        'Invalid JWT Signature.',
        'invalid_grant',
        false,
      ],
      ['its error alone', { error: 'invalid_client' }, 401, 'invalid_client', 'invalid_client', false],
      ['its status, when the body says nothing', 'oops', 503, 'HTTP 503', null, true],
    ])(
      'should word a refusal of the endpoint with %s',
      async (
        _label: string,
        body: unknown,
        status: number,
        reason: string,
        code: string | null,
        retryable: boolean
      ): Promise<void> => {
        fetchFn.mockResolvedValue(tokenResponse(body, status));

        await expect(failureOf(auth())).resolves.toMatchObject({
          message: expect.stringContaining(reason),
          options: { ownCredentials: true, invalidCredentials: false, statusCode: status, code, retryable },
        });
      }
    );

    it('should refuse an answer that carries no token', async (): Promise<void> => {
      fetchFn.mockResolvedValue(tokenResponse('null'));

      await expect(failureOf(auth())).resolves.toMatchObject({
        message: expect.stringContaining('no access token'),
        options: { ownCredentials: true, statusCode: 200, retryable: false },
      });
    });

    it("should go through Node's own fetch when none is given", async (): Promise<void> => {
      const spy: jest.SpyInstance = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(tokenResponse({ access_token: 'ya29.global' }));

      await expect(new GoogleServiceAccountAuth(loadKey).accessToken()).resolves.toBe('ya29.global');
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });
});
