/** Well-known path prefix of the OAuth 2.0 Protected Resource Metadata (RFC 9728). */
export const PROTECTED_RESOURCE_METADATA_PREFIX = '/.well-known/oauth-protected-resource';

/**
 * Path of the protected resource metadata of a resource, as RFC 9728 derives it.
 *
 * The well-known prefix is inserted between the origin and the path of the
 * resource: `https://api.example.com/mcp` → `/.well-known/oauth-protected-resource/mcp`.
 *
 * @param resourceUrl - Public URL of the protected resource
 * @returns The metadata path, without origin
 *
 * @example
 * ```typescript
 * protectedResourceMetadataPath('https://api.example.com/mcp'); // '/.well-known/oauth-protected-resource/mcp'
 * ```
 */
export function protectedResourceMetadataPath(resourceUrl: string): string {
  const { pathname } = new URL(resourceUrl);
  return pathname === '/' ? PROTECTED_RESOURCE_METADATA_PREFIX : `${PROTECTED_RESOURCE_METADATA_PREFIX}${pathname}`;
}

/**
 * Absolute URL of the protected resource metadata of a resource.
 *
 * It is what an MCP server advertises in the `WWW-Authenticate` challenge of a 401.
 *
 * @param resourceUrl - Public URL of the protected resource
 * @returns The absolute metadata URL
 *
 * @example
 * ```typescript
 * protectedResourceMetadataUrl('https://api.example.com/mcp');
 * // 'https://api.example.com/.well-known/oauth-protected-resource/mcp'
 * ```
 */
export function protectedResourceMetadataUrl(resourceUrl: string): string {
  return `${new URL(resourceUrl).origin}${protectedResourceMetadataPath(resourceUrl)}`;
}
