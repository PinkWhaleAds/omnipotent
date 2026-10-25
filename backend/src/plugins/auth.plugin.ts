import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { authConfig, docsConfig, mcpServerConfig } from '@configs';
import { AccessTokenClaims, AuthMode, Snapshot } from '@src/types/auth.types';
import { httpError, protectedResourceMetadataUrl, statusCodeOf } from '@utils';

/** Prefix of the `Authorization` header value carrying a bearer token. */
const BEARER_PREFIX = 'bearer ';

/**
 * Whether a route is part of the Swagger UI, which `@fastify/swagger-ui`
 * registers without our route options. It is public: it only describes the API.
 * The exemption only exists while the documentation is served (`Docs.enabled`):
 * off, no route is public by its path.
 *
 * Matched on the route *pattern*, never the raw URL, so a crafted path cannot
 * ride the exemption onto another route.
 *
 * @param routeUrl - Matched route pattern
 * @returns `true` for `/documentation` and its sub-routes, while the documentation is served
 */
function isDocumentationRoute(routeUrl: string): boolean {
  return docsConfig.enabled && (routeUrl === '/documentation' || routeUrl.startsWith('/documentation/'));
}

/**
 * An audience as compared at startup: trimmed, lower-cased, without trailing slashes, so that two spellings of
 * the same identifier are not taken for two APIs.
 *
 * @param audience - An Auth0 API identifier
 * @returns The identifier to compare
 */
function comparableAudience(audience: string): string {
  return audience.trim().toLowerCase().replace(/\/+$/, '');
}

/**
 * Refuse a configuration where the MCP endpoint would accept the tokens of the REST API, or the REST API those of
 * the MCP endpoint: with MCP on, its resource (`MCP_RESOURCE_URL`, the identifier of its own Auth0 API) must be
 * set and differ from the REST API's audience (`AUTH0_AUDIENCE`). One audience for both would let a token given
 * to a third-party MCP client call the whole REST API, and a token of the web front end drive the MCP tools.
 *
 * @throws Error naming the variables to fix
 */
function assertDistinctAudiences(): void {
  if (!mcpServerConfig.enabled) return;
  const resource: string = comparableAudience(mcpServerConfig.resourceUrl);
  if (!resource) {
    throw new Error(
      'MCP is enabled without a resource: set MCP_RESOURCE_URL to the identifier of the Auth0 API of the MCP ' +
        'server, or APP_MCP_ENABLED=false'
    );
  }
  if (resource === comparableAudience(authConfig.audience)) {
    throw new Error(
      'MCP_RESOURCE_URL equals AUTH0_AUDIENCE: MCP tokens must be issued for an Auth0 API of their own, or a REST ' +
        'token would open /mcp and an MCP token the REST API'
    );
  }
}

/**
 * Extract the bearer token of a request.
 *
 * @param request - The incoming request
 * @returns The token, or `undefined` when the header is absent or not a bearer
 */
function readBearer(request: FastifyRequest): string | undefined {
  const header: string | undefined = request.headers.authorization;
  if (!header?.toLowerCase().startsWith(BEARER_PREFIX)) return undefined;
  const token: string = header.slice(BEARER_PREFIX.length).trim();
  return token || undefined;
}

/**
 * Authenticates every request whose route is not public.
 *
 * For each matched route, reads its `auth` option (see `AuthMode`, default
 * `api`), verifies the bearer token **locally** for the matching audience, then asks omnipass who
 * that subject is (`accessService.resolve`) and stores the caller on `request.auth`.
 *
 * The split is the contract of the two projects: the token is verified here, the identity is
 * resolved there — resolving a `sub` into a user needs omnipass's `users` table, which this
 * application does not have (T5). Nothing of the rights travels in the token (T3), so the one
 * `resolve` per request is what makes a revoked role apply within the client's cache TTL instead of
 * at the expiry of the JWT.
 *
 * Permissions are not checked here: services do it, so HTTP routes, MCP tools and job handlers share
 * the same rules.
 *
 * On the MCP route, a 401 carries the `WWW-Authenticate` challenge pointing to
 * the protected resource metadata, which is how MCP clients discover where to
 * sign in.
 *
 * Refuses to start when the Auth0 tenant or audience is not configured: no
 * authenticated route could be served. Refuses too, with MCP on, a missing MCP
 * resource or one equal to the REST API's audience (see
 * {@link assertDistinctAudiences}): the process stops through `killProcess`.
 *
 * Depends on `TokenVerifierPlugin` and `AccessServicePlugin`.
 *
 * @param fastify - The Fastify instance to protect
 * @returns A promise that resolves once the hook is registered
 * @throws Error when `Auth.domain` or `Auth.audience` is empty, or the MCP resource is empty or the REST audience
 *
 * @example
 * ```typescript
 * fastify.route({ method: 'GET', url: '/status', config: { auth: 'none' }, handler });
 * fastify.route({ method: 'GET', url: '/seats', handler }); // needs an API token
 * ```
 */
async function AuthPlugin(fastify: FastifyInstance): Promise<void> {
  if (!authConfig.domain || !authConfig.audience) {
    throw new Error('Auth0 is not configured: set AUTH0_DOMAIN and AUTH0_AUDIENCE');
  }
  assertDistinctAudiences();

  const challenge: string =
    `Bearer resource_metadata="${protectedResourceMetadataUrl(mcpServerConfig.resourceUrl)}", ` +
    `scope="${mcpServerConfig.scopes.join(' ')}"`;

  fastify.decorateRequest('auth', undefined);

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const routeUrl: string | undefined = request.routeOptions.url;
    // Unmatched URLs fall through to the not-found handler: a 404 must not turn into a 401.
    if (!routeUrl || isDocumentationRoute(routeUrl)) return;

    const mode: AuthMode = request.routeOptions.config.auth ?? 'api';
    if (mode === 'none') return;

    const token: string | undefined = readBearer(request);
    try {
      if (!token) throw httpError(401, 'Missing bearer token', { code: 'token_missing' });
      const audience: string = mode === 'mcp' ? mcpServerConfig.resourceUrl : authConfig.audience;
      const claims: AccessTokenClaims = await fastify.tokenVerifier.verify(token, audience);
      // The raw token is relayed to omnipass, which names the actor from it: we always act with the
      // rights of the user, never with those of the application.
      const tenancy: Snapshot = await fastify.accessService.resolve(claims.sub, token);
      request.auth = {
        userId: tenancy.user.id,
        email: tenancy.user.email,
        isSuperAdmin: tenancy.user.isSuperAdmin,
        tenancy,
      };
    } catch (error: unknown) {
      if (mode === 'mcp' && statusCodeOf(error) === 401) {
        reply.header('WWW-Authenticate', token ? `${challenge}, error="invalid_token"` : challenge);
      }
      throw error;
    }
  });
}

export default fastifyPlugin(AuthPlugin, {
  name: 'AuthPlugin',
  dependencies: ['TokenVerifierPlugin', 'AccessServicePlugin'],
});
