/**
 * @module platforms/microsoft/microsoft.auth
 *
 * The access tokens of **our** Microsoft Advertising service user (`docs/phase-11.md` §§ 2 and 3),
 * transcribed from multi-search (`src/platforms/microsoft/microsoft.auth.ts`), on `fetch`.
 *
 * Microsoft gives a **new refresh token at every renewal**, and several processes may renew at once:
 * they do it under a lock every process shares, and write the new tokens back to the secret store.
 */
import { PlatformError } from '@src/platforms/platform-adapter';
import { Logger, LoggerBuilder } from '@utils';
import {
  MICROSOFT_ADS_API,
  MicrosoftAppSecret,
  MicrosoftOAuthSecret,
  MicrosoftTokenErrorBody,
  MicrosoftTokenResponse,
} from './microsoft.types';

/**
 * Runs some work while holding a lock every process shares: a PostgreSQL advisory lock.
 *
 * @typeParam T - What the work returns
 * @param key - Name of the lock
 * @param work - The work
 * @returns What the work returned, once the lock is released
 */
export type WithLock = <T>(key: string, work: () => Promise<T>) => Promise<T>;

/**
 * Where the credentials of our service user live: the secret store.
 *
 * @property readApp - Reads the application's secret; a cached read is fine, it is static
 * @property readOAuth - Reads the tokens, **never from a cache**: another process may have renewed them
 * @property writeOAuth - Replaces the tokens
 */
export type MicrosoftCredentialsStore = {
  readApp: () => Promise<string>;
  readOAuth: () => Promise<string>;
  writeOAuth: (value: string) => Promise<void>;
};

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
 * A failure of **our** credentials: never the client account's fault, so never `invalidCredentials` —
 * that would mark every Microsoft account invalid at once (`docs/phase-10.md` § 4.2).
 *
 * @param message - What went wrong
 * @param options - Status, retryability and code
 * @param options.statusCode - Status of the token endpoint, `null` without response
 * @param options.retryable - Whether trying again later can succeed
 * @param options.code - The OAuth error (`invalid_grant`…), or ours
 * @returns The error
 */
export function credentialsError(
  message: string,
  options: { statusCode: number | null; retryable: boolean; code: string }
): PlatformError {
  return new PlatformError('microsoft', message, {
    statusCode: options.statusCode,
    retryable: options.retryable,
    invalidCredentials: false,
    ownCredentials: true,
    requestId: null,
    code: options.code,
  });
}

/**
 * Read a JSON secret with a **fixed** message on failure: `JSON.parse`'s own quotes the text, which must
 * never reach an error nor a log.
 *
 * @param json - The secret
 * @param what - Which secret, for the message
 * @returns Its value
 * @throws Error when it is not JSON
 */
function parseJson(json: string, what: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw new Error(`the ${what} secret is not JSON`);
  }
}

/**
 * The application's secret.
 *
 * @param json - The secret, as stored
 * @returns Its fields
 * @throws Error when it is not JSON or a field is missing
 */
export function parseAppSecret(json: string): MicrosoftAppSecret {
  const secret = parseJson(json, 'application') as Partial<MicrosoftAppSecret> | null;
  for (const field of ['clientId', 'clientSecret', 'developerToken'] as const) {
    if (typeof secret?.[field] !== 'string' || secret[field] === '') {
      throw new Error(`the application secret has no ${field}`);
    }
  }
  return secret as MicrosoftAppSecret;
}

/**
 * The tokens' secret.
 *
 * @param json - The secret, as stored
 * @returns Its fields
 * @throws Error when it is not JSON or holds no refresh token
 */
export function parseOAuthSecret(json: string): MicrosoftOAuthSecret {
  const secret = parseJson(json, 'tokens') as Partial<MicrosoftOAuthSecret> | null;
  if (typeof secret?.refreshToken !== 'string' || secret.refreshToken === '') {
    throw new Error('the tokens secret has no refresh token');
  }
  return secret as MicrosoftOAuthSecret;
}

/**
 * Call the token endpoint of the Microsoft identity platform.
 *
 * @param fetchFn - What sends the request
 * @param form - Grant, client, code or refresh token, scope
 * @returns The tokens; an access token is always there
 * @throws PlatformError, always `ownCredentials`: `invalid_grant` asks for a new consent and is not
 *   retryable; no answer, a 429 or a 5xx is
 */
