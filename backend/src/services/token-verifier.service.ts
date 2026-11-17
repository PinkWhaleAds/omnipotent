import { createPublicKey, KeyObject } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import jwt, { Jwt, JwtPayload } from 'jsonwebtoken';

import { authConfig } from '@configs';
import { AccessTokenClaims } from '@src/types/auth.types';
import { httpError, LoggerBuilder, Logger } from '@utils';

/** The only signing algorithm accepted: Auth0 signs access tokens with RS256. */
const ALGORITHM = 'RS256';

/** Clock skew tolerated between Auth0 and this server, in seconds. */
const CLOCK_TOLERANCE_IN_SECONDS = 5;

/**
 * Minimum delay between two refreshes forced by an unknown key id.
 *
 * Without it, a flood of tokens carrying random `kid` values would turn into a
 * flood of requests to the tenant's JWKS endpoint.
 */
const MIN_FORCED_REFRESH_INTERVAL_IN_MS = 30000;

/** Message of every 401: never say which check failed. */
const INVALID_TOKEN_MESSAGE = 'Invalid or expired access token';

/** A JSON Web Key as published in a JWKS document. */
type Jwk = {
  kid?: string;
  kty?: string;
  use?: string;
  [member: string]: unknown;
};

/**
 * Options of a {@link TokenVerifier}.
 *
 * @property domain - Auth0 tenant domain; the issuer is `https://<domain>/`
 * @property jwksCacheTtl - Milliseconds the public keys are reused before being fetched again
 * @property fetchFn - HTTP client, injectable for tests
 * @property now - Clock, injectable for tests
 */
export type TokenVerifierOptions = {
  domain: string;
  jwksCacheTtl: number;
  fetchFn?: typeof fetch;
  now?: () => number;
};

/**
 * Verifies Auth0 access tokens locally.
 *
 * The tenant's public keys (JWKS) are fetched once and cached, so verifying a
 * token costs no call to Auth0. A token signed with a key id this cache does not
 * know triggers one refresh (key rotation), at most every
 * {@link MIN_FORCED_REFRESH_INTERVAL_IN_MS}.
 *
 * @example
 * ```typescript
 * const verifier: TokenVerifier = new TokenVerifier({ domain: 'tenant.eu.auth0.com', jwksCacheTtl: 600000 });
 * const claims: AccessTokenClaims = await verifier.verify(token, 'https://api.pinkwhale.app');
 * ```
 */
export class TokenVerifier {
  /** @internal Public keys by key id. */
  private keys = new Map<string, KeyObject>();

  /** @internal When the keys were last fetched successfully (0 = never). */
  private fetchedAt = 0;

  /** @internal When a refresh was last attempted, successful or not. */
  private lastRefreshAttemptAt = 0;

  /** @internal Refresh in flight, shared by concurrent callers. */
  private pendingRefresh: Promise<void> | undefined;

  /** @internal Logger scoped to this class. */
  private readonly logger: Logger = LoggerBuilder.getChildLogger('TokenVerifier');

  /** @internal HTTP client. */
  private readonly fetchFn: typeof fetch;

  /** @internal Clock. */
  private readonly now: () => number;

  /**
   * Create a verifier for one Auth0 tenant.
   *
   * @param options - See {@link TokenVerifierOptions}
   */
  constructor(private readonly options: TokenVerifierOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? Date.now;
  }

  /**
   * Issuer every accepted token must carry (`iss` claim), with its trailing slash.
   *
   * @returns `https://<domain>/`
   */
  public get issuer(): string {
    return `https://${this.options.domain}/`;
  }

