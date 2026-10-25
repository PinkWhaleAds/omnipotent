import { McpToolResult, resolveOrganizationId, runTool } from '@src/mcp/tool-result';
import { LeverService } from '@services';
import { McpContext } from '@src/types';
import { LeverInput, CreateLeverInput, ListLeversInput, SetLeverLabelsInput, UpdateLeverInput } from './lever.schema';

/**
 * Handler for `list-levers`.
 *
 * @param service - Lever service
 * @param context - MCP context of the call
 * @param args - Organization, Campaign, page, sort and Label filter
 * @returns A page of levers
 */
export async function listLevers(
  service: LeverService,
  context: McpContext,
  args: ListLeversInput
): Promise<McpToolResult> {
  const { organizationId, campaignId, ...query } = args;
  return runTool(async () =>
    service.list(context.auth, resolveOrganizationId(context, organizationId), campaignId, query)
  );
}

/**
 * Handler for `get-lever`.
 *
 * @param service - Lever service
 * @param context - MCP context of the call
 * @param args - Organization and lever
 * @returns The lever
 */
export async function getLever(service: LeverService, context: McpContext, args: LeverInput): Promise<McpToolResult> {
  return runTool(async () =>
    service.get(context.auth, resolveOrganizationId(context, args.organizationId), args.leverId)
  );
}

/**
 * Handler for `create-lever`.
 *
 * @param service - Lever service
 * @param context - MCP context of the call
 * @param args - Organization, Campaign, the channel and what the lever carries
 * @returns The created lever
 */
export async function createLever(
  service: LeverService,
  context: McpContext,
  args: CreateLeverInput
): Promise<McpToolResult> {
  const { organizationId, campaignId, ...body } = args;
  return runTool(async () =>
    service.create(context.auth, resolveOrganizationId(context, organizationId), campaignId, body)
  );
}

/**
 * Handler for `update-lever`.
 *
 * @param service - Lever service
 * @param context - MCP context of the call
 * @param args - Organization, lever and the fields to change
 * @returns The updated lever
 */
export async function updateLever(
  service: LeverService,
  context: McpContext,
  args: UpdateLeverInput
): Promise<McpToolResult> {
  const { organizationId, leverId, ...body } = args;
  return runTool(async () =>
    service.update(context.auth, resolveOrganizationId(context, organizationId), leverId, body)
  );
}

/**
 * Handler for `delete-lever`.
 *
 * @param service - Lever service
 * @param context - MCP context of the call
 * @param args - Organization and lever
 * @returns Its id and when it was deleted
 */
export async function deleteLever(
  service: LeverService,
  context: McpContext,
  args: LeverInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.delete(context.auth, resolveOrganizationId(context, args.organizationId), args.leverId)
  );
}

/**
 * Handler for `restore-lever`.
 *
 * @param service - Lever service
 * @param context - MCP context of the call
 * @param args - Organization and lever
 * @returns Its id, with `deletedAt` back to `null`
 */
export async function restoreLever(
  service: LeverService,
  context: McpContext,
  args: LeverInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.restore(context.auth, resolveOrganizationId(context, args.organizationId), args.leverId)
  );
}

/**
 * Handler for `set-lever-labels`.
 *
 * @param service - Lever service
 * @param context - MCP context of the call
 * @param args - Organization, lever and the complete set of Label ids
 * @returns The lever, with the Labels it now carries
 */
export async function setLeverLabels(
  service: LeverService,
  context: McpContext,
  args: SetLeverLabelsInput
): Promise<McpToolResult> {
  const { organizationId, leverId, ...body } = args;
  return runTool(async () =>
    service.setLabels(context.auth, resolveOrganizationId(context, organizationId), leverId, body)
  );
}
