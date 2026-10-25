import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpContext } from '@src/types';
import {
  getTargeting,
  getTargetingDimensions,
  removeTargetingDimension,
  setTargeting,
  setTargetingDimension,
} from './targeting.handler';
import {
  getTargetingDimensionsSchema,
  getTargetingSchema,
  removeTargetingDimensionSchema,
  setTargetingDimensionSchema,
  setTargetingSchema,
} from './targeting.schema';

/**
 * Targeting tools controller: one tool per route of the targeting (D21).
 *
 * Wires tool name → schema → handler. The registry comes first on purpose: a model that reads it
 * before composing a targeting never guesses a shape.
 *
 * @param server - The MCP server to register tools on
 * @param fastify - The Fastify instance providing decorated services
 * @param context - Caller of the MCP request
 */
export default function TargetingToolsController(
  server: McpServer,
  fastify: FastifyInstance,
  context: McpContext
): void {
  server.registerTool('get-targeting-dimensions', getTargetingDimensionsSchema, async () =>
    getTargetingDimensions(context)
  );
  server.registerTool('get-targeting', getTargetingSchema, async (args) =>
    getTargeting(fastify.targetingService, context, args)
  );
  server.registerTool('set-targeting', setTargetingSchema, async (args) =>
    setTargeting(fastify.targetingService, context, args)
  );
  server.registerTool('set-targeting-dimension', setTargetingDimensionSchema, async (args) =>
    setTargetingDimension(fastify.targetingService, context, args)
  );
  server.registerTool('remove-targeting-dimension', removeTargetingDimensionSchema, async (args) =>
    removeTargetingDimension(fastify.targetingService, context, args)
  );
}
