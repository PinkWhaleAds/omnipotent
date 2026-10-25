import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpContext } from '@src/types';
import {
  bulkCreateTargetingGroups,
  bulkDeleteTargetingGroups,
  bulkRestoreTargetingGroups,
  bulkUpdateTargetingGroups,
  createTargetingGroup,
  deleteTargetingGroup,
  getTargetingGroup,
  listTargetingGroups,
  restoreTargetingGroup,
  setTargetingGroupLabels,
  updateTargetingGroup,
} from './targeting-group.handler';
import {
  bulkCreateTargetingGroupsSchema,
  bulkDeleteTargetingGroupsSchema,
  bulkRestoreTargetingGroupsSchema,
  bulkUpdateTargetingGroupsSchema,
  createTargetingGroupSchema,
  deleteTargetingGroupSchema,
  getTargetingGroupSchema,
  listTargetingGroupsSchema,
  restoreTargetingGroupSchema,
  setTargetingGroupLabelsSchema,
  updateTargetingGroupSchema,
} from './targeting-group.schema';

/**
 * TargetingGroup tools controller: one tool per route of the TargetingGroups (D21).
 *
 * Wires tool name → schema → handler. No business logic and no inline schemas.
 *
 * @param server - The MCP server to register tools on
 * @param fastify - The Fastify instance providing decorated services
 * @param context - Caller of the MCP request
 */
export default function TargetingGroupToolsController(
  server: McpServer,
  fastify: FastifyInstance,
  context: McpContext
): void {
  server.registerTool('list-targeting-groups', listTargetingGroupsSchema, async (args) =>
    listTargetingGroups(fastify.targetingGroupService, context, args)
  );
  server.registerTool('get-targeting-group', getTargetingGroupSchema, async (args) =>
    getTargetingGroup(fastify.targetingGroupService, context, args)
  );
  server.registerTool('create-targeting-group', createTargetingGroupSchema, async (args) =>
    createTargetingGroup(fastify.targetingGroupService, context, args)
  );
  server.registerTool('update-targeting-group', updateTargetingGroupSchema, async (args) =>
    updateTargetingGroup(fastify.targetingGroupService, context, args)
  );
  server.registerTool('delete-targeting-group', deleteTargetingGroupSchema, async (args) =>
    deleteTargetingGroup(fastify.targetingGroupService, context, args)
  );
  server.registerTool('restore-targeting-group', restoreTargetingGroupSchema, async (args) =>
    restoreTargetingGroup(fastify.targetingGroupService, context, args)
  );
  server.registerTool('set-targeting-group-labels', setTargetingGroupLabelsSchema, async (args) =>
    setTargetingGroupLabels(fastify.targetingGroupService, context, args)
  );
  server.registerTool('bulk-create-targeting-groups', bulkCreateTargetingGroupsSchema, async (args) =>
    bulkCreateTargetingGroups(fastify.targetingGroupService, context, args)
  );
  server.registerTool('bulk-update-targeting-groups', bulkUpdateTargetingGroupsSchema, async (args) =>
    bulkUpdateTargetingGroups(fastify.targetingGroupService, context, args)
  );
  server.registerTool('bulk-delete-targeting-groups', bulkDeleteTargetingGroupsSchema, async (args) =>
    bulkDeleteTargetingGroups(fastify.targetingGroupService, context, args)
  );
  server.registerTool('bulk-restore-targeting-groups', bulkRestoreTargetingGroupsSchema, async (args) =>
    bulkRestoreTargetingGroups(fastify.targetingGroupService, context, args)
  );
}
