import { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { APP_NAME, APP_VERSION } from '@constants';
import { registerToolControllers } from '@src/mcp/tools';
import { McpContext } from '@src/types';

/**
 * Instructions sent to MCP clients at initialization, to orient the model.
 *
 * Each phase extends them with what its tools let a model do, in the order a campaign is built.
 */
export const MCP_INSTRUCTIONS: string = [
  'Omnipotent runs advertising campaigns across media buying platforms on six levers: search, dooh,',
  'audio, social, ctv_tvs and dac (display and video on the web and in apps), from one interface.',
  'Data is organized as Seat (client company) > Organization (workspace) > Advertiser (brand).',
  'Org-scoped tools take an organizationId; ask the user which Organization to use when there are several.',
  'Roles: viewer reads, manager edits, admin also manages members.',
].join(' ');

/**
 * Creates and configures an MCP server instance with all registered tools.
 *
 * This factory is the MCP equivalent of `src/modules/index.ts` for HTTP
 * controllers. Each call returns a fresh `McpServer` bound to the caller of
 * the request (one per request in stateless mode, one per session in stateful mode).
 *
 * @param fastify - The Fastify instance providing decorated services
 * @param context - The authenticated caller and their default Organization
 * @returns A fully configured MCP server ready to be connected to a transport
 */
export function createMcpServer(fastify: FastifyInstance, context: McpContext): McpServer {
  const server: McpServer = new McpServer(
    {
      name: APP_NAME,
      version: APP_VERSION,
    },
    { instructions: MCP_INSTRUCTIONS }
  );

  registerToolControllers(server, fastify, context);

  return server;
}
