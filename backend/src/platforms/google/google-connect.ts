/**
 * @module platforms/google/google-connect
 *
 * What `pnpm google:connect` does: keep the OAuth consent of our **inviter**, the human admin of our
 * MCC who sends and withdraws the invitations Google refuses to our service account
 * (`docs/phase-10.md` § 3). Transcribed from multi-search (`src/platforms/google/google-connect.ts`),
 * on `fetch`. The command-line entry point is `src/scripts/google-connect.ts`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { SecretStore } from '@src/services/secret-store.service';
import { GOOGLE_ADS_API, GoogleInviterSecret, GoogleTokenErrorBody, GoogleTokenResponse } from './google.types';

/** Longest wait for the consent, once its page is printed. */
const CONSENT_TIMEOUT_MS = 10 * 60_000;

/** The HTTP server receiving the consent: a `node:http` server, on a port the system chooses. */
export type ConsentServer = {
  listen(port: number, host: string, ready: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  address(): AddressInfo | string | null;
  close(): unknown;
};

/**
 * What `pnpm google:connect` works with.
 *
 * @property secrets - The secret store
 * @property secretName - Where the inviter's credentials live, relative to the store's prefix
 * @property print - Writes a line for the person running the command — never a secret nor a token
 * @property ask - Asks a question without echoing the answer
 * @property createServer - Builds the server receiving the consent
 * @property fetchFn - What sends the exchange of the code
 * @property random - Random bytes, for the state and the PKCE verifier
 * @property timeoutMs - Longest wait for the consent
 */
export type GoogleConnectOptions = {
  secrets: SecretStore;
  secretName: string;
  print: (line: string) => void;
  ask: (question: string) => Promise<string>;
  createServer?: (listener: RequestListener) => ConsentServer;
  fetchFn?: typeof fetch;
  random?: (size: number) => Buffer;
  timeoutMs?: number;
};

/**
 * A PKCE pair (RFC 7636): a random verifier, and its SHA-256 challenge.
 *
 * @param random - Random bytes
 * @returns The verifier kept, and the challenge sent with the consent page
 */
export function pkcePair(random: (size: number) => Buffer): { verifier: string; challenge: string } {
  const verifier: string = random(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/**
 * Google's consent page: our « Desktop app » OAuth client, the `adwords` scope, an offline access — a
 * refresh token, asked again with `prompt=consent` —, a state, a PKCE challenge and the loopback
 * address it comes back to.
 *
 * @param params - Client, redirect URI, state and challenge
 * @param params.clientId - Id of the OAuth client
 * @param params.redirectUri - Where the consent comes back, `http://127.0.0.1:<port>`
 * @param params.state - Random value checked on the way back
 * @param params.challenge - PKCE challenge
 * @returns The URL
 */
export function googleAuthorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: GOOGLE_ADS_API.scope,
    access_type: 'offline',
    prompt: 'consent',
    state: params.state,
    code_challenge: params.challenge,
    code_challenge_method: 'S256',
  });
  return `${GOOGLE_ADS_API.authorizeUrl}?${query.toString()}`;
}

/**
 * The OAuth client already stored with the inviter's secret, so that running the command asks for
 * nothing but the consent. It is there since 2026-11-18 (`docs/runbook-acces.md` B5b).
 *
 * @param secrets - The secret store
 * @param name - Name of the inviter's secret
 * @returns Its client id and secret, each `null` when absent — no secret yet, or not JSON
 */
export async function storedClient(
  secrets: SecretStore,
  name: string
): Promise<{ clientId: string | null; clientSecret: string | null }> {
  try {
    const stored = JSON.parse(await secrets.get(name, { fresh: true })) as Partial<GoogleInviterSecret> | null;
    const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
    return { clientId: text(stored?.clientId), clientSecret: text(stored?.clientSecret) };
  } catch {
    return { clientId: null, clientSecret: null };
  }
}

/**
 * The reason a thrown value gives.
 *
 * @param error - The value
 * @returns Its message
 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Answer the browser with a short page.
 *
 * @param response - The response
 * @param status - HTTP status
 * @param text - The message
 */
function page(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(`${text}\n`);
}

/**
 * Exchange the code of the consent for the inviter's refresh token.
 *
 * @param fetchFn - What sends the exchange
 * @param form - Code, client, redirect URI and PKCE verifier
 * @returns The refresh token
 * @throws Error when Google refuses the code, gives no refresh token, or not the `adwords` scope
 */
async function exchangeCode(fetchFn: typeof fetch, form: Record<string, string>): Promise<string> {
  let response: Response;
  try {
    response = await fetchFn(GOOGLE_ADS_API.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...form, grant_type: 'authorization_code' }).toString(),
      signal: AbortSignal.timeout(GOOGLE_ADS_API.tokenTimeoutMs),
    });
  } catch (error: unknown) {
    throw new Error(`Google could not be reached: ${reasonOf(error)}`, { cause: error });
  }
  const parsed: unknown = await response.json().catch((): unknown => null);
  const body: GoogleTokenResponse & GoogleTokenErrorBody = (parsed ?? {}) as GoogleTokenResponse & GoogleTokenErrorBody;
  if (!response.ok) {
    throw new Error(`Google refused the code: ${body.error_description ?? body.error ?? `HTTP ${response.status}`}`);
  }
  if (!body.refresh_token) throw new Error('Google returned no refresh token: run pnpm google:connect again');
  if (body.scope !== undefined && !body.scope.split(' ').includes(GOOGLE_ADS_API.scope)) {
    throw new Error('The consent does not include Google Ads (adwords): tick it, and run pnpm google:connect again');
  }
  return body.refresh_token;
}

