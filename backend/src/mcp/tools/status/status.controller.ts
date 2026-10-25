import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { getStatus } from './status.handler';
import { getStatusSchema } from './status.schema';

/**
 * Status tools controller.
 *
 * Wires every status-related MCP tool: name → schema → handler. No
 * business logic and no inline schemas — handlers live in
 * `status.handler.ts` and schemas in `status.schema.ts`.
 *
 * The Fastify instance is forwarded so handlers can reach decorated
 * services (e.g. `fastify.statusService`), mirroring the HTTP
 * controller convention.
 *
 * @param server - The MCP server to register tools on
 * @param fastify - The Fastify instance providing decorated services
 */
export default function StatusToolsController(server: McpServer, fastify: FastifyInstance): void {
  server.registerTool('get-status', getStatusSchema, async () => getStatus(fastify.statusService));
}
