import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpContext } from '@src/types';
import {
  createConversionGoal,
  getConversionGoal,
  listConversionGoals,
  updateConversionGoal,
} from './conversion-goal.handler';
import {
  createConversionGoalSchema,
  getConversionGoalSchema,
  listConversionGoalsSchema,
  updateConversionGoalSchema,
} from './conversion-goal.schema';

/**
 * Conversion goal tools controller: one tool per route of the conversion goals (D21).
 *
 * Wires tool name → schema → handler. No business logic and no inline schemas.
 *
 * @param server - The MCP server to register tools on
 * @param fastify - The Fastify instance providing decorated services
 * @param context - Caller of the MCP request
 */
export default function ConversionGoalToolsController(
  server: McpServer,
  fastify: FastifyInstance,
  context: McpContext
): void {
  server.registerTool('list-conversion-goals', listConversionGoalsSchema, async (args) =>
    listConversionGoals(fastify.conversionGoalService, context, args)
  );
  server.registerTool('get-conversion-goal', getConversionGoalSchema, async (args) =>
    getConversionGoal(fastify.conversionGoalService, context, args)
  );
  server.registerTool('create-conversion-goal', createConversionGoalSchema, async (args) =>
    createConversionGoal(fastify.conversionGoalService, context, args)
  );
  server.registerTool('update-conversion-goal', updateConversionGoalSchema, async (args) =>
    updateConversionGoal(fastify.conversionGoalService, context, args)
  );
}
