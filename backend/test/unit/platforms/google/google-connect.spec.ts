import { createHash } from 'node:crypto';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  connectGoogleAds,
  ConsentServer,
  GoogleConnectOptions,
  googleAuthorizationUrl,
  pkcePair,
  storedClient,
} from '@src/platforms/google/google-connect';
import { GOOGLE_ADS_API } from '@src/platforms/google/google.types';

/** Random bytes the specs can predict. */
const random = (size: number): Buffer => Buffer.alloc(size, 1);

/** The state the command sends with the consent page, from those bytes. */
const STATE: string = Buffer.alloc(16, 1).toString('hex');

/** The OAuth client stored with the inviter's secret since 2026-11-18. */
const CLIENT_JSON: string = JSON.stringify({ clientId: 'c-1', clientSecret: 's-1' });

/** What the browser receives from the consent server. */
type Page = { status: number; text: string };

/**
 * A consent server that listens nowhere: the specs hand it the browser's requests.
 */
class FakeServer implements ConsentServer {
  /** What `node:http` would call on each request. */
  public listener: RequestListener | null = null;

  /** What the command does on a failure of the server. */
  public onError: ((error: Error) => void) | null = null;

  /** Whether the command closed it. */
  public closed = false;

  /**
   * @param port - What `address()` answers: a port, a pipe name, or nothing
   */
  constructor(private readonly port: number | string | null = 5555) {}

  /** @inheritdoc */
  public listen(_port: number, _host: string, ready: () => void): void {
    ready();
  }

  /** @inheritdoc */
  public on(_event: 'error', listener: (error: Error) => void): void {
    this.onError = listener;
  }

  /** @inheritdoc */
  public address(): AddressInfo | string | null {
    if (this.port === null || typeof this.port === 'string') return this.port;
    return { port: this.port, address: '127.0.0.1', family: 'IPv4' };
  }

  /** @inheritdoc */
  public close(): void {
    this.closed = true;
  }

