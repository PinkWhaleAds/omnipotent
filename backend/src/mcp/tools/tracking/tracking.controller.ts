import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpContext } from '@src/types';
import { getTracking } from './tracking.handler';
import { getTrackingSchema } from './tracking.schema';

/**
 * Tracking tools controller: the tool of `GET /advertisers/:id/tracking` (D21). The public script has
 * none: a browser loads it, never a model.
 *
 * @param server - The MCP server to register tools on
 * @param fastify - The Fastify instance providing decorated services
 * @param context - Caller of the MCP request
 */
export default function TrackingToolsController(
  server: McpServer,
  fastify: FastifyInstance,
  context: McpContext
): void {
  server.registerTool('get-tracking', getTrackingSchema, async (args) =>
    getTracking(fastify.trackingService, context, args)
  );
}
