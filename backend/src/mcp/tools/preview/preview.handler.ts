import { McpToolResult, resolveOrganizationId, runTool } from '@src/mcp/tool-result';
import { PreviewService } from '@services';
import { McpContext, NodeLevel, SetNodeStatusBody } from '@src/types';
import {
  CampaignLifecycleInput,
  SetAdGroupStatusInput,
  SetCampaignStatusInput,
  SetLeverStatusInput,
  SetLineStatusInput,
  SetTargetingGroupStatusInput,
} from './preview.schema';

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

/**
 * Pause or activate one node, whichever tool named it.
 *
 * @param service - Preview service
 * @param context - MCP context of the call
 * @param level - The level of the node
 * @param id - The node
 * @param organizationId - The Organization, when the call names one
 * @param body - What it becomes
 * @returns The node and its status now
 */
async function setNodeStatus(
  service: PreviewService,
  context: McpContext,
  level: NodeLevel,
  id: string,
  organizationId: string | undefined,
  body: SetNodeStatusBody
): Promise<McpToolResult> {
  return runTool(async () =>
    service.setNodeStatus(context.auth, resolveOrganizationId(context, organizationId), level, id, body)
  );
}

/**
 * Handler for `set-lever-status`.
 *
 * @param service - Preview service
 * @param context - MCP context of the call
 * @param args - Organization, lever and status
 * @returns The lever and its status now
 */
export async function setLeverStatus(
  service: PreviewService,
  context: McpContext,
  args: SetLeverStatusInput
): Promise<McpToolResult> {
  return setNodeStatus(service, context, 'lever', args.leverId, args.organizationId, { status: args.status });
}

/**
 * Handler for `set-ad-group-status`.
 *
 * @param service - Preview service
 * @param context - MCP context of the call
 * @param args - Organization, AdGroup and status
 * @returns The AdGroup and its status now
 */
export async function setAdGroupStatus(
  service: PreviewService,
  context: McpContext,
  args: SetAdGroupStatusInput
): Promise<McpToolResult> {
  return setNodeStatus(service, context, 'ad_group', args.adGroupId, args.organizationId, { status: args.status });
}

/**
 * Handler for `set-targeting-group-status`.
 *
 * @param service - Preview service
 * @param context - MCP context of the call
 * @param args - Organization, TargetingGroup and status
 * @returns The TargetingGroup and its status now
 */
export async function setTargetingGroupStatus(
  service: PreviewService,
  context: McpContext,
  args: SetTargetingGroupStatusInput
): Promise<McpToolResult> {
  return setNodeStatus(service, context, 'targeting_group', args.targetingGroupId, args.organizationId, {
    status: args.status,
  });
}

/**
 * Handler for `set-line-status`.
 *
 * @param service - Preview service
 * @param context - MCP context of the call
 * @param args - Organization, Line and status
 * @returns The Line and its status now
 */
export async function setLineStatus(
  service: PreviewService,
  context: McpContext,
  args: SetLineStatusInput
): Promise<McpToolResult> {
  return setNodeStatus(service, context, 'line', args.lineId, args.organizationId, { status: args.status });
}
