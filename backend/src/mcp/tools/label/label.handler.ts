import { mcpToolRateLimiter } from '@src/mcp/tool-rate-limit';
import { McpToolResult, resolveOrganizationId, runTool } from '@src/mcp/tool-result';
import { LabelService } from '@services';
import { McpContext } from '@src/types';
import {
  BulkCreateLabelsInput,
  BulkLabelIdsInput,
  BulkUpdateLabelsInput,
  CreateLabelInput,
  LabelInput,
  ListLabelResourcesInput,
  ListLabelsInput,
  UpdateLabelInput,
} from './label.schema';

/**
 * Handler for `list-labels`.
 *
 * @param service - Label service
 * @param context - MCP context of the call
 * @param args - Organization, page, sort and search
 * @returns A page of Labels
 */
export async function listLabels(
  service: LabelService,
  context: McpContext,
  args: ListLabelsInput
): Promise<McpToolResult> {
  const { organizationId, ...query } = args;
  return runTool(async () => service.list(context.auth, resolveOrganizationId(context, organizationId), query));
}

/**
 * Handler for `get-label`.
 *
 * @param service - Label service
 * @param context - MCP context of the call
 * @param args - Organization and Label
 * @returns The Label
 */
export async function getLabel(service: LabelService, context: McpContext, args: LabelInput): Promise<McpToolResult> {
  return runTool(async () =>
    service.get(context.auth, resolveOrganizationId(context, args.organizationId), args.labelId)
  );
}

/**
 * Handler for `create-label`.
 *
 * @param service - Label service
 * @param context - MCP context of the call
 * @param args - Organization, name and colour
 * @returns The created Label
 */
export async function createLabel(
  service: LabelService,
  context: McpContext,
  args: CreateLabelInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => service.create(context.auth, resolveOrganizationId(context, organizationId), body));
}

/**
 * Handler for `update-label`.
 *
 * @param service - Label service
 * @param context - MCP context of the call
 * @param args - Organization, Label and the fields to change
 * @returns The updated Label
 */
export async function updateLabel(
  service: LabelService,
  context: McpContext,
  args: UpdateLabelInput
): Promise<McpToolResult> {
  const { organizationId, labelId, ...body } = args;
  return runTool(async () =>
    service.update(context.auth, resolveOrganizationId(context, organizationId), labelId, body)
  );
}

/**
 * Handler for `delete-label`.
 *
 * @param service - Label service
 * @param context - MCP context of the call
 * @param args - Organization and Label
 * @returns Its id and when it was deleted
 */
export async function deleteLabel(
  service: LabelService,
  context: McpContext,
  args: LabelInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.delete(context.auth, resolveOrganizationId(context, args.organizationId), args.labelId)
  );
}

/**
 * Handler for `restore-label`.
 *
 * @param service - Label service
 * @param context - MCP context of the call
 * @param args - Organization and Label
 * @returns Its id, with `deletedAt` back to `null`
 */
export async function restoreLabel(
  service: LabelService,
  context: McpContext,
  args: LabelInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.restore(context.auth, resolveOrganizationId(context, args.organizationId), args.labelId)
  );
}

/**
 * Handler for `list-label-resources`.
 *
 * @param service - Label service
 * @param context - MCP context of the call
 * @param args - Organization, Label and the page
 * @returns A page of what the Label marks
 */
export async function listLabelResources(
  service: LabelService,
  context: McpContext,
  args: ListLabelResourcesInput
): Promise<McpToolResult> {
  const { organizationId, labelId, ...query } = args;
  return runTool(async () =>
    service.resources(context.auth, resolveOrganizationId(context, organizationId), labelId, query)
  );
}

/**
 * Handler for `bulk-create-labels`.
 *
 * Counted against the limit of the route it mirrors: a bulk holds a connection and a transaction for
 * up to 200 items, whichever door it came through.
 *
 * @param service - Label service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the Labels to create
 * @returns What was created, and what was not
 */
export async function bulkCreateLabels(
  service: LabelService,
  context: McpContext,
  args: BulkCreateLabelsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'POST /labels/bulk');
    return service.bulkCreate(context.auth, resolveOrganizationId(context, organizationId), body);
  });
}

/**
 * Handler for `bulk-update-labels`.
 *
 * @param service - Label service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the changes, each naming its Label
 * @returns What was changed, and what was not
 */
export async function bulkUpdateLabels(
  service: LabelService,
  context: McpContext,
  args: BulkUpdateLabelsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'PATCH /labels/bulk');
    return service.bulkUpdate(context.auth, resolveOrganizationId(context, organizationId), body);
  });
}

/**
 * Handler for `bulk-delete-labels`.
 *
 * @param service - Label service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the ids
 * @returns What was deleted, and what was not
 */
export async function bulkDeleteLabels(
  service: LabelService,
  context: McpContext,
  args: BulkLabelIdsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'DELETE /labels/bulk');
    return service.bulkDelete(context.auth, resolveOrganizationId(context, organizationId), body);
  });
}

/**
 * Handler for `bulk-restore-labels`.
 *
 * @param service - Label service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the ids
 * @returns What was restored, and what was not
 */
export async function bulkRestoreLabels(
  service: LabelService,
  context: McpContext,
  args: BulkLabelIdsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'POST /labels/bulk/restore');
    return service.bulkRestore(context.auth, resolveOrganizationId(context, organizationId), body);
  });
}
