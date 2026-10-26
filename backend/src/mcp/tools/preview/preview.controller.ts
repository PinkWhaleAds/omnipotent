import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpContext } from '@src/types';
import { launchCampaign, previewCampaign, setCampaignStatus } from './preview.handler';
import { launchCampaignSchema, previewCampaignSchema, setCampaignStatusSchema } from './preview.schema';

/**
 * Preview and lifecycle tools controller: one tool per route (D21).
 *
 * The preview comes first on purpose: a model that reads it before proposing anything says what is
 * missing instead of guessing, and the launch tool refuses what the preview refuses.
 *
 * @param server - The MCP server to register tools on
 * @param fastify - The Fastify instance providing decorated services
 * @param context - Caller of the MCP request
 */
export default function PreviewToolsController(server: McpServer, fastify: FastifyInstance, context: McpContext): void {
  server.registerTool('preview-campaign', previewCampaignSchema, async (args) =>
    previewCampaign(fastify.previewService, context, args)
  );
  server.registerTool('launch-campaign', launchCampaignSchema, async (args) =>
    launchCampaign(fastify.previewService, context, args)
  );
  server.registerTool('set-campaign-status', setCampaignStatusSchema, async (args) =>
    setCampaignStatus(fastify.previewService, context, args)
  );
}
