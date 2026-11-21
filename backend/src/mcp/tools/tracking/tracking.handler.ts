import { McpToolResult, resolveOrganizationId, runTool } from '@src/mcp/tool-result';
import type { TrackingService } from '@src/services/tracking.service';
import { McpContext } from '@src/types';
import { GetTrackingInput } from './tracking.schema';

/**
 * Handler for `get-tracking`.
 *
 * @param service - Tracking service
 * @param context - MCP context of the call
 * @param args - Organization and Advertiser
 * @returns The tracking of the Advertiser
 */
export async function getTracking(
  service: TrackingService,
  context: McpContext,
  args: GetTrackingInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.get(context.auth, resolveOrganizationId(context, args.organizationId), args.advertiserId)
  );
}
