import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpContext } from '@src/types';
import { getPlatformStatus, retryPlatformUnit, syncCampaign } from './sync.handler';
import { getPlatformStatusSchema, retryPlatformUnitSchema, syncCampaignSchema } from './sync.schema';

/**
 * Synchronization tools controller: one tool per route (D21).
 *
 * The read comes first on purpose: « has my change reached Google » is the question a model is asked,
 * and it is answered without writing anything.
 *
 * @param server - The MCP server to register tools on
 * @param fastify - The Fastify instance providing decorated services
 * @param context - Caller of the MCP request
 */
export default function SyncToolsController(server: McpServer, fastify: FastifyInstance, context: McpContext): void {
  server.registerTool('get-campaign-platform-status', getPlatformStatusSchema, async (args) =>
    getPlatformStatus(fastify.syncService, context, args)
  );
  server.registerTool('sync-campaign', syncCampaignSchema, async (args) =>
    syncCampaign(fastify.syncService, context, args)
  );
  server.registerTool('retry-platform-unit', retryPlatformUnitSchema, async (args) =>
    retryPlatformUnit(fastify.syncService, context, args)
  );
}