export async function requestTokens(
  fetchFn: typeof fetch,
  form: Record<string, string>
): Promise<MicrosoftTokenResponse & { access_token: string }> {
  let response: Response;
  try {
    response = await fetchFn(MICROSOFT_ADS_API.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(MICROSOFT_ADS_API.tokenTimeoutMs),
    });
  } catch (error: unknown) {
    throw credentialsError(`Microsoft Advertising authentication failed: ${reasonOf(error)}`, {
      statusCode: null,
      retryable: true,
      code: 'token_endpoint',
    });
  }
  const parsed: unknown = await response.json().catch((): unknown => null);
  const body: MicrosoftTokenResponse & MicrosoftTokenErrorBody = (parsed ?? {}) as MicrosoftTokenResponse &
    MicrosoftTokenErrorBody;
  if (!response.ok) {
    const detail: string = body.error_description ?? body.error ?? `HTTP ${response.status}`;
    if (body.error === 'invalid_grant') {
      throw credentialsError(
        `Microsoft Advertising refused the consent of our service user (${detail}): run pnpm microsoft:connect`,
        { statusCode: response.status, retryable: false, code: 'invalid_grant' }
      );
    }
    throw credentialsError(`Microsoft Advertising authentication failed: ${detail}`, {
      statusCode: response.status,
      retryable: response.status === 429 || response.status >= 500,
      code: body.error ?? 'token_endpoint',
    });
  }
  if (!body.access_token) {
    throw credentialsError('The Microsoft token endpoint returned no access token', {
      statusCode: response.status,
      retryable: true,
      code: 'token_endpoint',
    });
  }
  return body as MicrosoftTokenResponse & { access_token: string };
}

/**
 * The tokens' secret after an exchange.
 *
 * @param response - The answer of the token endpoint
 * @param previous - The secret before, whose refresh token stays when no new one came back
 * @param now - Current time, epoch milliseconds
 * @returns The new secret
 */
export function tokenSecret(
  response: MicrosoftTokenResponse & { access_token: string },
  previous: Pick<MicrosoftOAuthSecret, 'refreshToken' | 'userEmail'>,
  now: number
): MicrosoftOAuthSecret {
  return {
    refreshToken: response.refresh_token || previous.refreshToken,
    accessToken: response.access_token,
    accessTokenExpiresAt: new Date(now + (response.expires_in ?? 3600) * 1000).toISOString(),
    refreshedAt: new Date(now).toISOString(),
    userEmail: previous.userEmail ?? null,
  };
}

/**
 * An access token kept in memory.
 *
 * @property value - The token
 * @property expiresAt - When it expires, epoch milliseconds
 * @property refreshedAt - When the tokens were last exchanged, epoch milliseconds
 */
type KeptToken = { value: string; expiresAt: number; refreshedAt: number };

/**
 * The OAuth tokens of our service user, given once per environment by `pnpm microsoft:connect` and
 * renewed here.
 *
 * - the access token is kept in memory until five minutes before it expires, and concurrent callers
 *   of one process share one exchange;
 * - otherwise the tokens' secret is read again, without cache: another process may have renewed it;
 * - otherwise, **under the lock** every process shares, the secret is read once more, its refresh token
 *   exchanged, and the new tokens written back;
 * - a renewal is forced when the last one is more than seven days old: a refresh token unused for
 *   ninety days dies;
 * - a token Microsoft refuses is dropped ({@link MicrosoftOAuthTokens.invalidate}) and never taken from
 *   the secret again.
 *
 * Microsoft does not revoke the old refresh token, so a write that fails loses nothing: the next
 * renewal uses the one read.
 */
export class MicrosoftOAuthTokens {
  /** Where a write that failed is told. */
  private readonly logger: Logger = LoggerBuilder.getChildLogger('MicrosoftOAuthTokens');

  /** The access token kept in memory. */
  private token: KeptToken | null = null;

  /** An access token Microsoft refused, never taken from the secret again. */
  private rejected: string | null = null;

  /** The exchange under way, shared by whoever asks meanwhile. */
  private pending: Promise<string> | null = null;

