import { mcpToolRateLimiter } from '@src/mcp/tool-rate-limit';
import { McpToolResult, resolveOrganizationId, runTool } from '@src/mcp/tool-result';
import { AdGroupService } from '@services';
import { McpContext } from '@src/types';
import {
  BulkAdGroupIdsInput,
  BulkCreateAdGroupsInput,
  BulkUpdateAdGroupsInput,
  AdGroupInput,
  CreateAdGroupInput,
  ListAdGroupsInput,
  SetAdGroupLabelsInput,
  UpdateAdGroupInput,
} from './ad-group.schema';

/**
 * Handler for `list-ad-groups`.
 *
 * @param service - AdGroup service
 * @param context - MCP context of the call
 * @param args - Organization, Lever, page, sort, search and Label filter
 * @returns A page of ad-groups
 */
export async function listAdGroups(
  service: AdGroupService,
  context: McpContext,
  args: ListAdGroupsInput
): Promise<McpToolResult> {
  const { organizationId, leverId, ...query } = args;
  return runTool(async () =>
    service.list(context.auth, resolveOrganizationId(context, organizationId), leverId, query)
  );
}

/**
 * Handler for `get-ad-group`.
 *
 * @param service - AdGroup service
 * @param context - MCP context of the call
 * @param args - Organization and adGroup
 * @returns The adGroup
 */
export async function getAdGroup(
  service: AdGroupService,
  context: McpContext,
  args: AdGroupInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.get(context.auth, resolveOrganizationId(context, args.organizationId), args.adGroupId)
  );
}

/**
 * Handler for `create-ad-group`.
 *
 * @param service - AdGroup service
 * @param context - MCP context of the call
 * @param args - Organization, Lever and what the adGroup carries
 * @returns The created adGroup
 */
export async function createAdGroup(
  service: AdGroupService,
  context: McpContext,
  args: CreateAdGroupInput
): Promise<McpToolResult> {
  const { organizationId, leverId, ...body } = args;
  return runTool(async () =>
    service.create(context.auth, resolveOrganizationId(context, organizationId), leverId, body)
  );
}

/**
 * Handler for `update-ad-group`.
 *
 * @param service - AdGroup service
 * @param context - MCP context of the call
 * @param args - Organization, adGroup and the fields to change
 * @returns The updated adGroup
 */
export async function updateAdGroup(
  service: AdGroupService,
  context: McpContext,
  args: UpdateAdGroupInput
): Promise<McpToolResult> {
  const { organizationId, adGroupId, ...body } = args;
  return runTool(async () =>
    service.update(context.auth, resolveOrganizationId(context, organizationId), adGroupId, body)
  );
}

/**
 * Handler for `delete-ad-group`.
 *
 * @param service - AdGroup service
 * @param context - MCP context of the call
 * @param args - Organization and adGroup
 * @returns Its id and when it was deleted
 */
export async function deleteAdGroup(
  service: AdGroupService,
  context: McpContext,
  args: AdGroupInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.delete(context.auth, resolveOrganizationId(context, args.organizationId), args.adGroupId)
  );
}

/**
 * Handler for `restore-ad-group`.
 *
 * @param service - AdGroup service
 * @param context - MCP context of the call
 * @param args - Organization and adGroup
 * @returns Its id, with `deletedAt` back to `null`
 */
export async function restoreAdGroup(
  service: AdGroupService,
  context: McpContext,
  args: AdGroupInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.restore(context.auth, resolveOrganizationId(context, args.organizationId), args.adGroupId)
  );
}

/**
 * Handler for `set-ad-group-labels`.
 *
 * @param service - AdGroup service
 * @param context - MCP context of the call
 * @param args - Organization, adGroup and the complete set of Label ids
 * @returns The adGroup, with the Labels it now carries
 */
export async function setAdGroupLabels(
  service: AdGroupService,
  context: McpContext,
  args: SetAdGroupLabelsInput
): Promise<McpToolResult> {
  const { organizationId, adGroupId, ...body } = args;
  return runTool(async () =>
    service.setLabels(context.auth, resolveOrganizationId(context, organizationId), adGroupId, body)
  );
}

/**
 * Handler for `bulk-create-ad-groups`.
 *
 * Counted against the limit of the route it mirrors: a bulk holds a connection and a transaction for
 * up to 200 items, whichever door it came through.
 *
 * @param service - AdGroup service
 * @param context - MCP context of the call
 * @param args - Organization, Lever, mode and the ad-groups to create
 * @returns What was created, and what was not
 */
export async function bulkCreateAdGroups(
  service: AdGroupService,
  context: McpContext,
  args: BulkCreateAdGroupsInput
): Promise<McpToolResult> {
  const { organizationId, leverId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'POST /levers/:id/ad-groups/bulk');
    return service.bulkCreate(context.auth, resolveOrganizationId(context, organizationId), leverId, body);
  });
}

/**
 * Handler for `bulk-update-ad-groups`.
 *
 * @param service - AdGroup service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the changes, each naming its adGroup
 * @returns What was changed, and what was not
 */
export async function bulkUpdateAdGroups(
  service: AdGroupService,
  context: McpContext,
  args: BulkUpdateAdGroupsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'PATCH /ad-groups/bulk');
    return service.bulkUpdate(context.auth, resolveOrganizationId(context, organizationId), body);
  });
}

/**
 * Handler for `bulk-delete-ad-groups`.
 *
 * @param service - AdGroup service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the ids
 * @returns What was deleted, and what was not
 */
export async function bulkDeleteAdGroups(
  service: AdGroupService,
  context: McpContext,
  args: BulkAdGroupIdsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'DELETE /ad-groups/bulk');
    return service.bulkDelete(context.auth, resolveOrganizationId(context, organizationId), body);
  });
}

/**
 * Handler for `bulk-restore-ad-groups`.
 *
 * @param service - AdGroup service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the ids
 * @returns What was restored, and what was not
 */
export async function bulkRestoreAdGroups(
  service: AdGroupService,
  context: McpContext,
  args: BulkAdGroupIdsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'POST /ad-groups/bulk/restore');
    return service.bulkRestore(context.auth, resolveOrganizationId(context, organizationId), body);
  });
}
