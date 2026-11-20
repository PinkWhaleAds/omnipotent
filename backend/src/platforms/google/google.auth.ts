/**
 * @module platforms/google/google.auth
 *
 * The access tokens of **our** credentials (`docs/phase-10.md` § 3), transcribed from multi-search
 * (`src/platforms/google/google.auth.ts`), on `fetch`:
 *
 * - our Google Cloud **service account**, for every call but two;
 * - our **inviter**, a human admin of our MCC, for the two Google refuses a service account: sending
 *   and withdrawing a manager link invitation.
 */
import { createSign } from 'node:crypto';

import { PlatformError } from '@src/platforms/platform-adapter';
import {
  GOOGLE_ADS_API,
  GoogleInviterSecret,
  GoogleServiceAccountKey,
  GoogleTokenErrorBody,
  GoogleTokenResponse,
} from './google.types';

/**
 * Base64url, as JWS writes it: base64 with `-` and `_`, without padding.
 *
 * @param input - Bytes or text
 * @returns The encoding
 */
export function base64Url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * The signed assertion of the service account grant: a JWT signed in RS256.
 *
 * `sub` is not set: the service account is itself a user of our manager account, and impersonates
 * nobody — Google Ads has no domain-wide delegation.
 *
 * @param key - The service account key
 * @param audience - The token endpoint the assertion is addressed to
 * @param nowSeconds - Current time, epoch seconds
 * @returns The JWT
 * @throws Error when the private key cannot sign (a malformed PEM)
 */
