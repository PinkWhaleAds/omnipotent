/**
 * @module mcp/tools
 *
 * Registers all MCP tool controllers on a given MCP server.
 * Mirrors `src/modules/index.ts` for HTTP controllers.
 */
import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpContext } from '@src/types';
import StatusToolsController from './status/status.controller';

/**
 * Register every MCP tool controller on the given MCP server.
 *
 * Every operation of the API is exposed as a tool (D21): each phase registers its resource here,
 * next to its HTTP controller. The socle only carries the status.
 *
 * @param server - The MCP server to attach tool controllers to
 * @param fastify - The Fastify instance providing decorated services
 * @param _context - Caller of the MCP request, handed to every org-scoped tool
 */
export function registerToolControllers(server: McpServer, fastify: FastifyInstance, _context: McpContext): void {
  StatusToolsController(server, fastify);
}
