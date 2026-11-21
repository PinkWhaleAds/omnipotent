import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpContext } from '@src/types';
import {
  geocodeAddresses,
  getGeoLocations,
  getGeoStatus,
  reverseGeocodePositions,
  searchGeoLocations,
} from './geo.handler';
import {
  geocodeAddressesSchema,
  getGeoLocationsSchema,
  getGeoStatusSchema,
  reverseGeocodePositionsSchema,
  searchGeoLocationsSchema,
} from './geo.schema';

/**
 * Geo tools controller: one tool per route of the referential of places and of the geocoding (D21) —
 * but the map, an image for a person to look at, which a model has no use for.
 *
 * Wires tool name → schema → handler. The referential belongs to no Organization, so its tools take
 * none; the geocoding counts against an Organization's hourly limit, so its tools name one.
 *
 * @param server - The MCP server to register tools on
 * @param fastify - The Fastify instance providing decorated services
 * @param context - Caller of the MCP request
 */
export default function GeoToolsController(server: McpServer, fastify: FastifyInstance, context: McpContext): void {
  server.registerTool('search-geo-locations', searchGeoLocationsSchema, async (args) =>
    searchGeoLocations(fastify.geoService, args)
  );
  server.registerTool('get-geo-locations', getGeoLocationsSchema, async (args) =>
    getGeoLocations(fastify.geoService, args)
  );
  server.registerTool('get-geo-status', getGeoStatusSchema, async () => getGeoStatus(fastify.geocodingService));
  server.registerTool('geocode-addresses', geocodeAddressesSchema, async (args) =>
    geocodeAddresses(fastify.geocodingService, context, args)
  );
  server.registerTool('reverse-geocode-positions', reverseGeocodePositionsSchema, async (args) =>
    reverseGeocodePositions(fastify.geocodingService, context, args)
  );
}
