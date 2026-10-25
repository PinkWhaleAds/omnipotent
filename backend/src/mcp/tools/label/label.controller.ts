import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpContext } from '@src/types';
import {
  bulkCreateLabels,
  bulkDeleteLabels,
  bulkRestoreLabels,
  bulkUpdateLabels,
  createLabel,
  deleteLabel,
  getLabel,
  listLabelResources,
  listLabels,
  restoreLabel,
  updateLabel,
} from './label.handler';
import {
  bulkCreateLabelsSchema,
  bulkDeleteLabelsSchema,
  bulkRestoreLabelsSchema,
  bulkUpdateLabelsSchema,
  createLabelSchema,
  deleteLabelSchema,
  getLabelSchema,
  listLabelResourcesSchema,
  listLabelsSchema,
  restoreLabelSchema,
  updateLabelSchema,
} from './label.schema';

/**
 * Label tools controller: one tool per route of the Labels (D21).
 *
 * Wires tool name → schema → handler. No business logic and no inline schemas.
 *
 * @param server - The MCP server to register tools on
 * @param fastify - The Fastify instance providing decorated services
 * @param context - Caller of the MCP request
 */
export default function LabelToolsController(server: McpServer, fastify: FastifyInstance, context: McpContext): void {
  server.registerTool('list-labels', listLabelsSchema, async (args) => listLabels(fastify.labelService, context, args));
  server.registerTool('get-label', getLabelSchema, async (args) => getLabel(fastify.labelService, context, args));
  server.registerTool('create-label', createLabelSchema, async (args) =>
    createLabel(fastify.labelService, context, args)
  );
  server.registerTool('update-label', updateLabelSchema, async (args) =>
    updateLabel(fastify.labelService, context, args)
  );
  server.registerTool('delete-label', deleteLabelSchema, async (args) =>
    deleteLabel(fastify.labelService, context, args)
  );
  server.registerTool('restore-label', restoreLabelSchema, async (args) =>
    restoreLabel(fastify.labelService, context, args)
  );
  server.registerTool('list-label-resources', listLabelResourcesSchema, async (args) =>
    listLabelResources(fastify.labelService, context, args)
  );
  server.registerTool('bulk-create-labels', bulkCreateLabelsSchema, async (args) =>
    bulkCreateLabels(fastify.labelService, context, args)
  );
  server.registerTool('bulk-update-labels', bulkUpdateLabelsSchema, async (args) =>
    bulkUpdateLabels(fastify.labelService, context, args)
  );
  server.registerTool('bulk-delete-labels', bulkDeleteLabelsSchema, async (args) =>
    bulkDeleteLabels(fastify.labelService, context, args)
  );
  server.registerTool('bulk-restore-labels', bulkRestoreLabelsSchema, async (args) =>
    bulkRestoreLabels(fastify.labelService, context, args)
  );
}
