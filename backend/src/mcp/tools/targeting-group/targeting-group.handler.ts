import { mcpToolRateLimiter } from '@src/mcp/tool-rate-limit';
import { McpToolResult, resolveOrganizationId, runTool } from '@src/mcp/tool-result';
import { TargetingGroupService } from '@services';
import { McpContext } from '@src/types';
import {
  BulkTargetingGroupIdsInput,
  BulkCreateTargetingGroupsInput,
  BulkUpdateTargetingGroupsInput,
  TargetingGroupInput,
  CreateTargetingGroupInput,
  ListTargetingGroupsInput,
  SetTargetingGroupLabelsInput,
  UpdateTargetingGroupInput,
} from './targeting-group.schema';

/**
 * Handler for `list-targeting-groups`.
 *
 * @param service - TargetingGroup service
 * @param context - MCP context of the call
 * @param args - Organization, AdGroup, page, sort, search and Label filter
 * @returns A page of targeting-groups
 */
export async function listTargetingGroups(
  service: TargetingGroupService,
  context: McpContext,
  args: ListTargetingGroupsInput
): Promise<McpToolResult> {
  const { organizationId, adGroupId, ...query } = args;
  return runTool(async () =>
    service.list(context.auth, resolveOrganizationId(context, organizationId), adGroupId, query)
  );
}

/**
 * Handler for `get-targeting-group`.
 *
 * @param service - TargetingGroup service
 * @param context - MCP context of the call
 * @param args - Organization and targetingGroup
 * @returns The targetingGroup
 */
export async function getTargetingGroup(
  service: TargetingGroupService,
  context: McpContext,
  args: TargetingGroupInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.get(context.auth, resolveOrganizationId(context, args.organizationId), args.targetingGroupId)
  );
}

/**
 * Handler for `create-targeting-group`.
 *
 * @param service - TargetingGroup service
 * @param context - MCP context of the call
 * @param args - Organization, AdGroup and what the targetingGroup carries
 * @returns The created targetingGroup
 */
export async function createTargetingGroup(
  service: TargetingGroupService,
  context: McpContext,
  args: CreateTargetingGroupInput
): Promise<McpToolResult> {
  const { organizationId, adGroupId, ...body } = args;
  return runTool(async () =>
    service.create(context.auth, resolveOrganizationId(context, organizationId), adGroupId, body)
  );
}

/**
 * Handler for `update-targeting-group`.
 *
 * @param service - TargetingGroup service
 * @param context - MCP context of the call
 * @param args - Organization, targetingGroup and the fields to change
 * @returns The updated targetingGroup
 */
export async function updateTargetingGroup(
  service: TargetingGroupService,
  context: McpContext,
  args: UpdateTargetingGroupInput
): Promise<McpToolResult> {
  const { organizationId, targetingGroupId, ...body } = args;
  return runTool(async () =>
    service.update(context.auth, resolveOrganizationId(context, organizationId), targetingGroupId, body)
  );
}

/**
 * Handler for `delete-targeting-group`.
 *
 * @param service - TargetingGroup service
 * @param context - MCP context of the call
 * @param args - Organization and targetingGroup
 * @returns Its id and when it was deleted
 */
export async function deleteTargetingGroup(
  service: TargetingGroupService,
  context: McpContext,
  args: TargetingGroupInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.delete(context.auth, resolveOrganizationId(context, args.organizationId), args.targetingGroupId)
  );
}

/**
 * Handler for `restore-targeting-group`.
 *
 * @param service - TargetingGroup service
 * @param context - MCP context of the call
 * @param args - Organization and targetingGroup
 * @returns Its id, with `deletedAt` back to `null`
 */
export async function restoreTargetingGroup(
  service: TargetingGroupService,
  context: McpContext,
  args: TargetingGroupInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.restore(context.auth, resolveOrganizationId(context, args.organizationId), args.targetingGroupId)
  );
}

/**
 * Handler for `set-targeting-group-labels`.
 *
 * @param service - TargetingGroup service
 * @param context - MCP context of the call
 * @param args - Organization, targetingGroup and the complete set of Label ids
 * @returns The targetingGroup, with the Labels it now carries
 */
export async function setTargetingGroupLabels(
  service: TargetingGroupService,
  context: McpContext,
  args: SetTargetingGroupLabelsInput
): Promise<McpToolResult> {
  const { organizationId, targetingGroupId, ...body } = args;
  return runTool(async () =>
    service.setLabels(context.auth, resolveOrganizationId(context, organizationId), targetingGroupId, body)
  );
}

/**
 * Handler for `bulk-create-targeting-groups`.
 *
 * Counted against the limit of the route it mirrors: a bulk holds a connection and a transaction for
 * up to 200 items, whichever door it came through.
 *
 * @param service - TargetingGroup service
 * @param context - MCP context of the call
 * @param args - Organization, AdGroup, mode and the targeting-groups to create
 * @returns What was created, and what was not
 */
export async function bulkCreateTargetingGroups(
  service: TargetingGroupService,
  context: McpContext,
  args: BulkCreateTargetingGroupsInput
): Promise<McpToolResult> {
  const { organizationId, adGroupId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'POST /ad-groups/:id/targeting-groups/bulk');
    return service.bulkCreate(context.auth, resolveOrganizationId(context, organizationId), adGroupId, body);
  });
}

/**
 * Handler for `bulk-update-targeting-groups`.
 *
 * @param service - TargetingGroup service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the changes, each naming its targetingGroup
 * @returns What was changed, and what was not
 */
export async function bulkUpdateTargetingGroups(
  service: TargetingGroupService,
  context: McpContext,
  args: BulkUpdateTargetingGroupsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'PATCH /targeting-groups/bulk');
    return service.bulkUpdate(context.auth, resolveOrganizationId(context, organizationId), body);
  });
}

/**
 * Handler for `bulk-delete-targeting-groups`.
 *
 * @param service - TargetingGroup service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the ids
 * @returns What was deleted, and what was not
 */
export async function bulkDeleteTargetingGroups(
  service: TargetingGroupService,
  context: McpContext,
  args: BulkTargetingGroupIdsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'DELETE /targeting-groups/bulk');
    return service.bulkDelete(context.auth, resolveOrganizationId(context, organizationId), body);
  });
}

/**
 * Handler for `bulk-restore-targeting-groups`.
 *
 * @param service - TargetingGroup service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the ids
 * @returns What was restored, and what was not
 */
export async function bulkRestoreTargetingGroups(
  service: TargetingGroupService,
  context: McpContext,
  args: BulkTargetingGroupIdsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'POST /targeting-groups/bulk/restore');
    return service.bulkRestore(context.auth, resolveOrganizationId(context, organizationId), body);
  });
}
