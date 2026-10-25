import { AuthConfig, DocsConfig } from '@configs';
const AUTH_CONFIG_MOCK: Pick<AuthConfig, 'domain' | 'audience' | 'swaggerClientId'> = {
  domain: 'tenant.test.auth0.com',
  audience: 'https://api.omnipotent.test',
  swaggerClientId: '',
};
const DOCS_CONFIG_MOCK: DocsConfig = { enabled: true };
jest.mock('@configs', () => ({
  ...jest.requireActual('@configs'),
  authConfig: AUTH_CONFIG_MOCK,
  docsConfig: DOCS_CONFIG_MOCK,
}));

import { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { setupFastifyAppForTest, closeTestApp } from '@test/utils/fastify-test-app.utils';

import SwaggerPlugin from '@src/plugins/swagger.plugin';

/** The parts of the OpenAPI document the plugin configures. */
type OpenApiDocument = {
  openapi: string;
  info: { title: string; description: string; version: string };
  components: { securitySchemes: Record<string, unknown> };
  security: Record<string, string[]>[];
};

describe('Unit::SwaggerPlugin', () => {
  let app: FastifyInstance;

  /** Fetches the generated OpenAPI document. */
  async function openApiDocument(): Promise<OpenApiDocument> {
    const response: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/documentation/json' });
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body);
  }

  /** Fetches the script configuring the Swagger UI. */
  async function swaggerInitializer(): Promise<string> {
    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/documentation/static/swagger-initializer.js',
    });
    expect(response.statusCode).toBe(200);
    return response.body;
  }

  beforeEach((): void => {
    jest.clearAllMocks();
    AUTH_CONFIG_MOCK.swaggerClientId = '';
    DOCS_CONFIG_MOCK.enabled = true;
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  it('should add route /documentation', async (): Promise<void> => {
    app = await setupFastifyAppForTest(SwaggerPlugin);

    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/documentation',
    });

    expect(response.statusCode).toBe(200);
  });

  it('should describe the API', async (): Promise<void> => {
    app = await setupFastifyAppForTest(SwaggerPlugin);

    const document: OpenApiDocument = await openApiDocument();

    expect(document.openapi).toBe('3.0.3');
    expect(document.info).toEqual({
      title: expect.any(String),
      version: expect.any(String),
      description: expect.stringContaining('X-Organization-Id'),
    });
  });

  describe('with the documentation off (production)', () => {
    beforeEach(async (): Promise<void> => {
      DOCS_CONFIG_MOCK.enabled = false;
      AUTH_CONFIG_MOCK.swaggerClientId = 'swagger-client-id';
      app = await setupFastifyAppForTest(SwaggerPlugin);
    });

    it.each([
      '/documentation',
      '/documentation/json',
      '/documentation/yaml',
      '/documentation/static/swagger-initializer.js',
      '/documentation/static/oauth2-redirect.html',
    ])('should not serve %s', async (url: string): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({ method: 'GET', url });

      expect(response.statusCode).toBe(404);
    });

    it('should still build the OpenAPI document, for the tools running the app', async (): Promise<void> => {
      const document = app.swagger() as unknown as OpenApiDocument;

      expect(document.openapi).toBe('3.0.3');
      expect(document.info.description).toContain('X-Organization-Id');
    });
  });

  describe('without a Swagger client id', () => {
    beforeEach(async (): Promise<void> => {
      app = await setupFastifyAppForTest(SwaggerPlugin);
    });

    it('should only offer the bearer token scheme', async (): Promise<void> => {
      const document: OpenApiDocument = await openApiDocument();

      expect(document.components.securitySchemes).toEqual({
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      });
      expect(document.security).toEqual([{ bearerAuth: [] }]);
    });

    it('should not configure the Auth0 sign-in of the UI', async (): Promise<void> => {
      const script: string = await swaggerInitializer();

      expect(script).not.toContain('usePkceWithAuthorizationCodeGrant');
    });
  });

  describe('with a Swagger client id', () => {
    beforeEach(async (): Promise<void> => {
      AUTH_CONFIG_MOCK.swaggerClientId = 'swagger-client-id';
      app = await setupFastifyAppForTest(SwaggerPlugin);
    });

    it('should offer both the bearer token and the Auth0 sign-in', async (): Promise<void> => {
      const document: OpenApiDocument = await openApiDocument();

      expect(document.components.securitySchemes).toEqual({
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        auth0: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: 'https://tenant.test.auth0.com/authorize',
              tokenUrl: 'https://tenant.test.auth0.com/oauth/token',
              scopes: { openid: 'openid', profile: 'profile', email: 'email' },
            },
          },
        },
      });
      expect(document.security).toEqual([{ bearerAuth: [] }, { auth0: ['openid', 'profile', 'email'] }]);
    });

    it('should configure the UI to sign in with PKCE for the API audience', async (): Promise<void> => {
      const script: string = await swaggerInitializer();

      expect(script).toContain('swagger-client-id');
      expect(script).toContain('usePkceWithAuthorizationCodeGrant');
      expect(script).toContain('https://api.omnipotent.test');
    });
  });
});
