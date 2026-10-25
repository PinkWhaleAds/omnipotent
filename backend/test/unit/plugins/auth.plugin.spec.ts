import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { AuthConfig, DocsConfig, McpServerConfig } from '@configs';
const AUTH_CONFIG_DEFAULTS: AuthConfig = {
  domain: 'tenant.test.auth0.com',
  audience: 'https://api.omnipotent.test',
  jwksCacheTtl: 600000,
  swaggerClientId: '',
};
const AUTH_CONFIG_MOCK: AuthConfig = { ...AUTH_CONFIG_DEFAULTS };
const MCP_CONFIG_DEFAULTS: Pick<McpServerConfig, 'enabled' | 'resourceUrl' | 'scopes'> = {
  enabled: true,
  resourceUrl: 'https://api.omnipotent.test/mcp',
  scopes: ['mcp:use'],
};
const MCP_CONFIG_MOCK: Pick<McpServerConfig, 'enabled' | 'resourceUrl' | 'scopes'> = { ...MCP_CONFIG_DEFAULTS };
const DOCS_CONFIG_MOCK: DocsConfig = { enabled: true };
jest.mock('@configs', () => ({
  ...jest.requireActual('@configs'),
  authConfig: AUTH_CONFIG_MOCK,
  mcpServerConfig: MCP_CONFIG_MOCK,
  docsConfig: DOCS_CONFIG_MOCK,
}));

import { generateKeyPairSync, JsonWebKey, KeyObject } from 'node:crypto';
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest, LightMyRequestResponse } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import jwt from 'jsonwebtoken';

import AuthPlugin from '@src/plugins/auth.plugin';
import ErrorHandlerPlugin from '@src/plugins/error-handler.plugin';
import type { AccessService } from '@services';
import { TokenVerifier } from '@src/services/token-verifier.service';
import { AccessTokenClaims, AuthContext, ErrorResponse } from '@src/types';
import { JANE } from '@test/unit/mocks/auth.fixtures';
import { closeTestApp } from '@test/utils/fastify-test-app.utils';
import { httpError } from '@utils';

