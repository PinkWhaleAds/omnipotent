import { FastifyReply, FastifyRequest } from 'fastify';

import { authConfig, mcpServerConfig } from '@configs';
import { ProtectedResourceMetadata } from '@src/types';

/**
 * Handler for `GET /.well-known/oauth-protected-resource[/mcp]`.
 *
 * Advertises the MCP endpoint as a protected resource whose tokens are issued
 * by the Auth0 tenant. `resource` must equal both the URL clients connect to
 * and the identifier of the Auth0 API representing the MCP endpoint.
 *
 * @param _request - The incoming request
 * @param reply - The reply, sent with the metadata
 * @returns A promise that resolves once the response has been sent
 */
export async function getProtectedResourceMetadata(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const metadata: ProtectedResourceMetadata = {
    resource: mcpServerConfig.resourceUrl,
    authorization_servers: [`https://${authConfig.domain}/`],
    scopes_supported: mcpServerConfig.scopes,
    bearer_methods_supported: ['header'],
    resource_name: 'Omnipotent MCP',
  };
  reply.send(metadata);
}
