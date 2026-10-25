import { mcpToolRateLimiter } from '@src/mcp/tool-rate-limit';
import { McpToolResult, resolveOrganizationId, runTool } from '@src/mcp/tool-result';
import { CampaignService } from '@services';
import { McpContext } from '@src/types';
import {
  BulkCampaignIdsInput,
  BulkCreateCampaignsInput,
  BulkUpdateCampaignsInput,
  CampaignInput,
  CreateCampaignInput,
  ListCampaignsInput,
  SetCampaignLabelsInput,
  UpdateCampaignInput,
} from './campaign.schema';

/**
 * Handler for `list-campaigns`.
 *
 * @param service - Campaign service
 * @param context - MCP context of the call
 * @param args - Organization, Advertiser, page, sort, search and Label filter
 * @returns A page of campaigns
 */
export async function listCampaigns(
  service: CampaignService,
  context: McpContext,
  args: ListCampaignsInput
): Promise<McpToolResult> {
  const { organizationId, advertiserId, ...query } = args;
  return runTool(async () =>
    service.list(context.auth, resolveOrganizationId(context, organizationId), advertiserId, query)
  );
}

/**
 * Handler for `get-campaign`.
 *
 * @param service - Campaign service
 * @param context - MCP context of the call
 * @param args - Organization and campaign
 * @returns The campaign
 */
export async function getCampaign(
  service: CampaignService,
  context: McpContext,
  args: CampaignInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.get(context.auth, resolveOrganizationId(context, args.organizationId), args.campaignId)
  );
}

/**
 * Handler for `create-campaign`.
 *
 * @param service - Campaign service
 * @param context - MCP context of the call
 * @param args - Organization, Advertiser and what the campaign carries
 * @returns The created campaign
 */
export async function createCampaign(
  service: CampaignService,
  context: McpContext,
  args: CreateCampaignInput
): Promise<McpToolResult> {
  const { organizationId, advertiserId, ...body } = args;
  return runTool(async () =>
    service.create(context.auth, resolveOrganizationId(context, organizationId), advertiserId, body)
  );
}

/**
 * Handler for `update-campaign`.
 *
 * @param service - Campaign service
 * @param context - MCP context of the call
 * @param args - Organization, campaign and the fields to change
 * @returns The updated campaign
 */
export async function updateCampaign(
  service: CampaignService,
  context: McpContext,
  args: UpdateCampaignInput
): Promise<McpToolResult> {
  const { organizationId, campaignId, ...body } = args;
  return runTool(async () =>
    service.update(context.auth, resolveOrganizationId(context, organizationId), campaignId, body)
  );
}

/**
 * Handler for `delete-campaign`.
 *
 * @param service - Campaign service
 * @param context - MCP context of the call
 * @param args - Organization and campaign
 * @returns Its id and when it was deleted
 */
export async function deleteCampaign(
  service: CampaignService,
  context: McpContext,
  args: CampaignInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.delete(context.auth, resolveOrganizationId(context, args.organizationId), args.campaignId)
  );
}

/**
 * Handler for `restore-campaign`.
 *
 * @param service - Campaign service
 * @param context - MCP context of the call
 * @param args - Organization and campaign
 * @returns Its id, with `deletedAt` back to `null`
 */
export async function restoreCampaign(
  service: CampaignService,
  context: McpContext,
  args: CampaignInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.restore(context.auth, resolveOrganizationId(context, args.organizationId), args.campaignId)
  );
}

/**
 * Handler for `set-campaign-labels`.
 *
 * @param service - Campaign service
 * @param context - MCP context of the call
 * @param args - Organization, campaign and the complete set of Label ids
 * @returns The campaign, with the Labels it now carries
 */
export async function setCampaignLabels(
  service: CampaignService,
  context: McpContext,
  args: SetCampaignLabelsInput
): Promise<McpToolResult> {
  const { organizationId, campaignId, ...body } = args;
  return runTool(async () =>
    service.setLabels(context.auth, resolveOrganizationId(context, organizationId), campaignId, body)
  );
}

/**
 * Handler for `bulk-create-campaigns`.
 *
 * Counted against the limit of the route it mirrors: a bulk holds a connection and a transaction for
 * up to 200 items, whichever door it came through.
 *
 * @param service - Campaign service
 * @param context - MCP context of the call
 * @param args - Organization, Advertiser, mode and the campaigns to create
 * @returns What was created, and what was not
 */
export async function bulkCreateCampaigns(
  service: CampaignService,
  context: McpContext,
  args: BulkCreateCampaignsInput
): Promise<McpToolResult> {
  const { organizationId, advertiserId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'POST /advertisers/:id/campaigns/bulk');
    return service.bulkCreate(context.auth, resolveOrganizationId(context, organizationId), advertiserId, body);
  });
}

/**
 * Handler for `bulk-update-campaigns`.
 *
 * @param service - Campaign service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the changes, each naming its campaign
 * @returns What was changed, and what was not
 */
export async function bulkUpdateCampaigns(
  service: CampaignService,
  context: McpContext,
  args: BulkUpdateCampaignsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'PATCH /campaigns/bulk');
    return service.bulkUpdate(context.auth, resolveOrganizationId(context, organizationId), body);
  });
}

/**
 * Handler for `bulk-delete-campaigns`.
 *
 * @param service - Campaign service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the ids
 * @returns What was deleted, and what was not
 */
export async function bulkDeleteCampaigns(
  service: CampaignService,
  context: McpContext,
  args: BulkCampaignIdsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'DELETE /campaigns/bulk');
    return service.bulkDelete(context.auth, resolveOrganizationId(context, organizationId), body);
  });
}

/**
 * Handler for `bulk-restore-campaigns`.
 *
 * @param service - Campaign service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the ids
 * @returns What was restored, and what was not
 */
export async function bulkRestoreCampaigns(
  service: CampaignService,
  context: McpContext,
  args: BulkCampaignIdsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'POST /campaigns/bulk/restore');
    return service.bulkRestore(context.auth, resolveOrganizationId(context, organizationId), body);
  });
}
