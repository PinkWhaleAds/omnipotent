import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { getGeoLocations, searchGeoLocations } from './geo.handler';
import { getGeoLocationsSchema, searchGeoLocationsSchema } from './geo.schema';

/**
 * Geo tools controller: one tool per route of the referential of places (D21).
 *
 * Wires tool name → schema → handler. The referential belongs to no Organization, so the tools take
 * none.
 *
 * @param server - The MCP server to register tools on
 * @param fastify - The Fastify instance providing decorated services
 */
export default function GeoToolsController(server: McpServer, fastify: FastifyInstance): void {
  server.registerTool('search-geo-locations', searchGeoLocationsSchema, async (args) =>
    searchGeoLocations(fastify.geoService, args)
  );
  server.registerTool('get-geo-locations', getGeoLocationsSchema, async (args) =>
    getGeoLocations(fastify.geoService, args)
  );
}
