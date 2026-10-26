import { McpToolResult, resolveOrganizationId, runTool } from '@src/mcp/tool-result';
import { PreviewService } from '@services';
import { McpContext } from '@src/types';
import { CampaignLifecycleInput, SetCampaignStatusInput } from './preview.schema';

/**
 * Handler for `preview-campaign`.
 *
 * @param service - Preview service
 * @param context - MCP context of the call
 * @param args - Organization and campaign
 * @returns What each platform receives, and the findings
 */
export async function previewCampaign(
  service: PreviewService,
  context: McpContext,
  args: CampaignLifecycleInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.preview(context.auth, resolveOrganizationId(context, args.organizationId), args.campaignId)
  );
}

/**
 * Handler for `launch-campaign`.
 *
 * @param service - Preview service
 * @param context - MCP context of the call
 * @param args - Organization and campaign
 * @returns The campaign, now active
 */
export async function launchCampaign(
  service: PreviewService,
  context: McpContext,
  args: CampaignLifecycleInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.launch(context.auth, resolveOrganizationId(context, args.organizationId), args.campaignId)
  );
}

/**
 * Handler for `set-campaign-status`.
 *
 * @param service - Preview service
 * @param context - MCP context of the call
 * @param args - Organization, campaign and where it goes
 * @returns The campaign in its new state
 */
export async function setCampaignStatus(
  service: PreviewService,
  context: McpContext,
  args: SetCampaignStatusInput
): Promise<McpToolResult> {
  const { organizationId, campaignId, ...body } = args;
  return runTool(async () =>
    service.setStatus(context.auth, resolveOrganizationId(context, organizationId), campaignId, body)
  );
}
