import { McpToolResult, resolveOrganizationId, runTool } from '@src/mcp/tool-result';
import { SyncService } from '@services';
import { McpContext } from '@src/types';
import { CampaignSyncInput, RetryPlatformUnitInput } from './sync.schema';

/**
 * Handler for `get-campaign-platform-status`.
 *
 * @param service - Synchronization service
 * @param context - MCP context of the call
 * @param args - Organization and campaign
 * @returns Where each unit stands
 */
export async function getPlatformStatus(
  service: SyncService,
  context: McpContext,
  args: CampaignSyncInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.platformStatus(context.auth, resolveOrganizationId(context, args.organizationId), args.campaignId)
  );
}

/**
 * Handler for `sync-campaign`.
 *
 * @param service - Synchronization service
 * @param context - MCP context of the call
 * @param args - Organization and campaign
 * @returns How many units were marked
 */
export async function syncCampaign(
  service: SyncService,
  context: McpContext,
  args: CampaignSyncInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.requestSync(context.auth, resolveOrganizationId(context, args.organizationId), args.campaignId)
  );
}

/**
 * Handler for `retry-platform-unit`.
 *
 * @param service - Synchronization service
 * @param context - MCP context of the call
 * @param args - Organization, campaign and unit
 * @returns The unit, now waiting to be applied
 */
export async function retryPlatformUnit(
  service: SyncService,
  context: McpContext,
  args: RetryPlatformUnitInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.retry(
      context.auth,
      resolveOrganizationId(context, args.organizationId),
      args.campaignId,
      args.platformUnitId
    )
  );
}
