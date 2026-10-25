import { mcpToolRateLimiter } from '@src/mcp/tool-rate-limit';
import { McpToolResult, resolveOrganizationId, runTool } from '@src/mcp/tool-result';
import { ListService } from '@services';
import { McpContext } from '@src/types';
import {
  BulkCreateListsInput,
  BulkListIdsInput,
  BulkUpdateListsInput,
  CreateListInput,
  ListInput,
  ListListsInput,
  TransferListInput,
  UpdateListInput,
} from './list.schema';

/**
 * Handler for `list-lists`.
 *
 * @param service - List service
 * @param context - MCP context of the call
 * @param args - Organization, page, sort, search and kind
 * @returns A page of lists
 */
export async function listLists(
  service: ListService,
  context: McpContext,
  args: ListListsInput
): Promise<McpToolResult> {
  const { organizationId, ...query } = args;
  return runTool(async () => service.list(context.auth, resolveOrganizationId(context, organizationId), query));
}

/**
 * Handler for `get-list`.
 *
 * @param service - List service
 * @param context - MCP context of the call
 * @param args - Organization and list
 * @returns The list, with its items
 */
export async function getList(service: ListService, context: McpContext, args: ListInput): Promise<McpToolResult> {
  return runTool(async () =>
    service.get(context.auth, resolveOrganizationId(context, args.organizationId), args.listId)
  );
}

/**
 * Handler for `create-list`.
 *
 * @param service - List service
 * @param context - MCP context of the call
 * @param args - Organization, kind, name and items
 * @returns The created list
 */
export async function createList(
  service: ListService,
  context: McpContext,
  args: CreateListInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => service.create(context.auth, resolveOrganizationId(context, organizationId), body));
}

/**
 * Handler for `update-list`.
 *
 * @param service - List service
 * @param context - MCP context of the call
 * @param args - Organization, list and what to change
 * @returns The updated list
 */
export async function updateList(
  service: ListService,
  context: McpContext,
  args: UpdateListInput
): Promise<McpToolResult> {
  const { organizationId, listId, ...body } = args;
  return runTool(async () =>
    service.update(context.auth, resolveOrganizationId(context, organizationId), listId, body)
  );
}

/**
 * Handler for `delete-list`.
 *
 * @param service - List service
 * @param context - MCP context of the call
 * @param args - Organization and list
 * @returns Its id and when it was deleted
 */
export async function deleteList(service: ListService, context: McpContext, args: ListInput): Promise<McpToolResult> {
  return runTool(async () =>
    service.delete(context.auth, resolveOrganizationId(context, args.organizationId), args.listId)
  );
}

/**
 * Handler for `restore-list`.
 *
 * @param service - List service
 * @param context - MCP context of the call
 * @param args - Organization and list
 * @returns Its id, with `deletedAt` back to `null`
 */
export async function restoreList(service: ListService, context: McpContext, args: ListInput): Promise<McpToolResult> {
  return runTool(async () =>
    service.restore(context.auth, resolveOrganizationId(context, args.organizationId), args.listId)
  );
}

/**
 * Handler for `duplicate-list`.
 *
 * @param service - List service
 * @param context - MCP context of the call
 * @param args - Organization it comes from, the list, and the Organization it goes to
 * @returns The copy
 */
export async function duplicateList(
  service: ListService,
  context: McpContext,
  args: TransferListInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.duplicate(context.auth, resolveOrganizationId(context, args.organizationId), args.listId, {
      organizationId: args.targetOrganizationId,
    })
  );
}

/**
 * Handler for `move-list`.
 *
 * @param service - List service
 * @param context - MCP context of the call
 * @param args - Organization it comes from, the list, and the Organization it goes to
 * @returns The list in its new Organization
 */
export async function moveList(
  service: ListService,
  context: McpContext,
  args: TransferListInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.move(context.auth, resolveOrganizationId(context, args.organizationId), args.listId, {
      organizationId: args.targetOrganizationId,
    })
  );
}

/**
 * Handler for `bulk-create-lists`.
 *
 * @param service - List service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the lists to create
 * @returns What was created, and what was not
 */
export async function bulkCreateLists(
  service: ListService,
  context: McpContext,
  args: BulkCreateListsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  await mcpToolRateLimiter.consume(context, 'POST /lists/bulk');
  return runTool(async () => service.bulkCreate(context.auth, resolveOrganizationId(context, organizationId), body));
}

/**
 * Handler for `bulk-update-lists`.
 *
 * @param service - List service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the lists to change
 * @returns What was changed, and what was not
 */
export async function bulkUpdateLists(
  service: ListService,
  context: McpContext,
  args: BulkUpdateListsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  await mcpToolRateLimiter.consume(context, 'PATCH /lists/bulk');
  return runTool(async () => service.bulkUpdate(context.auth, resolveOrganizationId(context, organizationId), body));
}

/**
 * Handler for `bulk-delete-lists`.
 *
 * @param service - List service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the ids
 * @returns What was deleted, and what was not
 */
export async function bulkDeleteLists(
  service: ListService,
  context: McpContext,
  args: BulkListIdsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  await mcpToolRateLimiter.consume(context, 'DELETE /lists/bulk');
  return runTool(async () => service.bulkDelete(context.auth, resolveOrganizationId(context, organizationId), body));
}

/**
 * Handler for `bulk-restore-lists`.
 *
 * @param service - List service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the ids
 * @returns What was restored, and what was not
 */
export async function bulkRestoreLists(
  service: ListService,
  context: McpContext,
  args: BulkListIdsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  await mcpToolRateLimiter.consume(context, 'POST /lists/bulk/restore');
  return runTool(async () => service.bulkRestore(context.auth, resolveOrganizationId(context, organizationId), body));
}
