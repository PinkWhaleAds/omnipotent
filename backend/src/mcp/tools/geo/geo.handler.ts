import type { GeoService } from '@src/services/geo.service';
import type { GeoLocationIdsQuery, GeoLocationSearchQuery } from '@src/types';
import { McpToolResult, runTool } from '@src/mcp/tool-result';

/**
 * Handler for `search-geo-locations`.
 *
 * The referential belongs to no Organization: being authenticated is enough.
 *
 * @param service - Geo service
 * @param args - Text, countries, levels and limit
 * @returns The places found
 */
export async function searchGeoLocations(service: GeoService, args: GeoLocationSearchQuery): Promise<McpToolResult> {
  return runTool(async () => service.search(args));
}

/**
 * Handler for `get-geo-locations`.
 *
 * @param service - Geo service
 * @param args - The ids
 * @returns The places known
 */
export async function getGeoLocations(service: GeoService, args: GeoLocationIdsQuery): Promise<McpToolResult> {
  return runTool(async () => service.byIds(args.ids));
}