/**
 * `pnpm google:connect`: keep the consent of our inviter.
 *
 * Reads the « Desktop app » OAuth client from the inviter's secret, or asks for it without echo;
 * starts a server on `127.0.0.1`, on a port the system chooses as Google's loopback flow allows;
 * prints the consent page — a state, PKCE, an offline access —; receives the code, checks the state,
 * exchanges the code at once, writes `{ clientId, clientSecret, refreshToken }` to the inviter's
 * secret, answers the browser and stops. **No secret nor token is ever printed.** The person signs in
 * as an admin of our MCC.
 *
 * @param options - Secret store, output, prompt, and what the tests replace
 * @returns The inviter's secret written
 * @throws Error when no client is given, the consent is refused, the state differs, the exchange fails
 *   or nothing comes back in time
 */
export async function connectGoogleAds(options: GoogleConnectOptions): Promise<GoogleInviterSecret> {
  const { secrets, secretName: name, print } = options;
  const random: (size: number) => Buffer = options.random ?? randomBytes;
  const fetchFn: typeof fetch = options.fetchFn ?? fetch;
  const stored = await storedClient(secrets, name);
  const clientId: string = stored.clientId ?? (await options.ask('OAuth client id (Desktop app): ')).trim();
  const clientSecret: string = stored.clientSecret ?? (await options.ask('OAuth client secret: ')).trim();
  if (!clientId || !clientSecret) throw new Error('An OAuth client id and secret are required');
  const state: string = random(16).toString('hex');
  const { verifier, challenge } = pkcePair(random);

  let server: ConsentServer | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    const secret: GoogleInviterSecret = await new Promise<GoogleInviterSecret>((resolve, reject): void => {
      let settled = false;
      let redirectUri = '';
      const settle = (error: Error | null, value?: GoogleInviterSecret): void => {
        settled = true;
        if (error) reject(error);
        else resolve(value as GoogleInviterSecret);
      };
      const exchange = async (code: string, response: ServerResponse): Promise<void> => {
        try {
          const refreshToken: string = await exchangeCode(fetchFn, {
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code_verifier: verifier,
          });
          const value: GoogleInviterSecret = { clientId, clientSecret, refreshToken };
          await secrets.put(name, JSON.stringify(value));
          page(response, 200, 'Omnipotent can now send Google Ads invitations. You can close this tab.');
          settle(null, value);
        } catch (error: unknown) {
          page(response, 502, `The consent could not be saved: ${reasonOf(error)}`);
          settle(error instanceof Error ? error : new Error(reasonOf(error)));
        }
      };
      const listener: RequestListener = (request: IncomingMessage, response: ServerResponse): void => {
        const received = new URL(request.url ?? '/', 'http://127.0.0.1');
        const code: string | null = received.searchParams.get('code');
        const refused: string | null = received.searchParams.get('error');
        if (received.pathname !== '/') {
          page(response, 404, 'Not found');
        } else if (settled) {
          page(response, 410, 'This consent is already over: run pnpm google:connect again.');
        } else if (received.searchParams.get('state') !== state) {
          page(response, 400, 'Unexpected answer: run pnpm google:connect again.');
          settle(new Error('The answer does not carry the state sent with the consent page'));
        } else if (refused || !code) {
          const reason: string = refused ?? 'no code';
          page(response, 400, `Google did not give the consent: ${reason}`);
          settle(new Error(`Google did not give the consent: ${reason}`));
        } else {
          settled = true;
          void exchange(code, response);
        }
      };

      const started: ConsentServer = (options.createServer ?? createServer)(listener);
      server = started;
      started.on('error', (failure: Error): void => settle(failure));
      timer = setTimeout(
        (): void => settle(new Error('No consent came back in time: run pnpm google:connect again')),
        options.timeoutMs ?? CONSENT_TIMEOUT_MS
      );
      timer.unref();
      started.listen(0, '127.0.0.1', (): void => {
        const address: AddressInfo | string | null = started.address();
        if (address === null || typeof address === 'string') {
          settle(new Error('The consent server has no port'));
          return;
        }
        redirectUri = `http://127.0.0.1:${address.port}`;
        print('Google Ads: open this page, and sign in as an admin of our manager account (MCC):');
        print(googleAuthorizationUrl({ clientId, redirectUri, state, challenge }));
      });
    });
    print(`Inviter saved in ${name}. Run pnpm secrets:seed to keep it on AWS too.`);
    return secret;
  } finally {
    clearTimeout(timer);
    server?.close();
  }
}
