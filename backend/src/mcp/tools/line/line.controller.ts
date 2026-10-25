import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpContext } from '@src/types';
import {
  bulkCreateLines,
  bulkDeleteLines,
  bulkRestoreLines,
  bulkUpdateLines,
  createLine,
  deleteLine,
  getLine,
  listLines,
  restoreLine,
  setLineLabels,
  updateLine,
} from './line.handler';
import {
  bulkCreateLinesSchema,
  bulkDeleteLinesSchema,
  bulkRestoreLinesSchema,
  bulkUpdateLinesSchema,
  createLineSchema,
  deleteLineSchema,
  getLineSchema,
  listLinesSchema,
  restoreLineSchema,
  setLineLabelsSchema,
  updateLineSchema,
} from './line.schema';

/**
 * Line tools controller: one tool per route of the Lines (D21).
 *
 * Wires tool name → schema → handler. No business logic and no inline schemas.
 *
 * @param server - The MCP server to register tools on
 * @param fastify - The Fastify instance providing decorated services
 * @param context - Caller of the MCP request
 */
export default function LineToolsController(server: McpServer, fastify: FastifyInstance, context: McpContext): void {
  server.registerTool('list-lines', listLinesSchema, async (args) => listLines(fastify.lineService, context, args));
  server.registerTool('get-line', getLineSchema, async (args) => getLine(fastify.lineService, context, args));
  server.registerTool('create-line', createLineSchema, async (args) => createLine(fastify.lineService, context, args));
  server.registerTool('update-line', updateLineSchema, async (args) => updateLine(fastify.lineService, context, args));
  server.registerTool('delete-line', deleteLineSchema, async (args) => deleteLine(fastify.lineService, context, args));
  server.registerTool('restore-line', restoreLineSchema, async (args) =>
    restoreLine(fastify.lineService, context, args)
  );
  server.registerTool('set-line-labels', setLineLabelsSchema, async (args) =>
    setLineLabels(fastify.lineService, context, args)
  );
  server.registerTool('bulk-create-lines', bulkCreateLinesSchema, async (args) =>
    bulkCreateLines(fastify.lineService, context, args)
  );
  server.registerTool('bulk-update-lines', bulkUpdateLinesSchema, async (args) =>
    bulkUpdateLines(fastify.lineService, context, args)
  );
  server.registerTool('bulk-delete-lines', bulkDeleteLinesSchema, async (args) =>
    bulkDeleteLines(fastify.lineService, context, args)
  );
  server.registerTool('bulk-restore-lines', bulkRestoreLinesSchema, async (args) =>
    bulkRestoreLines(fastify.lineService, context, args)
  );
}
