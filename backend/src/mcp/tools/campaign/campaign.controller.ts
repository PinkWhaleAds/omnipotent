import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpContext } from '@src/types';
import {
  bulkCreateCampaigns,
  bulkDeleteCampaigns,
  bulkRestoreCampaigns,
  bulkUpdateCampaigns,
  createCampaign,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  restoreCampaign,
  setCampaignLabels,
  updateCampaign,
} from './campaign.handler';
import {
  bulkCreateCampaignsSchema,
  bulkDeleteCampaignsSchema,
  bulkRestoreCampaignsSchema,
  bulkUpdateCampaignsSchema,
  createCampaignSchema,
  deleteCampaignSchema,
  getCampaignSchema,
  listCampaignsSchema,
  restoreCampaignSchema,
  setCampaignLabelsSchema,
  updateCampaignSchema,
} from './campaign.schema';

/**
 * Campaign tools controller: one tool per route of the Campaigns (D21).
 *
 * Wires tool name → schema → handler. No business logic and no inline schemas.
 *
 * @param server - The MCP server to register tools on
 * @param fastify - The Fastify instance providing decorated services
 * @param context - Caller of the MCP request
 */
export default function CampaignToolsController(
  server: McpServer,
  fastify: FastifyInstance,
  context: McpContext
): void {
  server.registerTool('list-campaigns', listCampaignsSchema, async (args) =>
    listCampaigns(fastify.campaignService, context, args)
  );
  server.registerTool('get-campaign', getCampaignSchema, async (args) =>
    getCampaign(fastify.campaignService, context, args)
  );
  server.registerTool('create-campaign', createCampaignSchema, async (args) =>
    createCampaign(fastify.campaignService, context, args)
  );
  server.registerTool('update-campaign', updateCampaignSchema, async (args) =>
    updateCampaign(fastify.campaignService, context, args)
  );
  server.registerTool('delete-campaign', deleteCampaignSchema, async (args) =>
    deleteCampaign(fastify.campaignService, context, args)
  );
  server.registerTool('restore-campaign', restoreCampaignSchema, async (args) =>
    restoreCampaign(fastify.campaignService, context, args)
  );
  server.registerTool('set-campaign-labels', setCampaignLabelsSchema, async (args) =>
    setCampaignLabels(fastify.campaignService, context, args)
  );
  server.registerTool('bulk-create-campaigns', bulkCreateCampaignsSchema, async (args) =>
    bulkCreateCampaigns(fastify.campaignService, context, args)
  );
  server.registerTool('bulk-update-campaigns', bulkUpdateCampaignsSchema, async (args) =>
    bulkUpdateCampaigns(fastify.campaignService, context, args)
  );
  server.registerTool('bulk-delete-campaigns', bulkDeleteCampaignsSchema, async (args) =>
    bulkDeleteCampaigns(fastify.campaignService, context, args)
  );
  server.registerTool('bulk-restore-campaigns', bulkRestoreCampaignsSchema, async (args) =>
    bulkRestoreCampaigns(fastify.campaignService, context, args)
  );
}
