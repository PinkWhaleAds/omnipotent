import { z } from 'zod';

/**
 * Zod schema of the OAuth 2.0 Protected Resource Metadata (RFC 9728) of the MCP endpoint.
 *
 * MCP clients read it to discover which authorization server (Auth0) issues
 * tokens for the MCP resource, then run the OAuth flow against it.
 *
 * @property resource - Identifier of the protected resource: the public URL of the MCP endpoint
 * @property authorization_servers - Issuers allowed to grant tokens for it
 * @property scopes_supported - Scopes a client may request
 * @property bearer_methods_supported - How the token is sent (`header` only)
 * @property resource_name - Human-readable name shown by clients
 */
export const protectedResourceMetadataSchema = z.object({
  resource: z.string(),
  authorization_servers: z.array(z.string()),
  scopes_supported: z.array(z.string()),
  bearer_methods_supported: z.array(z.string()),
  resource_name: z.string(),
});

/** TypeScript type inferred from {@link protectedResourceMetadataSchema}. */
export type ProtectedResourceMetadata = z.infer<typeof protectedResourceMetadataSchema>;
