import { z } from 'zod';

import type { AuthContext } from './auth.types';

/**
 * Who calls the MCP server, resolved for every MCP request.
 *
 * @property auth - The authenticated caller (MCP bearer token)
 * @property organizationId - Default Organization, from the `X-Organization-Id` header when the client sends one
 *   (Claude Code can; Claude.ai and ChatGPT connectors cannot, so tools also take an `organizationId` argument)
 */
export type McpContext = {
  auth: AuthContext;
  organizationId?: string;
};

/**
 * Optional `organizationId` argument of org-scoped tools. Falls back to the
 * `X-Organization-Id` header of the MCP connection.
 */
export const organizationArgSchema = z
  .uuid()
  .optional()
  .describe('Organization to act on (from get-me); defaults to the X-Organization-Id header');

/**
 * Zod schema of what the « Assistant IA » page needs to add the MCP server to an assistant.
 *
 * @property mcpUrl - Public address of the MCP endpoint, without Organization (the page adds `?organization=<id>`)
 * @property claudeClientId - Client id of the public Auth0 application Claude's connectors sign in with, to paste in
 *   the connector's advanced settings; `null` while none is registered
 */
export const mcpConnectionSchema = z.object({
  mcpUrl: z.url(),
  claudeClientId: z.string().nullable(),
});

/** TypeScript type inferred from {@link mcpConnectionSchema}. */
export type McpConnection = z.infer<typeof mcpConnectionSchema>;
