import { pkcePair } from '@src/platforms/consent';
import {
  accountOfIdToken,
  connectMicrosoftAds,
  MicrosoftConnectOptions,
  microsoftAuthorizationUrl,
} from '@src/platforms/microsoft/microsoft-connect';
import { MICROSOFT_ADS_API, MicrosoftOAuthSecret } from '@src/platforms/microsoft/microsoft.types';
import { consentListening, FakeConsentServer, Page } from '@test/unit/mocks/consent-server.mock';

/** The clock of the specs, epoch milliseconds. */
const NOW = Date.UTC(2026, 10, 20, 10, 0, 0);

/** Random bytes the specs can predict. */
const random = (size: number): Buffer => Buffer.alloc(size, 1);

/** The state the command sends with the consent page, from those bytes. */
const STATE: string = Buffer.alloc(16, 1).toString('hex');

/** Where the consent comes back, as declared in Entra. */
const REDIRECT_URI = 'http://localhost:4102/microsoft/callback';

/** Our Entra application and developer token. */
const APP_JSON: string = JSON.stringify({ clientId: 'app-1', clientSecret: 'app-s', developerToken: 'dev-1' });

/**
 * An ID token: only its claims matter here.
 *
 * @param claims - What it says
 * @returns The token
 */
function idToken(claims: Record<string, unknown>): string {
  return `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
}

/**
 * A response of the token endpoint.
 *
 * @param body - Its JSON body
 * @param status - Its status
 * @returns The response
 */
function tokenResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('Unit::Platforms::Microsoft::Connect', () => {
  let server: FakeConsentServer;
  let secrets: { get: jest.Mock; put: jest.Mock };
  let fetchFn: jest.Mock;
  let printed: string[];

  /**
   * The options of a run, with the fakes of the spec.
   *
   * @param overrides - What to change
   * @returns The options
   */
  function options(overrides: Partial<MicrosoftConnectOptions> = {}): MicrosoftConnectOptions {
    return {
      config: { appSecret: 'microsoft-ads/app', oauthSecret: 'microsoft-ads/oauth', redirectUri: REDIRECT_URI },
      secrets: secrets as never,
      print: (line: string): void => void printed.push(line),
      createServer: server.factory(),
      fetchFn: fetchFn as unknown as typeof fetch,
      random,
      now: (): number => NOW,
      ...overrides,
    };
  }

  beforeEach((): void => {
    server = new FakeConsentServer(4102);
    secrets = { get: jest.fn().mockResolvedValue(APP_JSON), put: jest.fn().mockResolvedValue(undefined) };
    fetchFn = jest.fn(async (): Promise<Response> =>
      tokenResponse({
        access_token: 'a-1',
        refresh_token: 'r-1',
        expires_in: 3_600,
        id_token: idToken({ preferred_username: 'service@test' }),
      })
    );
    printed = [];
  });

  describe('microsoftAuthorizationUrl', () => {
    it('should ask for the API with an offline access, a state, PKCE and the choice of the account', (): void => {
      const url = new URL(
        microsoftAuthorizationUrl({ clientId: 'app-1', redirectUri: REDIRECT_URI, state: 'st', challenge: 'ch' })
      );

      expect(`${url.origin}${url.pathname}`).toBe(MICROSOFT_ADS_API.authorizeUrl);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        client_id: 'app-1',
        response_type: 'code',
        response_mode: 'query',
        redirect_uri: REDIRECT_URI,
        scope: `openid profile ${MICROSOFT_ADS_API.scope}`,
        state: 'st',
        code_challenge: 'ch',
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
    });
  });

  describe('accountOfIdToken', () => {
    it('should name the account by its user name, else its email', (): void => {
      expect(accountOfIdToken(idToken({ preferred_username: 'service@test', email: 'other@test' }))).toBe(
        'service@test'
      );
      expect(accountOfIdToken(idToken({ email: 'other@test' }))).toBe('other@test');
    });

    it.each([
      ['no token', undefined],
      ['a token without claims', 'abc'],
      ['claims that are not JSON', 'e30.bm90IGpzb24.sig'],
      ['an empty name', idToken({ preferred_username: '' })],
      ['a name that is not text', idToken({ preferred_username: 42 })],
    ])('should name nobody with %s', (_label: string, token: string | undefined): void => {
      expect(accountOfIdToken(token)).toBeNull();
    });
  });

  describe('connectMicrosoftAds', () => {
    it('should keep the consent of our service user, and name it without printing a token', async (): Promise<void> => {
      const run: Promise<MicrosoftOAuthSecret> = connectMicrosoftAds(options());
      await consentListening(server, printed);

      expect(secrets.get).toHaveBeenCalledWith('microsoft-ads/app', { fresh: true });
      // On the port and the path declared in Entra, and on the loopback only.
      expect(server.listened).toEqual({ port: 4102, host: '127.0.0.1' });
      const consentUrl = new URL(printed[1]);
      expect(consentUrl.searchParams.get('state')).toBe(STATE);
      expect(consentUrl.searchParams.get('code_challenge')).toBe(pkcePair(random).challenge);
      const page: Page = await server.hit(`/microsoft/callback?state=${STATE}&code=the-code`);

      const expected: MicrosoftOAuthSecret = {
        refreshToken: 'r-1',
        accessToken: 'a-1',
        accessTokenExpiresAt: new Date(NOW + 3_600_000).toISOString(),
        refreshedAt: new Date(NOW).toISOString(),
        userEmail: 'service@test',
      };
      await expect(run).resolves.toEqual(expected);
      expect(page.status).toBe(200);
      expect(secrets.put).toHaveBeenCalledWith('microsoft-ads/oauth', JSON.stringify(expected));
      const form = Object.fromEntries(
        new URLSearchParams((fetchFn.mock.calls[0] as [string, RequestInit])[1].body as string)
      );
      expect(form).toEqual({
        client_id: 'app-1',
        client_secret: 'app-s',
        grant_type: 'authorization_code',
        code: 'the-code',
        redirect_uri: REDIRECT_URI,
        code_verifier: pkcePair(random).verifier,
        scope: MICROSOFT_ADS_API.scope,
      });
      expect(printed.slice(2)).toEqual([
        'Consent of service@test saved in microsoft-ads/oauth.',
        'Run pnpm secrets:seed to keep it on AWS too.',
      ]);
      expect(printed.join('\n')).not.toMatch(/a-1|r-1|app-s|dev-1/);
      expect(server.closed).toBe(true);
    });

    it('should say so when Microsoft names no account', async (): Promise<void> => {
      fetchFn.mockImplementation(async (): Promise<Response> =>
        tokenResponse({ access_token: 'a-1', refresh_token: 'r-1' })
      );
      const run: Promise<MicrosoftOAuthSecret> = connectMicrosoftAds(options());
      await consentListening(server, printed);

      await server.hit(`/microsoft/callback?state=${STATE}&code=c`);

      await expect(run).resolves.toMatchObject({ userEmail: null });
      expect(printed[2]).toBe('Consent of an unnamed account saved in microsoft-ads/oauth.');
    });

    it.each([
      [
        'Microsoft gives no refresh token',
        (): void =>
          void fetchFn.mockImplementation(async (): Promise<Response> => tokenResponse({ access_token: 'a-1' })),
        'no refresh token: offline access refused?',
      ],
      [
        'Microsoft refuses the code',
        (): void =>
          void fetchFn.mockImplementation(async (): Promise<Response> =>
            tokenResponse({ error: 'invalid_grant', error_description: 'AADSTS54005' }, 400)
          ),
        'AADSTS54005',
      ],
      [
        'the store refuses the secret',
        (): void => void secrets.put.mockRejectedValue(new Error('AccessDenied')),
        'AccessDenied',
      ],
    ])(
      'should say so on the page when %s',
      async (_label: string, arrange: () => void, reason: string): Promise<void> => {
        arrange();
        const run: Promise<MicrosoftOAuthSecret> = connectMicrosoftAds(options());
        await consentListening(server, printed);
        const failed: Promise<void> = expect(run).rejects.toThrow(reason);

        const page: Page = await server.hit(`/microsoft/callback?state=${STATE}&code=c`);

        await failed;
        expect(page.status).toBe(502);
        expect(page.text).toContain(reason);
      }
    );

    it('should refuse to start without a usable application', async (): Promise<void> => {
      secrets.get.mockResolvedValue('{"clientId":"app-1"}');

      await expect(connectMicrosoftAds(options())).rejects.toThrow('the application secret has no clientSecret');
      expect(server.listener).toBeNull();
    });

    it("should go through Node's own fetch, randomness and clock when none is given", async (): Promise<void> => {
      const spy: jest.SpyInstance = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(tokenResponse({ access_token: 'a-1', refresh_token: 'r-1' }));
      const run: Promise<MicrosoftOAuthSecret> = connectMicrosoftAds(
        options({ fetchFn: undefined, random: undefined, now: undefined })
      );
      await consentListening(server, printed);

      const state: string = new URL(printed[1]).searchParams.get('state') as string;
      expect(state).toMatch(/^[0-9a-f]{32}$/);
      expect(state).not.toBe(STATE);
      await server.hit(`/microsoft/callback?state=${state}&code=c`);

      await expect(run).resolves.toMatchObject({ refreshToken: 'r-1' });
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });
});