export function signedAssertion(key: GoogleServiceAccountKey, audience: string, nowSeconds: number): string {
  const header: Record<string, string> = { alg: 'RS256', typ: 'JWT' };
  if (key.private_key_id) header.kid = key.private_key_id;
  const claims: Record<string, string | number> = {
    iss: key.client_email,
    scope: GOOGLE_ADS_API.scope,
    aud: audience,
    iat: nowSeconds,
    exp: nowSeconds + GOOGLE_ADS_API.assertionLifetimeSeconds,
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const signature: Buffer = createSign('RSA-SHA256').update(signingInput).sign(key.private_key);
  return `${signingInput}.${base64Url(signature)}`;
}

/**
 * The service account key in a secret.
 *
 * A malformed secret fails with a **fixed** message: `JSON.parse`'s own quotes the text, which must
 * never reach an error nor a log.
 *
 * @param json - The JSON key, as downloaded from Google Cloud
 * @returns The key
 * @throws Error when it is not JSON, or not a service account key
 */
export function parseServiceAccountKey(json: string): GoogleServiceAccountKey {
  let key: Partial<GoogleServiceAccountKey> | null;
  try {
    key = JSON.parse(json) as Partial<GoogleServiceAccountKey> | null;
  } catch {
    throw new Error('the secret is not JSON');
  }
  if (typeof key?.client_email !== 'string' || typeof key.private_key !== 'string') {
    throw new Error('the secret is not a service account key (client_email and private_key are required)');
  }
  return key as GoogleServiceAccountKey;
}

/**
 * A failure of **our** credentials: never the client account's fault, so never
 * `invalidCredentials` — that would mark every Google account invalid at once
 * (`docs/phase-10.md` § 4.2).
 *
 * @param message - What went wrong
 * @param statusCode - Status of the token endpoint, `null` without response
 * @param code - The OAuth error (`invalid_grant`…), or ours
 * @returns The error
 */
function credentialsError(message: string, statusCode: number | null, code: string | null): PlatformError {
  return new PlatformError('google_ads', `Google Ads service account authentication failed: ${message}`, {
    statusCode,
    retryable: statusCode === null || statusCode >= 500,
    invalidCredentials: false,
    ownCredentials: true,
    requestId: null,
    code,
  });
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
 * The access tokens of our service account, kept until shortly before they expire.
 *
 * Concurrent callers share one exchange. The key is read from its loader at each exchange — about
 * once an hour — so a rotated key is picked up without a restart.
 */
export class GoogleServiceAccountAuth {
  /** The token kept, `null` before the first exchange or once dropped. */
  private token: string | null = null;

  /** When the token kept must be renewed, epoch milliseconds. */
  private expiresAt = 0;

  /** The exchange under way, shared by whoever asks meanwhile. */
  private pending: Promise<string> | null = null;

  /**
   * @param loadKey - Reads the JSON key, from the secret store
   * @param fetchFn - What sends the exchange; a fake one in the tests
   * @param now - The clock, epoch milliseconds
   */
  constructor(
    private readonly loadKey: () => Promise<string>,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * A valid access token, renewed when the one kept is about to expire.
   *
   * @returns The token
   * @throws PlatformError, always `ownCredentials`, when the key cannot be read or is refused
   */
  public async accessToken(): Promise<string> {
    if (this.token !== null && this.now() < this.expiresAt) return this.token;
    this.pending ??= this.exchange().finally((): void => {
      this.pending = null;
    });
    return this.pending;
  }

  /** Forget the token kept, so that the next call gets a new one: Google refused it. */
  public invalidate(): void {
    this.token = null;
    this.expiresAt = 0;
  }

  /**
   * Sign a new assertion and exchange it for a token.
   *
   * @returns The token
   */
  private async exchange(): Promise<string> {
    let key: GoogleServiceAccountKey;
    let assertion: string;
    try {
      key = parseServiceAccountKey(await this.loadKey());
      assertion = signedAssertion(key, key.token_uri ?? GOOGLE_ADS_API.tokenUrl, Math.floor(this.now() / 1000));
    } catch (error: unknown) {
      throw credentialsError(
        `the service account key cannot be used (${reasonOf(error)})`,
        null,
        'service_account_key'
      );
    }

    let response: Response;
    try {
      response = await this.fetchFn(key.token_uri ?? GOOGLE_ADS_API.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: GOOGLE_ADS_API.grantType, assertion }).toString(),
        signal: AbortSignal.timeout(GOOGLE_ADS_API.tokenTimeoutMs),
      });
    } catch (error: unknown) {
      throw credentialsError(reasonOf(error), null, null);
    }

    const parsed: unknown = await response.json().catch((): unknown => null);
    const body: GoogleTokenResponse & GoogleTokenErrorBody = (parsed ?? {}) as GoogleTokenResponse &
      GoogleTokenErrorBody;
    if (!response.ok) {
      throw credentialsError(
        body.error_description ?? body.error ?? `HTTP ${response.status}`,
        response.status,
        body.error ?? null
      );
    }
    if (!body.access_token) {
      throw credentialsError('the token endpoint returned no access token', response.status, null);
    }
    const lifetime: number = body.expires_in ?? GOOGLE_ADS_API.assertionLifetimeSeconds;
    this.token = body.access_token;
    this.expiresAt = this.now() + Math.max(0, lifetime - GOOGLE_ADS_API.tokenExpirySkewSeconds) * 1000;
    return this.token;
  }
}

/**
 * The inviter's credentials in a secret.
 *
 * @param json - The secret, as `pnpm google:connect` wrote it
 * @returns Its fields
 * @throws Error with a fixed message when it is not JSON or a field is missing
 */
export function parseInviterSecret(json: string): GoogleInviterSecret {
  let secret: Partial<GoogleInviterSecret> | null;
  try {
    secret = JSON.parse(json) as Partial<GoogleInviterSecret> | null;
  } catch {
    throw new Error('the inviter secret is not JSON');
  }
  for (const field of ['clientId', 'clientSecret', 'refreshToken'] as const) {
    if (typeof secret?.[field] !== 'string' || secret[field] === '')
      throw new Error(`the inviter secret has no ${field}`);
  }
  return secret as GoogleInviterSecret;
}

/**
 * A failure of our inviter's credentials: never the client's fault, nor Google's.
 *
 * @param message - What went wrong
 * @param statusCode - Status of the token endpoint, `null` without response
 * @param code - The OAuth error (`invalid_grant`…), or ours
 * @param retryable - Whether trying again later can succeed
 * @returns The error
 */
