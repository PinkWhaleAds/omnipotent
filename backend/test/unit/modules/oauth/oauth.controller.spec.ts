import Fastify, { FastifyInstance, FastifyRequest, LightMyRequestResponse } from 'fastify';

import OAuthController from '@modules/oauth/oauth.controller';
import { AuthMode, ProtectedResourceMetadata } from '@src/types';
import { closeTestApp } from '@test/utils/fastify-test-app.utils';

describe('Unit::Modules::OAuthController', () => {
  /** Metadata built from `config/test.json` (`McpServer.resourceUrl`, `Auth.domain`) and the default scopes. */
  const METADATA: ProtectedResourceMetadata = {
    resource: 'https://api.omnipotent.test/mcp',
    authorization_servers: ['https://tenant.test.auth0.com/'],
    scopes_supported: ['mcp:use'],
    bearer_methods_supported: ['header'],
    resource_name: 'Omnipotent MCP',
  };

  let app: FastifyInstance;
  let authModes: (AuthMode | undefined)[];

  beforeEach(async (): Promise<void> => {
    jest.clearAllMocks();
    authModes = [];
    app = Fastify();
    // Records the auth mode the auth plugin would read for each request.
    app.addHook('onRequest', async (request: FastifyRequest): Promise<void> => {
      authModes.push(request.routeOptions.config.auth);
    });
    await app.register(OAuthController);
    await app.ready();
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  describe('getProtectedResourceMetadata', () => {
    it.each(['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource'])(
      'should answer the protected resource metadata of the MCP endpoint on %s',
      async (url: string): Promise<void> => {
        const response: LightMyRequestResponse = await app.inject({ method: 'GET', url });

        expect(response.statusCode).toBe(200);
        const body: ProtectedResourceMetadata = JSON.parse(response.body);
        expect(body).toEqual(METADATA);
      }
    );

    it('should be public on both paths', async (): Promise<void> => {
      await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource/mcp' });
      await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' });

      expect(authModes).toEqual(['none', 'none']);
    });
  });
});
