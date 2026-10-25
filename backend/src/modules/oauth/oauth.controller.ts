import type { FastifyInstance } from 'fastify';

import { mcpServerConfig } from '@configs';
import { PROTECTED_RESOURCE_METADATA_PREFIX, protectedResourceMetadataPath } from '@utils';
import { getProtectedResourceMetadata } from './oauth.handler';
import { getProtectedResourceMetadataSchema } from './oauth.schema';

/**
 * OAuth controller: the discovery document MCP clients read before signing in.
 *
 * Serves the metadata both at the path RFC 9728 derives from the MCP URL
 * (`/.well-known/oauth-protected-resource/mcp`, tried first by clients) and at
 * the bare well-known path. Public: no token is needed to discover how to get one.
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 */
export default async function OAuthController(fastify: FastifyInstance): Promise<void> {
  const paths = new Set<string>([
    protectedResourceMetadataPath(mcpServerConfig.resourceUrl),
    PROTECTED_RESOURCE_METADATA_PREFIX,
  ]);

  for (const url of paths) {
    fastify.route({
      method: 'GET',
      url,
      schema: getProtectedResourceMetadataSchema,
      config: { auth: 'none' },
      handler: getProtectedResourceMetadata,
    });
  }
}