describe('Unit::Plugins::AuthPlugin', () => {
  const TOKEN = 'header.payload.signature';
  const CLAIMS: AccessTokenClaims = { sub: 'auth0|jane' };
  const API_AUDIENCE = 'https://api.omnipotent.test';
  const MCP_RESOURCE = 'https://api.omnipotent.test/mcp';
  const CHALLENGE =
    'Bearer resource_metadata="https://api.omnipotent.test/.well-known/oauth-protected-resource/mcp", ' +
    'scope="mcp:use"';

  const tokenVerifier: { verify: jest.Mock } = { verify: jest.fn() };
  const accessService: { resolve: jest.Mock } = { resolve: jest.fn() };
  /** The verifier the token verifier plugin decorates the instance with: the mock, or a real one. */
  let verifier: TokenVerifier;
  let app: FastifyInstance;

  /** Stands in for the token verifier service, under the name the auth plugin depends on. */
  const FakeTokenVerifierPlugin = fastifyPlugin(
    async (fastify: FastifyInstance): Promise<void> => {
      fastify.decorate('tokenVerifier', verifier);
    },
    { name: 'TokenVerifierPlugin' }
  );

  /** Stands in for the access service, under the name the auth plugin depends on. */
  const FakeAccessServicePlugin = fastifyPlugin(
    async (fastify: FastifyInstance): Promise<void> => {
      fastify.decorate('accessService', accessService as unknown as AccessService);
    },
    { name: 'AccessServicePlugin' }
  );

  /** Answers with the caller the auth plugin stored on the request. */
  async function echoAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    reply.send({ auth: request.auth ?? null });
  }

  /** Routes covering every auth mode, plus the documentation patterns. */
  async function routes(fastify: FastifyInstance): Promise<void> {
    fastify.get('/default', echoAuth);
    fastify.route({ method: 'GET', url: '/api', config: { auth: 'api' }, handler: echoAuth });
    fastify.route({ method: 'POST', url: '/mcp', config: { auth: 'mcp' }, handler: echoAuth });
    fastify.route({ method: 'GET', url: '/public', config: { auth: 'none' }, handler: echoAuth });
    fastify.get('/documentation', echoAuth);
    fastify.get('/documentation/json', echoAuth);
    fastify.get('/documentation-private', echoAuth);
  }

  /** Builds an app with the fake services, the error handler, the auth plugin and the test routes. */
  async function buildApp(): Promise<FastifyInstance> {
    const instance: FastifyInstance = Fastify();
    await instance.register(FakeTokenVerifierPlugin);
    await instance.register(FakeAccessServicePlugin);
    await instance.register(ErrorHandlerPlugin);
    await instance.register(AuthPlugin);
    await instance.register(routes);
    await instance.ready();
    return instance;
  }

  beforeEach((): void => {
    jest.clearAllMocks();
    Object.assign(AUTH_CONFIG_MOCK, AUTH_CONFIG_DEFAULTS);
    Object.assign(MCP_CONFIG_MOCK, MCP_CONFIG_DEFAULTS);
    DOCS_CONFIG_MOCK.enabled = true;
    verifier = tokenVerifier as unknown as TokenVerifier;
    tokenVerifier.verify.mockResolvedValue(CLAIMS);
    accessService.resolve.mockResolvedValue(JANE.tenancy);
  });

  afterEach(async (): Promise<void> => {
    if (app) await closeTestApp(app);
  });

  describe('registration', () => {
    it.each([
      ['domain', { domain: '' }],
      ['audience', { audience: '' }],
    ])(
      'should refuse to start when the Auth0 %s is not configured',
      async (_name: string, overrides: Partial<AuthConfig>): Promise<void> => {
        Object.assign(AUTH_CONFIG_MOCK, overrides);
        app = Fastify();
        await app.register(FakeTokenVerifierPlugin);
        await app.register(FakeAccessServicePlugin);
        app.register(AuthPlugin);

        await expect(app.ready()).rejects.toThrow('Auth0 is not configured: set AUTH0_DOMAIN and AUTH0_AUDIENCE');
      }
    );

    /** Registers the auth plugin alone, to see whether it starts. */
    async function register(): Promise<void> {
      app = Fastify();
      await app.register(FakeTokenVerifierPlugin);
      await app.register(FakeAccessServicePlugin);
      app.register(AuthPlugin);
      await app.ready();
    }

    it.each([
      ['the REST audience', API_AUDIENCE],
      ['the REST audience spelled otherwise', ' HTTPS://API.omnipotent.test/ '],
    ])('should refuse to start when the MCP resource is %s', async (_case: string, resourceUrl: string) => {
      MCP_CONFIG_MOCK.resourceUrl = resourceUrl;

      await expect(register()).rejects.toThrow(
        'MCP_RESOURCE_URL equals AUTH0_AUDIENCE: MCP tokens must be issued for an Auth0 API of their own'
      );
    });

    it.each(['', '  '])('should refuse to start when MCP is enabled without a resource (%j)', async (resourceUrl) => {
      MCP_CONFIG_MOCK.resourceUrl = resourceUrl;

      await expect(register()).rejects.toThrow('MCP is enabled without a resource: set MCP_RESOURCE_URL');
    });

    it('should start without an MCP resource when MCP is disabled', async (): Promise<void> => {
      Object.assign(MCP_CONFIG_MOCK, { enabled: false, resourceUrl: API_AUDIENCE });

      await expect(register()).resolves.toBeUndefined();
    });

    it('should start when the MCP resource has an audience of its own', async (): Promise<void> => {
      await expect(register()).resolves.toBeUndefined();
    });
  });

  describe('api routes', () => {
    beforeEach(async (): Promise<void> => {
      app = await buildApp();
    });

    it.each(['/default', '/api'])(
      'should verify the token for the API audience and store the caller on %s',
      async (url: string): Promise<void> => {
        const response: LightMyRequestResponse = await app.inject({
          method: 'GET',
          url,
          headers: { authorization: `Bearer ${TOKEN}` },
        });

        expect(response.statusCode).toBe(200);
        const body: { auth: AuthContext } = JSON.parse(response.body);
        expect(body.auth).toEqual(JANE);
        expect(tokenVerifier.verify).toHaveBeenCalledWith(TOKEN, API_AUDIENCE);
        expect(accessService.resolve).toHaveBeenCalledWith(CLAIMS.sub, TOKEN);
      }
    );

    it.each(['bearer', 'BEARER', 'BeArEr'])(
      'should read the scheme %s case-insensitively',
      async (scheme: string): Promise<void> => {
        const response: LightMyRequestResponse = await app.inject({
          method: 'GET',
          url: '/api',
          headers: { authorization: `${scheme} ${TOKEN}` },
        });

        expect(response.statusCode).toBe(200);
        expect(tokenVerifier.verify).toHaveBeenCalledWith(TOKEN, API_AUDIENCE);
      }
    );

    it('should trim the token', async (): Promise<void> => {
      await app.inject({ method: 'GET', url: '/api', headers: { authorization: `Bearer   ${TOKEN}  ` } });

      expect(tokenVerifier.verify).toHaveBeenCalledWith(TOKEN, API_AUDIENCE);
    });

    it.each([
      ['no Authorization header', undefined],
      ['another scheme', `Basic ${TOKEN}`],
      ['a bare scheme', 'Bearer'],
      ['an empty token', 'Bearer  '],
    ])('should answer 401 without a challenge for %s', async (_case: string, authorization?: string): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: '/api',
        headers: authorization === undefined ? {} : { authorization },
      });

      expect(response.statusCode).toBe(401);
      const body: ErrorResponse = JSON.parse(response.body);
      expect(body).toEqual({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Missing bearer token',
        code: 'token_missing',
        params: {},
        requestId: expect.any(String),
      });
      expect(response.headers['www-authenticate']).toBeUndefined();
      expect(tokenVerifier.verify).not.toHaveBeenCalled();
    });

    it('should answer 401 without a challenge when the token is rejected', async (): Promise<void> => {
      tokenVerifier.verify.mockRejectedValue(httpError(401, 'Invalid token'));

      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: '/api',
        headers: { authorization: `Bearer ${TOKEN}` },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toMatchObject({ message: 'Invalid token' });
      expect(response.headers['www-authenticate']).toBeUndefined();
      expect(accessService.resolve).not.toHaveBeenCalled();
    });

    it('should pass a resolution failure of omnipass through', async (): Promise<void> => {
      accessService.resolve.mockRejectedValue(httpError(403, 'The email of this account is not verified'));

      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: '/api',
        headers: { authorization: `Bearer ${TOKEN}` },
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body)).toMatchObject({ message: 'The email of this account is not verified' });
    });
  });

  describe('mcp routes', () => {
    beforeEach(async (): Promise<void> => {
      app = await buildApp();
    });

    it('should verify the token for the MCP resource and store the caller', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { authorization: `Bearer ${TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ auth: JANE });
      expect(tokenVerifier.verify).toHaveBeenCalledWith(TOKEN, MCP_RESOURCE);
      expect(accessService.resolve).toHaveBeenCalledWith(CLAIMS.sub, TOKEN);
    });

    it('should challenge a request without a token', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({ method: 'POST', url: '/mcp' });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toMatchObject({
        statusCode: 401,
        message: 'Missing bearer token',
        code: 'token_missing',
      });
      expect(response.headers['www-authenticate']).toBe(CHALLENGE);
    });

    it('should challenge a rejected token with error="invalid_token"', async (): Promise<void> => {
      tokenVerifier.verify.mockRejectedValue(httpError(401, 'Token expired'));

      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { authorization: `Bearer ${TOKEN}` },
      });

      expect(response.statusCode).toBe(401);
      expect(response.headers['www-authenticate']).toBe(`${CHALLENGE}, error="invalid_token"`);
    });

    it('should not challenge a failure other than a 401', async (): Promise<void> => {
      accessService.resolve.mockRejectedValue(httpError(403, 'The email of this account is not verified'));

      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { authorization: `Bearer ${TOKEN}` },
      });

      expect(response.statusCode).toBe(403);
      expect(response.headers['www-authenticate']).toBeUndefined();
    });

    it('should not challenge an unexpected error', async (): Promise<void> => {
      tokenVerifier.verify.mockRejectedValue(new Error('JWKS endpoint unreachable'));

      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { authorization: `Bearer ${TOKEN}` },
      });

      expect(response.statusCode).toBe(500);
      expect(response.headers['www-authenticate']).toBeUndefined();
    });
  });

  describe('public routes', () => {
    beforeEach(async (): Promise<void> => {
      app = await buildApp();
    });

    it.each(['/public', '/documentation', '/documentation/json'])(
      'should let %s through without a token',
      async (url: string): Promise<void> => {
        const response: LightMyRequestResponse = await app.inject({ method: 'GET', url });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ auth: null });
        expect(tokenVerifier.verify).not.toHaveBeenCalled();
        expect(accessService.resolve).not.toHaveBeenCalled();
      }
    );

    it.each(['/documentation', '/documentation/json'])(
      'should authenticate %s like any route once the documentation is off',
      async (url: string): Promise<void> => {
        await closeTestApp(app);
        DOCS_CONFIG_MOCK.enabled = false;
        app = await buildApp();

        const response: LightMyRequestResponse = await app.inject({ method: 'GET', url });

        expect(response.statusCode).toBe(401);
        expect(JSON.parse(response.body)).toMatchObject({ code: 'token_missing' });
      }
    );

    it('should not extend the documentation exemption to a route merely starting like it', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/documentation-private' });

      expect(response.statusCode).toBe(401);
    });

    it('should answer 404, not 401, for a URL matching no route', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/nope' });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toMatchObject({ statusCode: 404, error: 'Not Found' });
      expect(tokenVerifier.verify).not.toHaveBeenCalled();
    });
  });

  describe('audiences, with the real token verifier', () => {
    const ISSUER = 'https://tenant.test.auth0.com/';
    const { privateKey, publicKey }: { privateKey: KeyObject; publicKey: KeyObject } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const JWKS: { keys: JsonWebKey[] } = {
      keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'key-1', kty: 'RSA', use: 'sig' }],
    };

    /** An access token of Jane signed by the tenant, issued for one audience. */
    function tokenFor(audience: string): string {
      return jwt.sign({ sub: 'auth0|jane' }, privateKey, {
        algorithm: 'RS256',
        issuer: ISSUER,
        audience,
        keyid: 'key-1',
        expiresIn: 300,
      });
    }

    beforeEach(async (): Promise<void> => {
      const fetchFn: jest.Mock = jest.fn(
        async (): Promise<Response> => ({ ok: true, status: 200, json: async () => JWKS }) as unknown as Response
      );
      verifier = new TokenVerifier({
        domain: 'tenant.test.auth0.com',
        jwksCacheTtl: 600000,
        fetchFn: fetchFn as unknown as typeof fetch,
      });
      app = await buildApp();
    });

    it('should accept a REST token on the REST API and an MCP token on /mcp', async (): Promise<void> => {
      const rest: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: '/api',
        headers: { authorization: `Bearer ${tokenFor(API_AUDIENCE)}` },
      });
      const mcp: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { authorization: `Bearer ${tokenFor(MCP_RESOURCE)}` },
      });

      expect(rest.statusCode).toBe(200);
      expect(mcp.statusCode).toBe(200);
      expect(accessService.resolve).toHaveBeenCalledTimes(2);
    });

    it('should refuse a REST token on /mcp, with the challenge', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { authorization: `Bearer ${tokenFor(API_AUDIENCE)}` },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toMatchObject({ code: 'invalid_token' });
      expect(response.headers['www-authenticate']).toBe(`${CHALLENGE}, error="invalid_token"`);
      expect(accessService.resolve).not.toHaveBeenCalled();
    });

    it.each(['/api', '/default'])('should refuse an MCP token on the REST route %s', async (url: string) => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${tokenFor(MCP_RESOURCE)}` },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toMatchObject({ code: 'invalid_token' });
      expect(accessService.resolve).not.toHaveBeenCalled();
    });
  });
});
