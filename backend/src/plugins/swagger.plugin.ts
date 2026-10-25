import FastifySwagger from '@fastify/swagger';
import FastifySwaggerUi, { FastifySwaggerUiOptions } from '@fastify/swagger-ui';
import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { authConfig, docsConfig } from '@configs';
import { APP_NAME, APP_VERSION } from '@constants';

/** Scopes requested when signing in from the Swagger UI: the email is needed to link an invitation. */
const SWAGGER_SCOPES: string[] = ['openid', 'profile', 'email'];

/**
 * Description shown at the top of the Swagger UI.
 */
const API_DESCRIPTION: string = [
  'Multi-platform media buying API.',
  '',
  'Authenticate with an Auth0 access token issued for this API (button **Authorize**).',
  'Routes acting on one Organization require the `X-Organization-Id` header: get the ids from omnipass.',
].join('\n');

/**
 * Registers the OpenAPI documentation and, where `Docs.enabled` (`APP_DOCS_ENABLED`) allows it, the Swagger UI.
 *
 * The document is always built (`fastify.swagger()`), so it stays available to the tests and to tools running the
 * app; only the UI serves it over HTTP (`/documentation`, `/documentation/json`, `/documentation/yaml` and the UI's
 * files, `oauth2-redirect.html` included). Off (production), none of those routes exists: they answer 404.
 *
 * Two ways to authenticate from the UI:
 * - `bearerAuth` — paste an access token;
 * - `auth0` — sign in through Auth0 (authorization code + PKCE), available when
 *   `Auth.swaggerClientId` names an Auth0 application allowing the callback
 *   `<host>/documentation/static/oauth2-redirect.html`.
 *
 * @remarks This must be loaded before controllers so that route schemas
 * are picked up by the documentation generator.
 *
 * @param fastify - The Fastify instance to add Swagger to
 * @returns A promise that resolves once Swagger is registered
 *
 * @example
 * ```typescript
 * await fastify.register(SwaggerPlugin);
 * // Swagger UI is now available at the default /documentation route, unless the documentation is off
 * ```
 */
async function SwaggerPlugin(fastify: FastifyInstance): Promise<void> {
  const withAuth0 = Boolean(authConfig.swaggerClientId);

  await fastify.register(FastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: APP_NAME,
        description: API_DESCRIPTION,
        version: APP_VERSION,
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          ...(withAuth0
            ? {
                auth0: {
                  type: 'oauth2',
                  flows: {
                    authorizationCode: {
                      authorizationUrl: `https://${authConfig.domain}/authorize`,
                      tokenUrl: `https://${authConfig.domain}/oauth/token`,
                      scopes: Object.fromEntries(
                        SWAGGER_SCOPES.map((scope: string): [string, string] => [scope, scope])
                      ),
                    },
                  },
                },
              }
            : {}),
        },
      },
      security: withAuth0 ? [{ bearerAuth: [] }, { auth0: SWAGGER_SCOPES }] : [{ bearerAuth: [] }],
    },
  });

  if (!docsConfig.enabled) return;

  const uiOptions: FastifySwaggerUiOptions = withAuth0
    ? {
        initOAuth: {
          clientId: authConfig.swaggerClientId,
          usePkceWithAuthorizationCodeGrant: true,
          scopes: SWAGGER_SCOPES,
          // Without the audience, Auth0 issues a token for /userinfo only, which the API refuses.
          additionalQueryStringParams: { audience: authConfig.audience },
        },
      }
    : {};
  await fastify.register(FastifySwaggerUi, uiOptions);
}

/**
 * Fastify plugin wrapping {@link SwaggerPlugin}.
 *
 * Exposed as the default export so it can be registered directly on a
 * Fastify instance with `fastify.register(SwaggerPlugin)`.
 */
export default fastifyPlugin(SwaggerPlugin, {
  name: 'SwaggerPlugin',
});
