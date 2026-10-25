import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpContext } from '@src/types';
import {
  bulkCreateLists,
  bulkDeleteLists,
  bulkRestoreLists,
  bulkUpdateLists,
  createList,
  deleteList,
  duplicateList,
  getList,
  listLists,
  moveList,
  restoreList,
  updateList,
} from './list.handler';
import {
  bulkCreateListsSchema,
  bulkDeleteListsSchema,
  bulkRestoreListsSchema,
  bulkUpdateListsSchema,
  createListSchema,
  deleteListSchema,
  duplicateListSchema,
  getListSchema,
  listListsSchema,
  moveListSchema,
  restoreListSchema,
  updateListSchema,
} from './list.schema';

/**
 * List tools controller: one tool per route of the reusable lists (D21).
 *
 * Wires tool name → schema → handler. No business logic and no inline schemas.
 *
 * @param server - The MCP server to register tools on
 * @param fastify - The Fastify instance providing decorated services
 * @param context - Caller of the MCP request
 */
export default function ListToolsController(server: McpServer, fastify: FastifyInstance, context: McpContext): void {
  server.registerTool('list-lists', listListsSchema, async (args) => listLists(fastify.listService, context, args));
  server.registerTool('get-list', getListSchema, async (args) => getList(fastify.listService, context, args));
  server.registerTool('create-list', createListSchema, async (args) => createList(fastify.listService, context, args));
  server.registerTool('update-list', updateListSchema, async (args) => updateList(fastify.listService, context, args));
  server.registerTool('delete-list', deleteListSchema, async (args) => deleteList(fastify.listService, context, args));
  server.registerTool('restore-list', restoreListSchema, async (args) =>
    restoreList(fastify.listService, context, args)
  );
  server.registerTool('duplicate-list', duplicateListSchema, async (args) =>
    duplicateList(fastify.listService, context, args)
  );
  server.registerTool('move-list', moveListSchema, async (args) => moveList(fastify.listService, context, args));
  server.registerTool('bulk-create-lists', bulkCreateListsSchema, async (args) =>
    bulkCreateLists(fastify.listService, context, args)
  );
  server.registerTool('bulk-update-lists', bulkUpdateListsSchema, async (args) =>
    bulkUpdateLists(fastify.listService, context, args)
  );
  server.registerTool('bulk-delete-lists', bulkDeleteListsSchema, async (args) =>
    bulkDeleteLists(fastify.listService, context, args)
  );
  server.registerTool('bulk-restore-lists', bulkRestoreListsSchema, async (args) =>
    bulkRestoreLists(fastify.listService, context, args)
  );
}
