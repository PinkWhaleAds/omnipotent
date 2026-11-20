/**
 * @module platforms/google/google-connect
 *
 * What `pnpm google:connect` does: keep the OAuth consent of our **inviter**, the human admin of our
 * MCC who sends and withdraws the invitations Google refuses to our service account
 * (`docs/phase-10.md` § 3). Transcribed from multi-search (`src/platforms/google/google-connect.ts`),
 * on `fetch`; the local server is the one every consent shares (`../consent.ts`). The command-line
 * entry point is `src/scripts/google-connect.ts`.
 */
import { randomBytes } from 'node:crypto';
import type { RequestListener } from 'node:http';

import type { SecretStore } from '@src/services/secret-store.service';
import { awaitConsent, ConsentServer, pkcePair, reasonOf } from '../consent';
import { GOOGLE_ADS_API, GoogleInviterSecret, GoogleTokenErrorBody, GoogleTokenResponse } from './google.types';

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
 * waits on `127.0.0.1`, on a port the system chooses as Google's loopback flow allows, for the consent
 * page it prints — a state, PKCE, an offline access —; exchanges the code at once, and writes
 * `{ clientId, clientSecret, refreshToken }` to the inviter's secret. **No secret nor token is ever
 * printed.** The person signs in as an admin of our MCC.
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

  let redirectUri = '';
  const secret: GoogleInviterSecret = await awaitConsent<GoogleInviterSecret>({
    platform: 'Google',
    command: 'pnpm google:connect',
    host: '127.0.0.1',
    port: 0,
    path: '/',
    state,
    instructions: 'Google Ads: open this page, and sign in as an admin of our manager account (MCC):',
    ready: (port: number): string => {
      redirectUri = `http://127.0.0.1:${port}`;
      return googleAuthorizationUrl({ clientId, redirectUri, state, challenge });
    },
    exchange: async (code: string): Promise<GoogleInviterSecret> => {
      const refreshToken: string = await exchangeCode(fetchFn, {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      });
      const value: GoogleInviterSecret = { clientId, clientSecret, refreshToken };
      await secrets.put(name, JSON.stringify(value));
      return value;
    },
    done: 'Omnipotent can now send Google Ads invitations. You can close this tab.',
    print,
    createServer: options.createServer,
    timeoutMs: options.timeoutMs,
  });
  print(`Inviter saved in ${name}. Run pnpm secrets:seed to keep it on AWS too.`);
  return secret;
}
