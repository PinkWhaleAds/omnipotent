/**
 * @module platforms/google/google.auth
 *
 * The access tokens of **our** Google Cloud service account: one token for every account under our
 * manager account (`docs/phase-10.md` § 3). Transcribed from multi-search
 * (`src/platforms/google/google.auth.ts`), on `fetch`.
 */
import { createSign } from 'node:crypto';

import { PlatformError } from '@src/platforms/platform-adapter';
import { GOOGLE_ADS_API, GoogleServiceAccountKey, GoogleTokenErrorBody, GoogleTokenResponse } from './google.types';

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