  /**
   * Send a request of the browser.
   *
   * @param url - Its path and query, `undefined` for a request that carries none
   * @returns What the page will say, once written
   */
  public hit(url: string | undefined): Promise<Page> {
    return new Promise<Page>((resolve): void => {
      let status = 0;
      const response = {
        writeHead: (code: number): void => {
          status = code;
        },
        end: (text: string): void => resolve({ status, text }),
      };
      (this.listener as RequestListener)({ url } as IncomingMessage, response as unknown as ServerResponse);
    });
  }
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

describe('Unit::Platforms::Google::Connect', () => {
  let server: FakeServer;
  let secrets: { get: jest.Mock; put: jest.Mock };
  let fetchFn: jest.Mock;
  let printed: string[];
  let ask: jest.Mock;

  /**
   * The options of a run, with the fakes of the spec.
   *
   * @param overrides - What to change
   * @returns The options
   */
  function options(overrides: Partial<GoogleConnectOptions> = {}): GoogleConnectOptions {
    return {
      secrets: secrets as never,
      secretName: 'google-ads/inviter',
      print: (line: string): void => void printed.push(line),
      ask,
      createServer: (listener: RequestListener): ConsentServer => {
        server.listener = listener;
        return server;
      },
      fetchFn: fetchFn as unknown as typeof fetch,
      random,
      ...overrides,
    };
  }

  beforeEach((): void => {
    server = new FakeServer();
    secrets = { get: jest.fn().mockResolvedValue(CLIENT_JSON), put: jest.fn().mockResolvedValue(undefined) };
    fetchFn = jest.fn(async (): Promise<Response> =>
      tokenResponse({ refresh_token: 'r-new', scope: GOOGLE_ADS_API.scope })
    );
    printed = [];
    ask = jest.fn();
  });

  describe('pkcePair', () => {
    it('should derive the challenge from the verifier, as RFC 7636 says', (): void => {
      const { verifier, challenge } = pkcePair(random);

      expect(verifier).toBe(Buffer.alloc(32, 1).toString('base64url'));
      expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    });
  });

  describe('googleAuthorizationUrl', () => {
    it('should ask for an offline access to Google Ads, with a state and a PKCE challenge', (): void => {
      const url = new URL(
        googleAuthorizationUrl({ clientId: 'c-1', redirectUri: 'http://127.0.0.1:5555', state: 'st', challenge: 'ch' })
      );

      expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_ADS_API.authorizeUrl);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        client_id: 'c-1',
        redirect_uri: 'http://127.0.0.1:5555',
        response_type: 'code',
        scope: GOOGLE_ADS_API.scope,
        access_type: 'offline',
        prompt: 'consent',
        state: 'st',
        code_challenge: 'ch',
        code_challenge_method: 'S256',
      });
    });
  });

  describe('storedClient', () => {
    it('should read the OAuth client stored with the secret, fresh', async (): Promise<void> => {
      await expect(storedClient(secrets as never, 'google-ads/inviter')).resolves.toEqual({
        clientId: 'c-1',
        clientSecret: 's-1',
      });
      expect(secrets.get).toHaveBeenCalledWith('google-ads/inviter', { fresh: true });
    });

    it.each([
      ['no secret yet', (): void => void secrets.get.mockRejectedValue(new Error('not found'))],
      ['a secret that is not JSON', (): void => void secrets.get.mockResolvedValue('oops')],
      ['a JSON null', (): void => void secrets.get.mockResolvedValue('null')],
      ['fields that are not text', (): void => void secrets.get.mockResolvedValue('{"clientId":1,"clientSecret":""}')],
    ])('should find no client in %s', async (_label: string, arrange: () => void): Promise<void> => {
      arrange();

      await expect(storedClient(secrets as never, 'google-ads/inviter')).resolves.toEqual({
        clientId: null,
        clientSecret: null,
      });
    });
  });

  describe('connectGoogleAds', () => {
    it('should keep the consent of our inviter, and say so without printing a secret', async (): Promise<void> => {
      const run: Promise<unknown> = connectGoogleAds(options());

      const consentUrl = new URL(printed[1]);
      expect(consentUrl.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5555');
      expect(consentUrl.searchParams.get('state')).toBe(STATE);
      const page: Page = await server.hit(`/?state=${STATE}&code=the-code`);

      await expect(run).resolves.toEqual({ clientId: 'c-1', clientSecret: 's-1', refreshToken: 'r-new' });
      expect(page.status).toBe(200);
      expect(secrets.put).toHaveBeenCalledWith(
        'google-ads/inviter',
        JSON.stringify({ clientId: 'c-1', clientSecret: 's-1', refreshToken: 'r-new' })
      );
      const form = Object.fromEntries(
        new URLSearchParams((fetchFn.mock.calls[0] as [string, RequestInit])[1].body as string)
      );
      expect(form).toEqual({
        code: 'the-code',
        client_id: 'c-1',
        client_secret: 's-1',
        redirect_uri: 'http://127.0.0.1:5555',
        code_verifier: pkcePair(random).verifier,
        grant_type: 'authorization_code',
      });
      expect(printed.join('\n')).not.toMatch(/s-1|r-new/);
      expect(server.closed).toBe(true);
    });

    it('should ask for the OAuth client when none is stored, and refuse to go on without one', async (): Promise<void> => {
      secrets.get.mockRejectedValue(new Error('not found'));
      ask.mockResolvedValueOnce(' c-2 ').mockResolvedValueOnce(' ');

      await expect(connectGoogleAds(options())).rejects.toThrow('An OAuth client id and secret are required');
      expect(ask).toHaveBeenCalledTimes(2);
    });

    it('should use the OAuth client typed, and a consent that names no scope', async (): Promise<void> => {
      secrets.get.mockRejectedValue(new Error('not found'));
      ask.mockResolvedValueOnce(' c-2 ').mockResolvedValueOnce(' s-2 ');
      fetchFn.mockImplementation(async (): Promise<Response> => tokenResponse({ refresh_token: 'r-2' }));
      const run: Promise<unknown> = connectGoogleAds(options());

      await server.hit(`/?state=${STATE}&code=c`);

      await expect(run).resolves.toEqual({ clientId: 'c-2', clientSecret: 's-2', refreshToken: 'r-2' });
    });

    it.each([
      ['an answer that carries another state', '/?state=other&code=c', 'does not carry the state'],
      ['a refusal of the consent', `/?state=${STATE}&error=access_denied`, 'access_denied'],
      ['an answer without a code', `/?state=${STATE}`, 'no code'],
      ['a request without an address', undefined, 'does not carry the state'],
    ])('should stop on %s', async (_label: string, url: string | undefined, reason: string): Promise<void> => {
      const run: Promise<unknown> = connectGoogleAds(options());
      const failed: Promise<void> = expect(run).rejects.toThrow(reason);

      const page: Page = await server.hit(url);

      await failed;
      expect(page.status).toBe(400);
      expect(secrets.put).not.toHaveBeenCalled();
    });

    it('should answer 404 to anything but its own page, and 410 once the consent is over', async (): Promise<void> => {
      const run: Promise<unknown> = connectGoogleAds(options());

      await expect(server.hit('/favicon.ico')).resolves.toMatchObject({ status: 404 });
      await server.hit(`/?state=${STATE}&code=c`);
      await run;

      await expect(server.hit(`/?state=${STATE}&code=c`)).resolves.toMatchObject({ status: 410 });
    });

    it.each([
      [
        'Google cannot be reached',
        (): void => void fetchFn.mockRejectedValue(new TypeError('fetch failed')),
        'could not be reached',
      ],
      [
        'Google refuses the code',
        (): void =>
          void fetchFn.mockImplementation(async (): Promise<Response> =>
            tokenResponse({ error: 'invalid_grant', error_description: 'Bad Request' }, 400)
          ),
        'Google refused the code: Bad Request',
      ],
      [
        'Google refuses it without description',
        (): void =>
          void fetchFn.mockImplementation(async (): Promise<Response> =>
            tokenResponse({ error: 'invalid_client' }, 401)
          ),
        'Google refused the code: invalid_client',
      ],
      [
        'Google refuses it without a word',
        (): void => void fetchFn.mockImplementation(async (): Promise<Response> => tokenResponse('oops', 500)),
        'Google refused the code: HTTP 500',
      ],
      [
        'Google gives no refresh token',
        (): void =>
          void fetchFn.mockImplementation(async (): Promise<Response> => tokenResponse({ access_token: 'a' })),
        'no refresh token',
      ],
      [
        'the consent leaves Google Ads out',
        (): void =>
          void fetchFn.mockImplementation(async (): Promise<Response> =>
            tokenResponse({ refresh_token: 'r', scope: 'openid email' })
          ),
        'does not include Google Ads',
      ],
      ['the store refuses the secret', (): void => void secrets.put.mockRejectedValue('denied'), 'denied'],
    ])(
      'should say so on the page when %s',
      async (_label: string, arrange: () => void, reason: string): Promise<void> => {
        arrange();
        const run: Promise<unknown> = connectGoogleAds(options());
        const failed: Promise<void> = expect(run).rejects.toThrow(reason);

        const page: Page = await server.hit(`/?state=${STATE}&code=c`);

        await failed;
        expect(page.status).toBe(502);
        expect(page.text).toContain(reason);
      }
    );

    it('should stop when the server fails', async (): Promise<void> => {
      const run: Promise<unknown> = connectGoogleAds(options());

      (server.onError as (error: Error) => void)(new Error('EADDRINUSE'));

      await expect(run).rejects.toThrow('EADDRINUSE');
      expect(server.closed).toBe(true);
    });

    it('should stop when no consent comes back in time', async (): Promise<void> => {
      await expect(connectGoogleAds(options({ timeoutMs: 5 }))).rejects.toThrow('No consent came back in time');
    });

    it.each([
      ['no address', null],
      ['a pipe for an address', '/tmp/pipe'],
    ])('should stop when the server has %s', async (_label: string, port: string | null): Promise<void> => {
      server = new FakeServer(port);

      await expect(connectGoogleAds(options())).rejects.toThrow('The consent server has no port');
    });

    it("should listen for real on the loopback, with Node's own server and randomness", async (): Promise<void> => {
      const run: Promise<unknown> = connectGoogleAds({
        secrets: secrets as never,
        secretName: 'google-ads/inviter',
        print: (line: string): void => void printed.push(line),
        ask,
      });
      const failed: Promise<void> = expect(run).rejects.toThrow('does not carry the state');
      await new Promise<void>((resolve): void => {
        const wait = (): void => void (printed.length >= 2 ? resolve() : setTimeout(wait, 5));
        wait();
      });

      const redirect: string = new URL(printed[1]).searchParams.get('redirect_uri') as string;
      const answer: Response = await fetch(`${redirect}/?state=nope&code=c`);

      expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(answer.status).toBe(400);
      await failed;
    });
  });
});
