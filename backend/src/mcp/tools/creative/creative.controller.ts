import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpContext } from '@src/types';
import {
  activateCreativeVersion,
  bulkCreateCreatives,
  bulkDeleteCreatives,
  bulkRestoreCreatives,
  bulkUpdateCreatives,
  createCreative,
  createCreativeVersion,
  deleteCreative,
  getCreative,
  getCreativeFormats,
  getCreativeVersion,
  listCreativeVersions,
  listCreatives,
  restoreCreative,
  setCreativeLabels,
  updateCreative,
} from './creative.handler';
import {
  activateCreativeVersionSchema,
  bulkCreateCreativesSchema,
  bulkDeleteCreativesSchema,
  bulkRestoreCreativesSchema,
  bulkUpdateCreativesSchema,
  createCreativeSchema,
  createCreativeVersionSchema,
  deleteCreativeSchema,
  getCreativeFormatsSchema,
  getCreativeSchema,
  getCreativeVersionSchema,
  listCreativeVersionsSchema,
  listCreativesSchema,
  restoreCreativeSchema,
  setCreativeLabelsSchema,
  updateCreativeSchema,
} from './creative.schema';

/**
 * Creative tools controller: one tool per route of the creatives and of their versions (D21).
 *
 * Wires tool name → schema → handler. The registry comes first on purpose: a model that reads it
 * before composing a creative never guesses a payload.
 *
 * @param server - The MCP server to register tools on
 * @param fastify - The Fastify instance providing decorated services
 * @param context - Caller of the MCP request
 */
export default function CreativeToolsController(
  server: McpServer,
  fastify: FastifyInstance,
  context: McpContext
): void {
  server.registerTool('get-creative-formats', getCreativeFormatsSchema, async () => getCreativeFormats(context));
  server.registerTool('list-creatives', listCreativesSchema, async (args) =>
    listCreatives(fastify.creativeService, context, args)
  );
  server.registerTool('get-creative', getCreativeSchema, async (args) =>
    getCreative(fastify.creativeService, context, args)
  );
  server.registerTool('create-creative', createCreativeSchema, async (args) =>
    createCreative(fastify.creativeService, context, args)
  );
  server.registerTool('update-creative', updateCreativeSchema, async (args) =>
    updateCreative(fastify.creativeService, context, args)
  );
  server.registerTool('delete-creative', deleteCreativeSchema, async (args) =>
    deleteCreative(fastify.creativeService, context, args)
  );
  server.registerTool('restore-creative', restoreCreativeSchema, async (args) =>
    restoreCreative(fastify.creativeService, context, args)
  );
  server.registerTool('set-creative-labels', setCreativeLabelsSchema, async (args) =>
    setCreativeLabels(fastify.creativeService, context, args)
  );
  server.registerTool('list-creative-versions', listCreativeVersionsSchema, async (args) =>
    listCreativeVersions(fastify.creativeService, context, args)
  );
  server.registerTool('create-creative-version', createCreativeVersionSchema, async (args) =>
    createCreativeVersion(fastify.creativeService, context, args)
  );
  server.registerTool('get-creative-version', getCreativeVersionSchema, async (args) =>
    getCreativeVersion(fastify.creativeService, context, args)
  );
  server.registerTool('activate-creative-version', activateCreativeVersionSchema, async (args) =>
    activateCreativeVersion(fastify.creativeService, context, args)
  );
  server.registerTool('bulk-create-creatives', bulkCreateCreativesSchema, async (args) =>
    bulkCreateCreatives(fastify.creativeService, context, args)
  );
  server.registerTool('bulk-update-creatives', bulkUpdateCreativesSchema, async (args) =>
    bulkUpdateCreatives(fastify.creativeService, context, args)
  );
  server.registerTool('bulk-delete-creatives', bulkDeleteCreativesSchema, async (args) =>
    bulkDeleteCreatives(fastify.creativeService, context, args)
  );
  server.registerTool('bulk-restore-creatives', bulkRestoreCreativesSchema, async (args) =>
    bulkRestoreCreatives(fastify.creativeService, context, args)
  );
}
