import { McpToolResult, toolResult } from '@src/mcp/tool-result';
import { McpContext } from '@src/types';

/**
 * Handler for `get-me`: what omnipass answered for the caller of the MCP session.
 *
 * @param context - MCP context of the call
 * @returns The snapshot
 */
export async function getMe(context: McpContext): Promise<McpToolResult> {
  return toolResult(context.auth.tenancy);
}
