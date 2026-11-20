import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpContext } from '@src/types';
import { getMe } from './me.handler';
import { getMeSchema } from './me.schema';

/**
 * Register the tool of the caller: who omnipass says they are.
 *
 * @param server - The MCP server
 * @param context - MCP context of the session
 * @returns Nothing
 */
export default function MeToolsController(server: McpServer, context: McpContext): void {
  server.registerTool('get-me', getMeSchema, async () => getMe(context));
}