  /**
   * Verify a token's signature, issuer, audience and validity window.
   *
   * @param token - The raw bearer token
   * @param audience - Audience the token must have been issued for
   * @returns The verified claims
   * @throws Error with status 401 when the token is not acceptable, 503 when no public key can be obtained
   *
   * @example
   * ```typescript
   * const claims: AccessTokenClaims = await verifier.verify(token, authConfig.audience);
   * ```
   */
  public async verify(token: string, audience: string): Promise<AccessTokenClaims> {
    const decoded: Jwt | null = jwt.decode(token, { complete: true });
    const kid: string | undefined = decoded?.header.kid;
    if (!decoded || decoded.header.alg !== ALGORITHM || !kid) {
      throw httpError(401, INVALID_TOKEN_MESSAGE, { code: 'invalid_token' });
    }

    const key: KeyObject = await this.getKey(kid);

    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, key, {
        algorithms: [ALGORITHM],
        issuer: this.issuer,
        audience,
        clockTolerance: CLOCK_TOLERANCE_IN_SECONDS,
      }) as JwtPayload;
    } catch (error: unknown) {
      throw httpError(401, INVALID_TOKEN_MESSAGE, { code: 'invalid_token', cause: error });
    }

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw httpError(401, INVALID_TOKEN_MESSAGE, { code: 'invalid_token' });
    }
    return payload as AccessTokenClaims;
  }

  /**
   * Get the public key for a key id, refreshing the cache when it is stale or the id is unknown.
   *
   * @param kid - Key id from the token header
   * @returns The public key
   * @throws Error with status 401 when the key id is unknown to the tenant
   */
  private async getKey(kid: string): Promise<KeyObject> {
    if (this.now() - this.fetchedAt >= this.options.jwksCacheTtl) await this.refresh();

    if (!this.keys.has(kid) && this.now() - this.lastRefreshAttemptAt >= MIN_FORCED_REFRESH_INTERVAL_IN_MS) {
      await this.refresh();
    }

    const key: KeyObject | undefined = this.keys.get(kid);
    if (!key) throw httpError(401, INVALID_TOKEN_MESSAGE, { code: 'invalid_token' });
    return key;
  }

  /**
   * Fetch the JWKS, sharing one request between concurrent callers.
   *
   * A failed fetch keeps the previous keys (a short Auth0 outage must not
   * reject tokens signed with a key we already trust); it only fails when no
   * key has ever been obtained.
   *
   * @returns A promise that resolves once the keys are refreshed or the failure absorbed
   * @throws Error with status 503 when the keys cannot be fetched and none are cached
   */
  private async refresh(): Promise<void> {
    this.pendingRefresh ??= this.fetchKeys().finally((): void => {
      this.pendingRefresh = undefined;
    });

    try {
      await this.pendingRefresh;
    } catch (error: unknown) {
      if (this.keys.size === 0)
        throw httpError(503, 'Authentication is temporarily unavailable', {
          code: 'authentication_unavailable',
          cause: error,
        });
      this.logger.warn('Could not refresh the Auth0 public keys, keeping the cached ones', { error });
    }
  }

  /**
   * Download the tenant's JWKS and replace the cached keys.
   *
   * @returns A promise that resolves once the keys are replaced
   * @throws Error when the endpoint does not answer a usable document
   */
  private async fetchKeys(): Promise<void> {
    this.lastRefreshAttemptAt = this.now();

    const response: Response = await this.fetchFn(`${this.issuer}.well-known/jwks.json`);
    if (!response.ok) throw new Error(`JWKS endpoint answered ${response.status}`);

    const document: { keys?: Jwk[] } = (await response.json()) as { keys?: Jwk[] };
    const keys = new Map<string, KeyObject>();
    for (const jwk of document.keys ?? []) {
      if (!jwk.kid || jwk.kty !== 'RSA' || (jwk.use !== undefined && jwk.use !== 'sig')) continue;
      keys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
    }
    if (keys.size === 0) throw new Error('JWKS document holds no RSA signing key');

    this.keys = keys;
    this.fetchedAt = this.now();
  }
}

/**
 * Fastify plugin that decorates the instance with a {@link TokenVerifier} for the configured tenant.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function tokenVerifierPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate(
    'tokenVerifier',
    new TokenVerifier({ domain: authConfig.domain, jwksCacheTtl: authConfig.jwksCacheTtl })
  );
}

export default fastifyPlugin(tokenVerifierPlugin, {
  name: 'TokenVerifierPlugin',
});
