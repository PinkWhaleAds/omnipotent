import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpContext } from '@src/types';
import {
  createLever,
  deleteLever,
  getLever,
  listLevers,
  restoreLever,
  setLeverLabels,
  updateLever,
} from './lever.handler';
import {
  createLeverSchema,
  deleteLeverSchema,
  getLeverSchema,
  listLeversSchema,
  restoreLeverSchema,
  setLeverLabelsSchema,
  updateLeverSchema,
} from './lever.schema';

/**
 * Lever tools controller: one tool per route of the Levers (D21).
 *
 * Wires tool name → schema → handler. No business logic and no inline schemas.
 *
 * @param server - The MCP server to register tools on
 * @param fastify - The Fastify instance providing decorated services
 * @param context - Caller of the MCP request
 */
export default function LeverToolsController(server: McpServer, fastify: FastifyInstance, context: McpContext): void {
  server.registerTool('list-levers', listLeversSchema, async (args) => listLevers(fastify.leverService, context, args));
  server.registerTool('get-lever', getLeverSchema, async (args) => getLever(fastify.leverService, context, args));
  server.registerTool('create-lever', createLeverSchema, async (args) =>
    createLever(fastify.leverService, context, args)
  );
  server.registerTool('update-lever', updateLeverSchema, async (args) =>
    updateLever(fastify.leverService, context, args)
  );
  server.registerTool('delete-lever', deleteLeverSchema, async (args) =>
    deleteLever(fastify.leverService, context, args)
  );
  server.registerTool('restore-lever', restoreLeverSchema, async (args) =>
    restoreLever(fastify.leverService, context, args)
  );
  server.registerTool('set-lever-labels', setLeverLabelsSchema, async (args) =>
    setLeverLabels(fastify.leverService, context, args)
  );
}
