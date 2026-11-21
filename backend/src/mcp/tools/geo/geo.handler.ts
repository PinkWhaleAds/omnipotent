import type { GeoService } from '@src/services/geo.service';
import type { GeocodingService } from '@src/services/geocoding.service';
import type { GeoLocationIdsQuery, GeoLocationSearchQuery, McpContext } from '@src/types';
import { McpToolResult, resolveOrganizationId, runTool } from '@src/mcp/tool-result';
import type { GeocodeAddressesInput, ReverseGeocodePositionsInput } from './geo.schema';

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

/**
 * Handler for `get-geo-status`.
 *
 * @param service - Geocoding service
 * @returns Whether geocoding works here
 */
export async function getGeoStatus(service: GeocodingService): Promise<McpToolResult> {
  return runTool(async () => Promise.resolve(service.status()));
}

/**
 * Handler for `geocode-addresses`.
 *
 * @param service - Geocoding service
 * @param context - MCP context of the call
 * @param args - Organization, addresses, countries and language
 * @returns One result per address
 */
export async function geocodeAddresses(
  service: GeocodingService,
  context: McpContext,
  args: GeocodeAddressesInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => service.geocode(context.auth, resolveOrganizationId(context, organizationId), body));
}

/**
 * Handler for `reverse-geocode-positions`.
 *
 * @param service - Geocoding service
 * @param context - MCP context of the call
 * @param args - Organization, positions and language
 * @returns One result per position
 */
export async function reverseGeocodePositions(
  service: GeocodingService,
  context: McpContext,
  args: ReverseGeocodePositionsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () =>
    service.reverseGeocode(context.auth, resolveOrganizationId(context, organizationId), body)
  );
}