function inviterCredentialsError(
  message: string,
  statusCode: number | null,
  code: string,
  retryable: boolean
): PlatformError {
  return new PlatformError('google_ads', `Google Ads inviter authentication failed: ${message}`, {
    statusCode,
    retryable,
    invalidCredentials: false,
    ownCredentials: true,
    requestId: null,
    code,
  });
}

/**
 * The access tokens of our inviter: its refresh token, from `pnpm google:connect`, exchanged for an
 * access token kept until shortly before it expires.
 *
 * Google lets only a human admin of the MCC send and withdraw a manager link invitation — a service
 * account gets `INVALID_CHANGE` (multi-search, tested on 2026-10-18). Concurrent callers share one
 * exchange, and the secret is read **fresh** at each exchange, so a new consent is picked up without a
 * restart.
 */
export class GoogleInviterAuth {
  /** The token kept, `null` before the first exchange or once dropped. */
  private token: string | null = null;

  /** When the token kept must be renewed, epoch milliseconds. */
  private expiresAt = 0;

  /** The exchange under way, shared by whoever asks meanwhile. */
  private pending: Promise<string> | null = null;

  /**
   * @param loadSecret - Reads the inviter secret, from the secret store
   * @param fetchFn - What sends the exchange; a fake one in the tests
   * @param now - The clock, epoch milliseconds
   */
  constructor(
    private readonly loadSecret: () => Promise<string>,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * A valid access token of the inviter, renewed when the one kept is about to expire.
   *
   * @returns The token
   * @throws PlatformError, always `ownCredentials`, when the secret cannot be read or Google refuses it
   */
  public async accessToken(): Promise<string> {
    if (this.token !== null && this.now() < this.expiresAt) return this.token;
    this.pending ??= this.exchange().finally((): void => {
      this.pending = null;
    });
    return this.pending;
  }

  /** Forget the token kept, so that the next call gets a new one: Google refused it. */
  public invalidate(): void {
    this.token = null;
    this.expiresAt = 0;
  }

  /**
   * Exchange the refresh token for an access token.
   *
   * @returns The token
   */
  private async exchange(): Promise<string> {
    let secret: GoogleInviterSecret;
    try {
      secret = parseInviterSecret(await this.loadSecret());
    } catch (error: unknown) {
      throw inviterCredentialsError(
        `the inviter secret cannot be used (${reasonOf(error)}): run pnpm google:connect`,
        null,
        'inviter_secret',
        false
      );
    }

    let response: Response;
    try {
      response = await this.fetchFn(GOOGLE_ADS_API.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: secret.clientId,
          client_secret: secret.clientSecret,
          refresh_token: secret.refreshToken,
        }).toString(),
        signal: AbortSignal.timeout(GOOGLE_ADS_API.tokenTimeoutMs),
      });
    } catch (error: unknown) {
      throw inviterCredentialsError(reasonOf(error), null, 'token_endpoint', true);
    }

    const parsed: unknown = await response.json().catch((): unknown => null);
    const body: GoogleTokenResponse & GoogleTokenErrorBody = (parsed ?? {}) as GoogleTokenResponse &
      GoogleTokenErrorBody;
    if (!response.ok) {
      const detail: string = body.error_description ?? body.error ?? `HTTP ${response.status}`;
      if (body.error === 'invalid_grant') {
        // The consent was withdrawn, or the admin's password changed: only a new consent mends it.
        throw inviterCredentialsError(
          `Google refused the inviter's consent (${detail}): run pnpm google:connect`,
          response.status,
          'invalid_grant',
          false
        );
      }
      throw inviterCredentialsError(
        detail,
        response.status,
        body.error ?? 'token_endpoint',
        response.status === 429 || response.status >= 500
      );
    }
    if (!body.access_token) {
      throw inviterCredentialsError(
        'the token endpoint returned no access token',
        response.status,
        'token_endpoint',
        true
      );
    }
    const lifetime: number = body.expires_in ?? GOOGLE_ADS_API.userTokenLifetimeSeconds;
    this.token = body.access_token;
    this.expiresAt = this.now() + Math.max(0, lifetime - GOOGLE_ADS_API.tokenExpirySkewSeconds) * 1000;
    return this.token;
  }
}
