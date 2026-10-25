import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpContext } from '@src/types';
import {
  bulkCreateAdGroups,
  bulkDeleteAdGroups,
  bulkRestoreAdGroups,
  bulkUpdateAdGroups,
  createAdGroup,
  deleteAdGroup,
  getAdGroup,
  listAdGroups,
  restoreAdGroup,
  setAdGroupLabels,
  updateAdGroup,
} from './ad-group.handler';
import {
  bulkCreateAdGroupsSchema,
  bulkDeleteAdGroupsSchema,
  bulkRestoreAdGroupsSchema,
  bulkUpdateAdGroupsSchema,
  createAdGroupSchema,
  deleteAdGroupSchema,
  getAdGroupSchema,
  listAdGroupsSchema,
  restoreAdGroupSchema,
  setAdGroupLabelsSchema,
  updateAdGroupSchema,
} from './ad-group.schema';

/**
 * AdGroup tools controller: one tool per route of the AdGroups (D21).
 *
 * Wires tool name → schema → handler. No business logic and no inline schemas.
 *
 * @param server - The MCP server to register tools on
 * @param fastify - The Fastify instance providing decorated services
 * @param context - Caller of the MCP request
 */
export default function AdGroupToolsController(server: McpServer, fastify: FastifyInstance, context: McpContext): void {
  server.registerTool('list-ad-groups', listAdGroupsSchema, async (args) =>
    listAdGroups(fastify.adGroupService, context, args)
  );
  server.registerTool('get-ad-group', getAdGroupSchema, async (args) =>
    getAdGroup(fastify.adGroupService, context, args)
  );
  server.registerTool('create-ad-group', createAdGroupSchema, async (args) =>
    createAdGroup(fastify.adGroupService, context, args)
  );
  server.registerTool('update-ad-group', updateAdGroupSchema, async (args) =>
    updateAdGroup(fastify.adGroupService, context, args)
  );
  server.registerTool('delete-ad-group', deleteAdGroupSchema, async (args) =>
    deleteAdGroup(fastify.adGroupService, context, args)
  );
  server.registerTool('restore-ad-group', restoreAdGroupSchema, async (args) =>
    restoreAdGroup(fastify.adGroupService, context, args)
  );
  server.registerTool('set-ad-group-labels', setAdGroupLabelsSchema, async (args) =>
    setAdGroupLabels(fastify.adGroupService, context, args)
  );
  server.registerTool('bulk-create-ad-groups', bulkCreateAdGroupsSchema, async (args) =>
    bulkCreateAdGroups(fastify.adGroupService, context, args)
  );
  server.registerTool('bulk-update-ad-groups', bulkUpdateAdGroupsSchema, async (args) =>
    bulkUpdateAdGroups(fastify.adGroupService, context, args)
  );
  server.registerTool('bulk-delete-ad-groups', bulkDeleteAdGroupsSchema, async (args) =>
    bulkDeleteAdGroups(fastify.adGroupService, context, args)
  );
  server.registerTool('bulk-restore-ad-groups', bulkRestoreAdGroupsSchema, async (args) =>
    bulkRestoreAdGroups(fastify.adGroupService, context, args)
  );
}
