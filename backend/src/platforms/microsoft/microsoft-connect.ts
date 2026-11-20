/**
 * @module platforms/microsoft/microsoft-connect
 *
 * What `pnpm microsoft:connect` does: keep the OAuth consent of our **service user**, the dedicated
 * Microsoft account, Super Admin of our manager account, through which Omnipotent acts on every client
 * account (`docs/phase-11.md` § 3). Transcribed from multi-search
 * (`src/platforms/microsoft/microsoft-connect.ts`), on `fetch`; the local server is the one every
 * consent shares (`../consent.ts`). The command-line entry point is `src/scripts/microsoft-connect.ts`.
 */
import { randomBytes } from 'node:crypto';
import type { RequestListener } from 'node:http';

import type { MicrosoftAdsConfig } from '@configs/microsoft-ads.config';
import type { SecretStore } from '@src/services/secret-store.service';
import { awaitConsent, ConsentServer, pkcePair } from '../consent';
import { parseAppSecret, requestTokens, tokenSecret } from './microsoft.auth';
import { MICROSOFT_ADS_API, MicrosoftAppSecret, MicrosoftOAuthSecret } from './microsoft.types';

/**
 * What `pnpm microsoft:connect` works with.
 *
 * @property config - The names of the two secrets, and where the consent comes back
 * @property secrets - The secret store
 * @property print - Writes a line for the person running the command — never a secret nor a token
 * @property createServer - Builds the server receiving the consent
 * @property fetchFn - What sends the exchange of the code
 * @property random - Random bytes, for the state and the PKCE verifier
 * @property now - The clock, epoch milliseconds
 * @property timeoutMs - Longest wait for the consent
 */
export type MicrosoftConnectOptions = {
  config: Pick<MicrosoftAdsConfig, 'appSecret' | 'oauthSecret' | 'redirectUri'>;
  secrets: SecretStore;
  print: (line: string) => void;
  createServer?: (listener: RequestListener) => ConsentServer;
  fetchFn?: typeof fetch;
  random?: (size: number) => Buffer;
  now?: () => number;
  timeoutMs?: number;
};

/**
 * The consent page of the Microsoft identity platform: our Entra application, the scope of the API
 * with an offline access, a state, a PKCE challenge, and the choice of the account to sign in with.
 *
 * @param params - Application, redirect URI, state and challenge
 * @param params.clientId - Id of the Entra application
 * @param params.redirectUri - Where the consent comes back
 * @param params.state - Random value checked on the way back
 * @param params.challenge - PKCE challenge
 * @returns The URL
 */
export function microsoftAuthorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    response_type: 'code',
    response_mode: 'query',
    redirect_uri: params.redirectUri,
    scope: `openid profile ${MICROSOFT_ADS_API.scope}`,
    state: params.state,
    code_challenge: params.challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${MICROSOFT_ADS_API.authorizeUrl}?${query.toString()}`;
}

/**
 * The account an ID token names, for display — its signature does not matter here: it came straight
 * from the token endpoint.
 *
 * @param idToken - The ID token, when Microsoft gave one
 * @returns `preferred_username` or `email`, or `null`
 */
export function accountOfIdToken(idToken: string | undefined): string | null {
  try {
    const payload = JSON.parse(Buffer.from((idToken ?? '').split('.')[1] ?? '', 'base64url').toString()) as {
      preferred_username?: unknown;
      email?: unknown;
    };
    const name: unknown = payload.preferred_username ?? payload.email;
    return typeof name === 'string' && name !== '' ? name : null;
  } catch {
    return null;
  }
}

/**
 * `pnpm microsoft:connect`: keep the consent of our service user, once per environment, and again
 * whenever Microsoft refuses its refresh token.
 *
 * Reads our Entra application from its secret; waits on the loopback, on the port of the redirect
 * address declared in Entra, for the consent page it prints — `prompt=select_account`, a state, PKCE
 * —; exchanges the code at once (it lives about five minutes), and writes the tokens to their secret.
 * **No token is ever printed**: only the account that consented, so that the person checks it is the
 * service user.
 *
 * @param options - Configuration, secret store, output, and what the tests replace
 * @returns The tokens' secret written
 * @throws Error when the application's secret is unusable, the consent is refused, the state differs,
 *   the exchange fails or nothing comes back in time
 */
export async function connectMicrosoftAds(options: MicrosoftConnectOptions): Promise<MicrosoftOAuthSecret> {
  const { config, secrets, print } = options;
  const now: () => number = options.now ?? Date.now;
  const random: (size: number) => Buffer = options.random ?? randomBytes;
  const fetchFn: typeof fetch = options.fetchFn ?? fetch;
  const app: MicrosoftAppSecret = parseAppSecret(await secrets.get(config.appSecret, { fresh: true }));
  const redirect = new URL(config.redirectUri);
  const state: string = random(16).toString('hex');
  const { verifier, challenge } = pkcePair(random);

  const secret: MicrosoftOAuthSecret = await awaitConsent<MicrosoftOAuthSecret>({
    platform: 'Microsoft',
    command: 'pnpm microsoft:connect',
    host: '127.0.0.1',
    port: Number(redirect.port),
    path: redirect.pathname,
    state,
    instructions: 'Microsoft Advertising: open this page, and sign in as our service user:',
    ready: (): string =>
      microsoftAuthorizationUrl({ clientId: app.clientId, redirectUri: config.redirectUri, state, challenge }),
    exchange: async (code: string): Promise<MicrosoftOAuthSecret> => {
      const tokens = await requestTokens(fetchFn, {
        client_id: app.clientId,
        client_secret: app.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        code_verifier: verifier,
        scope: MICROSOFT_ADS_API.scope,
      });
      if (!tokens.refresh_token) throw new Error('Microsoft returned no refresh token: offline access refused?');
      const value: MicrosoftOAuthSecret = tokenSecret(
        tokens,
        { refreshToken: tokens.refresh_token, userEmail: accountOfIdToken(tokens.id_token) },
        now()
      );
      await secrets.put(config.oauthSecret, JSON.stringify(value));
      return value;
    },
    done: 'Omnipotent can now manage Microsoft Advertising. You can close this tab.',
    print,
    createServer: options.createServer,
    timeoutMs: options.timeoutMs,
  });
  print(`Consent of ${secret.userEmail ?? 'an unnamed account'} saved in ${config.oauthSecret}.`);
  print('Run pnpm secrets:seed to keep it on AWS too.');
  return secret;
}