  /**
   * @param store - Where the secrets live
   * @param withLock - The lock every process shares
   * @param fetchFn - What sends the exchanges
   * @param now - The clock, epoch milliseconds
   */
  constructor(
    private readonly store: MicrosoftCredentialsStore,
    private readonly withLock: WithLock,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * A valid access token of our service user.
   *
   * @returns The token
   * @throws PlatformError, always `ownCredentials`
   */
  public async accessToken(): Promise<string> {
    if (this.token !== null && this.fresh(this.token.expiresAt, this.token.refreshedAt)) return this.token.value;
    this.pending ??= this.obtain().finally((): void => {
      this.pending = null;
    });
    return this.pending;
  }

  /**
   * Our developer token.
   *
   * @returns The token
   * @throws PlatformError, always `ownCredentials`
   */
  public async developerToken(): Promise<string> {
    return (await this.app()).developerToken;
  }

  /** Forget the access token kept, which Microsoft refused: the next call gets a new one. */
  public invalidate(): void {
    if (this.token) this.rejected = this.token.value;
    this.token = null;
  }

  /**
   * A token from the secret when another process renewed it, else a new one under the lock.
   *
   * @returns The token
   */
  private async obtain(): Promise<string> {
    const current: MicrosoftOAuthSecret = await this.oauth();
    if (this.usable(current)) return this.keep(current);
    return this.withLock(MICROSOFT_ADS_API.refreshLockKey, async (): Promise<string> => {
      const latest: MicrosoftOAuthSecret = await this.oauth();
      if (this.usable(latest)) return this.keep(latest);
      const app: MicrosoftAppSecret = await this.app();
      const response = await requestTokens(this.fetchFn, {
        client_id: app.clientId,
        client_secret: app.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: latest.refreshToken,
        scope: MICROSOFT_ADS_API.scope,
      });
      const secret: MicrosoftOAuthSecret = tokenSecret(response, latest, this.now());
      try {
        await this.store.writeOAuth(JSON.stringify(secret));
      } catch (error: unknown) {
        this.logger.warn('The new Microsoft Advertising tokens could not be saved', { error: reasonOf(error) });
      }
      return this.keep(secret);
    });
  }

  /**
   * Whether a secret holds an access token to use: not refused, valid for more than five minutes, and
   * exchanged less than seven days ago.
   *
   * @param secret - The tokens' secret
   * @returns `true` to use its access token
   */
  private usable(secret: MicrosoftOAuthSecret): boolean {
    return (
      typeof secret.accessToken === 'string' &&
      secret.accessToken !== '' &&
      secret.accessToken !== this.rejected &&
      this.fresh(Date.parse(secret.accessTokenExpiresAt ?? ''), Date.parse(secret.refreshedAt))
    );
  }

  /**
   * Whether a token can still serve.
   *
   * @param expiresAt - When it expires, epoch milliseconds; `NaN` when unknown
   * @param refreshedAt - When the tokens were exchanged, epoch milliseconds; `NaN` when unknown
   * @returns `true` until five minutes before it expires, unless the exchange is seven days old
   */
  private fresh(expiresAt: number, refreshedAt: number): boolean {
    const now: number = this.now();
    return (
      expiresAt - MICROSOFT_ADS_API.tokenExpirySkewMs > now && now - refreshedAt < MICROSOFT_ADS_API.maxRefreshAgeMs
    );
  }

  /**
   * Keep the access token of a secret in memory.
   *
   * @param secret - The tokens' secret, its access token set
   * @returns The access token
   */
  private keep(secret: MicrosoftOAuthSecret): string {
    const value: string = secret.accessToken as string;
    this.token = {
      value,
      expiresAt: Date.parse(secret.accessTokenExpiresAt as string),
      refreshedAt: Date.parse(secret.refreshedAt),
    };
    return value;
  }

  /**
   * The tokens' secret, read without cache.
   *
   * @returns It
   */
  private async oauth(): Promise<MicrosoftOAuthSecret> {
    return this.read(this.store.readOAuth, parseOAuthSecret, 'tokens', 'run pnpm microsoft:connect');
  }

  /**
   * The application's secret.
   *
   * @returns It
   */
  private async app(): Promise<MicrosoftAppSecret> {
    return this.read(
      this.store.readApp,
      parseAppSecret,
      'application',
      'it holds clientId, clientSecret, developerToken'
    );
  }

  /**
   * Read and parse a secret.
   *
   * @typeParam T - Its shape
   * @param load - Reads it
   * @param parse - Parses it
   * @param what - Which secret, for the message
   * @param fix - How to mend a malformed one, for the message
   * @returns It
   * @throws PlatformError: retryable when it cannot be read, not when it is malformed
   */
  private async read<T>(
    load: () => Promise<string>,
    parse: (json: string) => T,
    what: string,
    fix: string
  ): Promise<T> {
    let json: string;
    try {
      json = await load();
    } catch (error: unknown) {
      throw credentialsError(`The Microsoft Advertising ${what} secret cannot be read: ${reasonOf(error)}`, {
        statusCode: null,
        retryable: true,
        code: 'secret_unreadable',
      });
    }
    try {
      return parse(json);
    } catch (error: unknown) {
      throw credentialsError(`The Microsoft Advertising ${what} secret is malformed (${reasonOf(error)}): ${fix}`, {
        statusCode: null,
        retryable: false,
        code: 'secret_malformed',
      });
    }
  }
}
