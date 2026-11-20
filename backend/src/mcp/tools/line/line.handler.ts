import { mcpToolRateLimiter } from '@src/mcp/tool-rate-limit';
import { McpToolResult, resolveOrganizationId, runTool } from '@src/mcp/tool-result';
import { LineService } from '@services';
import { McpContext } from '@src/types';
import {
  BulkLineIdsInput,
  BulkCreateLinesInput,
  BulkUpdateLinesInput,
  LineInput,
  CreateLineInput,
  ListCreativeLinesInput,
  ListLinesInput,
  SetLineLabelsInput,
  UpdateLineInput,
} from './line.schema';

/**
 * Handler for `list-lines`.
 *
 * @param service - Line service
 * @param context - MCP context of the call
 * @param args - Organization, TargetingGroup, page, sort, search and Label filter
 * @returns A page of lines
 */
export async function listLines(
  service: LineService,
  context: McpContext,
  args: ListLinesInput
): Promise<McpToolResult> {
  const { organizationId, targetingGroupId, ...query } = args;
  return runTool(async () =>
    service.list(context.auth, resolveOrganizationId(context, organizationId), targetingGroupId, query)
  );
}

/**
 * Handler for `list-creative-lines`.
 *
 * @param service - Line service
 * @param context - MCP context of the call
 * @param args - Organization, creative, page, sort, search and Label filter
 * @returns A page of lines, with the verdicts of their ads
 */
export async function listCreativeLines(
  service: LineService,
  context: McpContext,
  args: ListCreativeLinesInput
): Promise<McpToolResult> {
  const { organizationId, creativeId, ...query } = args;
  return runTool(async () =>
    service.listByCreative(context.auth, resolveOrganizationId(context, organizationId), creativeId, query)
  );
}

/**
 * Handler for `get-line`.
 *
 * @param service - Line service
 * @param context - MCP context of the call
 * @param args - Organization and line
 * @returns The line
 */
export async function getLine(service: LineService, context: McpContext, args: LineInput): Promise<McpToolResult> {
  return runTool(async () =>
    service.get(context.auth, resolveOrganizationId(context, args.organizationId), args.lineId)
  );
}

/**
 * Handler for `create-line`.
 *
 * @param service - Line service
 * @param context - MCP context of the call
 * @param args - Organization, TargetingGroup and what the line carries
 * @returns The created line
 */
export async function createLine(
  service: LineService,
  context: McpContext,
  args: CreateLineInput
): Promise<McpToolResult> {
  const { organizationId, targetingGroupId, ...body } = args;
  return runTool(async () =>
    service.create(context.auth, resolveOrganizationId(context, organizationId), targetingGroupId, body)
  );
}

/**
 * Handler for `update-line`.
 *
 * @param service - Line service
 * @param context - MCP context of the call
 * @param args - Organization, line and the fields to change
 * @returns The updated line
 */
export async function updateLine(
  service: LineService,
  context: McpContext,
  args: UpdateLineInput
): Promise<McpToolResult> {
  const { organizationId, lineId, ...body } = args;
  return runTool(async () =>
    service.update(context.auth, resolveOrganizationId(context, organizationId), lineId, body)
  );
}

/**
 * Handler for `delete-line`.
 *
 * @param service - Line service
 * @param context - MCP context of the call
 * @param args - Organization and line
 * @returns Its id and when it was deleted
 */
export async function deleteLine(service: LineService, context: McpContext, args: LineInput): Promise<McpToolResult> {
  return runTool(async () =>
    service.delete(context.auth, resolveOrganizationId(context, args.organizationId), args.lineId)
  );
}

/**
 * Handler for `restore-line`.
 *
 * @param service - Line service
 * @param context - MCP context of the call
 * @param args - Organization and line
 * @returns Its id, with `deletedAt` back to `null`
 */
export async function restoreLine(service: LineService, context: McpContext, args: LineInput): Promise<McpToolResult> {
  return runTool(async () =>
    service.restore(context.auth, resolveOrganizationId(context, args.organizationId), args.lineId)
  );
}

/**
 * Handler for `set-line-labels`.
 *
 * @param service - Line service
 * @param context - MCP context of the call
 * @param args - Organization, line and the complete set of Label ids
 * @returns The line, with the Labels it now carries
 */
export async function setLineLabels(
  service: LineService,
  context: McpContext,
  args: SetLineLabelsInput
): Promise<McpToolResult> {
  const { organizationId, lineId, ...body } = args;
  return runTool(async () =>
    service.setLabels(context.auth, resolveOrganizationId(context, organizationId), lineId, body)
  );
}

/**
 * Handler for `bulk-create-lines`.
 *
 * Counted against the limit of the route it mirrors: a bulk holds a connection and a transaction for
 * up to 200 items, whichever door it came through.
 *
 * @param service - Line service
 * @param context - MCP context of the call
 * @param args - Organization, TargetingGroup, mode and the lines to create
 * @returns What was created, and what was not
 */
export async function bulkCreateLines(
  service: LineService,
  context: McpContext,
  args: BulkCreateLinesInput
): Promise<McpToolResult> {
  const { organizationId, targetingGroupId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'POST /targeting-groups/:id/lines/bulk');
    return service.bulkCreate(context.auth, resolveOrganizationId(context, organizationId), targetingGroupId, body);
  });
}

/**
 * Handler for `bulk-update-lines`.
 *
 * @param service - Line service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the changes, each naming its line
 * @returns What was changed, and what was not
 */
export async function bulkUpdateLines(
  service: LineService,
  context: McpContext,
  args: BulkUpdateLinesInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'PATCH /lines/bulk');
    return service.bulkUpdate(context.auth, resolveOrganizationId(context, organizationId), body);
  });
}

/**
 * Handler for `bulk-delete-lines`.
 *
 * @param service - Line service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the ids
 * @returns What was deleted, and what was not
 */
export async function bulkDeleteLines(
  service: LineService,
  context: McpContext,
  args: BulkLineIdsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'DELETE /lines/bulk');
    return service.bulkDelete(context.auth, resolveOrganizationId(context, organizationId), body);
  });
}

/**
 * Handler for `bulk-restore-lines`.
 *
 * @param service - Line service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the ids
 * @returns What was restored, and what was not
 */
export async function bulkRestoreLines(
  service: LineService,
  context: McpContext,
  args: BulkLineIdsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'POST /lines/bulk/restore');
    return service.bulkRestore(context.auth, resolveOrganizationId(context, organizationId), body);
  });
}
