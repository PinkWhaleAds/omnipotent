import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpContext } from '@src/types';
import {
  bulkCreateAdvertisers,
  bulkDeleteAdvertisers,
  bulkRestoreAdvertisers,
  bulkUpdateAdvertisers,
  createAdvertiser,
  deleteAdvertiser,
  getAdvertiser,
  listAdvertisers,
  restoreAdvertiser,
  setAdvertiserLabels,
  updateAdvertiser,
} from './advertiser.handler';
import {
  bulkCreateAdvertisersSchema,
  bulkDeleteAdvertisersSchema,
  bulkRestoreAdvertisersSchema,
  bulkUpdateAdvertisersSchema,
  createAdvertiserSchema,
  deleteAdvertiserSchema,
  getAdvertiserSchema,
  listAdvertisersSchema,
  restoreAdvertiserSchema,
  setAdvertiserLabelsSchema,
  updateAdvertiserSchema,
} from './advertiser.schema';

/**
 * Advertiser tools controller: one tool per route of the Advertisers (D21).
 *
 * Wires tool name → schema → handler. No business logic and no inline schemas.
 *
 * @param server - The MCP server to register tools on
 * @param fastify - The Fastify instance providing decorated services
 * @param context - Caller of the MCP request
 */
export default function AdvertiserToolsController(
  server: McpServer,
  fastify: FastifyInstance,
  context: McpContext
): void {
  server.registerTool('list-advertisers', listAdvertisersSchema, async (args) =>
    listAdvertisers(fastify.advertiserService, context, args)
  );
  server.registerTool('get-advertiser', getAdvertiserSchema, async (args) =>
    getAdvertiser(fastify.advertiserService, context, args)
  );
  server.registerTool('create-advertiser', createAdvertiserSchema, async (args) =>
    createAdvertiser(fastify.advertiserService, context, args)
  );
  server.registerTool('update-advertiser', updateAdvertiserSchema, async (args) =>
    updateAdvertiser(fastify.advertiserService, context, args)
  );
  server.registerTool('delete-advertiser', deleteAdvertiserSchema, async (args) =>
    deleteAdvertiser(fastify.advertiserService, context, args)
  );
  server.registerTool('restore-advertiser', restoreAdvertiserSchema, async (args) =>
    restoreAdvertiser(fastify.advertiserService, context, args)
  );
  server.registerTool('set-advertiser-labels', setAdvertiserLabelsSchema, async (args) =>
    setAdvertiserLabels(fastify.advertiserService, context, args)
  );
  server.registerTool('bulk-create-advertisers', bulkCreateAdvertisersSchema, async (args) =>
    bulkCreateAdvertisers(fastify.advertiserService, context, args)
  );
  server.registerTool('bulk-update-advertisers', bulkUpdateAdvertisersSchema, async (args) =>
    bulkUpdateAdvertisers(fastify.advertiserService, context, args)
  );
  server.registerTool('bulk-delete-advertisers', bulkDeleteAdvertisersSchema, async (args) =>
    bulkDeleteAdvertisers(fastify.advertiserService, context, args)
  );
  server.registerTool('bulk-restore-advertisers', bulkRestoreAdvertisersSchema, async (args) =>
    bulkRestoreAdvertisers(fastify.advertiserService, context, args)
  );
}
