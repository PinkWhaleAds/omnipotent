import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { generateKeyPairSync, JsonWebKey, KeyObject } from 'node:crypto';
import Fastify, { FastifyInstance } from 'fastify';
import jwt, { SignOptions } from 'jsonwebtoken';

import { authConfig } from '@configs';
import TokenVerifierPlugin, { TokenVerifier } from '@src/services/token-verifier.service';
import { AccessTokenClaims } from '@src/types/auth.types';
import { closeTestApp } from '@test/utils/fastify-test-app.utils';

/** An RSA key pair published under a key id. */
type SigningKey = {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
};

/** Generate an RSA signing key. */
function createSigningKey(kid: string): SigningKey {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privateKey, publicKey };
}

/** The JWK of a key, as Auth0 publishes it. */
function toJwk(key: SigningKey, members: Record<string, unknown> = { use: 'sig' }): JsonWebKey {
  return { ...key.publicKey.export({ format: 'jwk' }), kid: key.kid, kty: 'RSA', ...members };
}

const KEY_A: SigningKey = createSigningKey('key-a');
const KEY_B: SigningKey = createSigningKey('key-b');

describe('Unit::Services::TokenVerifier', () => {
  const DOMAIN = 'tenant.test.auth0.com';
  const ISSUER = `https://${DOMAIN}/`;
  const AUDIENCE = 'https://api.omnipotent.test';
  const JWKS_CACHE_TTL = 600000;
  const FORCED_REFRESH_INTERVAL = 30000;
  const INVALID_TOKEN = { statusCode: 401, message: 'Invalid or expired access token', errorCode: 'invalid_token' };
  const UNAVAILABLE = {
    statusCode: 503,
    message: 'Authentication is temporarily unavailable',
    errorCode: 'authentication_unavailable',
  };
  const SUB = 'auth0|jane';
  let clock: number;
  let jwks: { keys?: JsonWebKey[] };
  let fetchFn: jest.Mock;
  let verifier: TokenVerifier;

  /** A JWKS endpoint response. */
  function jwksResponse(ok = true, status = 200): Response {
    return { ok, status, json: async (): Promise<object> => jwks } as unknown as Response;
  }

  /** Sign an access token; every option defaults to a valid token signed with KEY_A. */
  function sign(
    payload: object = { sub: SUB },
    options: { key?: SigningKey; kid?: string | null; audience?: string; issuer?: string; expiresIn?: number } = {}
  ): string {
    const kid: string | null = options.kid === undefined ? KEY_A.kid : options.kid;
    const signOptions: SignOptions = {
      algorithm: 'RS256',
      issuer: options.issuer ?? ISSUER,
      audience: options.audience ?? AUDIENCE,
      ...(kid === null ? {} : { keyid: kid }),
      ...('exp' in payload ? {} : { expiresIn: options.expiresIn ?? 300 }),
    };
    return jwt.sign(payload, (options.key ?? KEY_A).privateKey, signOptions);
  }

  /** A promise resolved from outside. */
  function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise: Promise<T> = new Promise<T>((done: (value: T) => void): void => {
      resolve = done;
    });
    return { promise, resolve };
  }

  beforeEach((): void => {
    jest.clearAllMocks();
    clock = 1_000_000_000;
    jwks = { keys: [toJwk(KEY_A)] };
    fetchFn = jest.fn(async (): Promise<Response> => jwksResponse());
    verifier = new TokenVerifier({
      domain: DOMAIN,
      jwksCacheTtl: JWKS_CACHE_TTL,
      fetchFn: fetchFn as unknown as typeof fetch,
      now: (): number => clock,
    });
  });

  describe('issuer', () => {
    it('should be the tenant URL with a trailing slash', (): void => {
      expect(verifier.issuer).toBe(ISSUER);
    });
  });

  describe('verify', () => {
    it('should return the claims of a valid token', async (): Promise<void> => {
      const claims: AccessTokenClaims = await verifier.verify(sign({ sub: SUB, scope: 'mcp:use' }), AUDIENCE);

      expect(claims).toMatchObject({ sub: SUB, scope: 'mcp:use', iss: ISSUER, aud: AUDIENCE });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(fetchFn).toHaveBeenCalledWith(`${ISSUER}.well-known/jwks.json`);
    });

    it('should verify further tokens from the cached keys', async (): Promise<void> => {
      await verifier.verify(sign(), AUDIENCE);
      clock += JWKS_CACHE_TTL - 1;
      await verifier.verify(sign(), AUDIENCE);

      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    describe('malformed tokens', () => {
      it('should refuse a token that cannot be decoded', async (): Promise<void> => {
        await expect(verifier.verify('not-a-jwt', AUDIENCE)).rejects.toMatchObject(INVALID_TOKEN);
        expect(fetchFn).not.toHaveBeenCalled();
      });

      it('should refuse a token signed with another algorithm than RS256', async (): Promise<void> => {
        const token: string = jwt.sign({ sub: SUB }, 'shared-secret', { algorithm: 'HS256', keyid: KEY_A.kid });

        await expect(verifier.verify(token, AUDIENCE)).rejects.toMatchObject(INVALID_TOKEN);
        expect(fetchFn).not.toHaveBeenCalled();
      });

      it('should refuse a token without key id', async (): Promise<void> => {
        await expect(verifier.verify(sign({ sub: SUB }, { kid: null }), AUDIENCE)).rejects.toMatchObject(INVALID_TOKEN);
        expect(fetchFn).not.toHaveBeenCalled();
      });
    });

    describe('rejected claims or signature', () => {
      it('should refuse a token issued for another audience', async (): Promise<void> => {
        const token: string = sign({ sub: SUB }, { audience: 'https://other.api' });

        await expect(verifier.verify(token, AUDIENCE)).rejects.toMatchObject(INVALID_TOKEN);
      });

      it('should refuse a token issued by another tenant', async (): Promise<void> => {
        const token: string = sign({ sub: SUB }, { issuer: 'https://evil.auth0.com/' });

        await expect(verifier.verify(token, AUDIENCE)).rejects.toMatchObject(INVALID_TOKEN);
      });

      it('should refuse an expired token, beyond the clock tolerance', async (): Promise<void> => {
        const nowInSeconds: number = Math.floor(Date.now() / 1000);
        const token: string = sign({ sub: SUB, iat: nowInSeconds - 120, exp: nowInSeconds - 60 });

        await expect(verifier.verify(token, AUDIENCE)).rejects.toMatchObject(INVALID_TOKEN);
      });

      it('should refuse a token signed with another key than the one its kid names', async (): Promise<void> => {
        const token: string = sign({ sub: SUB }, { key: KEY_B, kid: KEY_A.kid });

        const error: unknown = await verifier.verify(token, AUDIENCE).catch((e: unknown): unknown => e);

        expect(error).toMatchObject(INVALID_TOKEN);
        expect((error as Error).cause).toBeInstanceOf(jwt.JsonWebTokenError);
      });

      it('should refuse a token without subject', async (): Promise<void> => {
        await expect(verifier.verify(sign({ scope: 'x' }), AUDIENCE)).rejects.toMatchObject(INVALID_TOKEN);
      });

      it('should refuse a token with an empty subject', async (): Promise<void> => {
        await expect(verifier.verify(sign({ sub: '' }), AUDIENCE)).rejects.toMatchObject(INVALID_TOKEN);
      });
    });

    describe('key rotation', () => {
      it('should refresh the keys once for an unknown key id, at most every 30 s', async (): Promise<void> => {
        await verifier.verify(sign(), AUDIENCE);
        jwks = { keys: [toJwk(KEY_A), toJwk(KEY_B)] };
        const rotated: string = sign({ sub: SUB }, { key: KEY_B, kid: KEY_B.kid });

        clock += FORCED_REFRESH_INTERVAL - 1;
        await expect(verifier.verify(rotated, AUDIENCE)).rejects.toMatchObject(INVALID_TOKEN);
        expect(fetchFn).toHaveBeenCalledTimes(1);

        clock += 1;
        const claims: AccessTokenClaims = await verifier.verify(rotated, AUDIENCE);
        expect(claims.sub).toBe(SUB);
        expect(fetchFn).toHaveBeenCalledTimes(2);
      });

      it('should refuse a key id still unknown after the forced refresh, without refetching', async (): Promise<void> => {
        await verifier.verify(sign(), AUDIENCE);
        const unknown: string = sign({ sub: SUB }, { kid: 'key-unknown' });

        clock += FORCED_REFRESH_INTERVAL;
        await expect(verifier.verify(unknown, AUDIENCE)).rejects.toMatchObject(INVALID_TOKEN);
        expect(fetchFn).toHaveBeenCalledTimes(2);

        clock += 1;
        await expect(verifier.verify(unknown, AUDIENCE)).rejects.toMatchObject(INVALID_TOKEN);
        expect(fetchFn).toHaveBeenCalledTimes(2);
      });

      it('should refresh stale keys once the cache TTL is over', async (): Promise<void> => {
        await verifier.verify(sign(), AUDIENCE);

        clock += JWKS_CACHE_TTL;
        await verifier.verify(sign(), AUDIENCE);

        expect(fetchFn).toHaveBeenCalledTimes(2);
      });

      it('should share a single JWKS request between concurrent verifications', async (): Promise<void> => {
        const pending: { promise: Promise<Response>; resolve: (value: Response) => void } = deferred<Response>();
        fetchFn.mockReturnValueOnce(pending.promise);

        const verifications: Promise<AccessTokenClaims[]> = Promise.all([
          verifier.verify(sign({ sub: 'auth0|one' }), AUDIENCE),
          verifier.verify(sign({ sub: 'auth0|two' }), AUDIENCE),
        ]);
        pending.resolve(jwksResponse());
        const claims: AccessTokenClaims[] = await verifications;

        expect(claims.map((c: AccessTokenClaims): string => c.sub)).toEqual(['auth0|one', 'auth0|two']);
        expect(fetchFn).toHaveBeenCalledTimes(1);
      });
    });

    describe('JWKS failures', () => {
      it('should keep the cached keys and warn when a refresh fails', async (): Promise<void> => {
        await verifier.verify(sign(), AUDIENCE);
        const outage: Error = new Error('ECONNREFUSED');
        fetchFn.mockRejectedValueOnce(outage);

        clock += JWKS_CACHE_TTL;
        const claims: AccessTokenClaims = await verifier.verify(sign(), AUDIENCE);

        expect(claims.sub).toBe(SUB);
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(loggerMock.warn).toHaveBeenCalledWith(
          'Could not refresh the Auth0 public keys, keeping the cached ones',
          { error: outage }
        );
      });

      it('should answer 503 when no key could ever be fetched', async (): Promise<void> => {
        const outage: Error = new Error('ECONNREFUSED');
        fetchFn.mockRejectedValueOnce(outage);

        await expect(verifier.verify(sign(), AUDIENCE)).rejects.toMatchObject({ ...UNAVAILABLE, cause: outage });
        expect(loggerMock.warn).not.toHaveBeenCalled();
      });

      it('should answer 503 when the JWKS endpoint answers a non-ok status', async (): Promise<void> => {
        fetchFn.mockResolvedValueOnce(jwksResponse(false, 500));

        await expect(verifier.verify(sign(), AUDIENCE)).rejects.toMatchObject({
          ...UNAVAILABLE,
          cause: expect.objectContaining({ message: 'JWKS endpoint answered 500' }),
        });
      });

      it('should answer 503 when the JWKS document has no keys member', async (): Promise<void> => {
        jwks = {};

        await expect(verifier.verify(sign(), AUDIENCE)).rejects.toMatchObject({
          ...UNAVAILABLE,
          cause: expect.objectContaining({ message: 'JWKS document holds no RSA signing key' }),
        });
      });

      it('should answer 503 when the JWKS document holds no RSA signing key', async (): Promise<void> => {
        const { kid: _kid, ...withoutKid } = toJwk(KEY_A) as JsonWebKey & { kid: string };
        jwks = {
          keys: [withoutKid, { ...toJwk(KEY_A), kid: 'ec-key', kty: 'EC' }, toJwk(KEY_A, { use: 'enc' })],
        };

        await expect(verifier.verify(sign(), AUDIENCE)).rejects.toMatchObject({
          ...UNAVAILABLE,
          cause: expect.objectContaining({ message: 'JWKS document holds no RSA signing key' }),
        });
      });

      it('should keep the usable keys of a document, accepting a key without use', async (): Promise<void> => {
        jwks = { keys: [toJwk(KEY_B, { use: 'enc' }), toJwk(KEY_A, {})] };

        const claims: AccessTokenClaims = await verifier.verify(sign(), AUDIENCE);

        expect(claims.sub).toBe(SUB);
        await expect(
          verifier.verify(sign({ sub: SUB }, { key: KEY_B, kid: KEY_B.kid }), AUDIENCE)
        ).rejects.toMatchObject(INVALID_TOKEN);
      });
    });
  });

  describe('defaults', () => {
    afterEach((): void => {
      jest.restoreAllMocks();
    });

    it('should use the global fetch and the system clock when none is injected', async (): Promise<void> => {
      const fetchSpy: jest.SpyInstance = jest.spyOn(globalThis, 'fetch').mockResolvedValue(jwksResponse());
      const defaults: TokenVerifier = new TokenVerifier({ domain: DOMAIN, jwksCacheTtl: JWKS_CACHE_TTL });

      const claims: AccessTokenClaims = await defaults.verify(sign(), AUDIENCE);

      expect(claims.sub).toBe(SUB);
      expect(fetchSpy).toHaveBeenCalledWith(`${ISSUER}.well-known/jwks.json`);
    });
  });

  describe('plugin', () => {
    let app: FastifyInstance;

    afterEach(async (): Promise<void> => {
      await closeTestApp(app);
    });

    it('should decorate the instance with a TokenVerifier for the configured tenant', async (): Promise<void> => {
      app = Fastify();
      await app.register(TokenVerifierPlugin);
      await app.ready();

      expect(app.tokenVerifier).toBeInstanceOf(TokenVerifier);
      expect(app.tokenVerifier.issuer).toBe(`https://${authConfig.domain}/`);
      expect(authConfig.domain).toBe(DOMAIN);
    });
  });
});
