import { creativeCatalog } from '@src/creatives/creative-formats';
import { mcpToolRateLimiter } from '@src/mcp/tool-rate-limit';
import { McpToolResult, resolveOrganizationId, runTool } from '@src/mcp/tool-result';
import { CreativeService } from '@services';
import { McpContext } from '@src/types';
import {
  BulkCreateCreativesInput,
  BulkCreativeIdsInput,
  BulkUpdateCreativesInput,
  CreateCreativeInput,
  CreateCreativeVersionInput,
  CreativeInput,
  CreativeVersionInput,
  ListCreativeVersionsInput,
  ListCreativesInput,
  SetCreativeLabelsInput,
  UpdateCreativeInput,
} from './creative.schema';

/**
 * Handler for `get-creative-formats`.
 *
 * @param _context - MCP context of the call, which the registry does not need
 * @returns The couples, with the JSON schema of each payload
 */
export async function getCreativeFormats(_context: McpContext): Promise<McpToolResult> {
  return runTool(async () => Promise.resolve({ couples: creativeCatalog() }));
}

/**
 * Handler for `list-creatives`.
 *
 * @param service - Creative service
 * @param context - MCP context of the call
 * @param args - Organization, Advertiser, page, sort, search and couple
 * @returns A page of creatives
 */
export async function listCreatives(
  service: CreativeService,
  context: McpContext,
  args: ListCreativesInput
): Promise<McpToolResult> {
  const { organizationId, advertiserId, ...query } = args;
  return runTool(async () =>
    service.list(context.auth, resolveOrganizationId(context, organizationId), advertiserId, query)
  );
}

/**
 * Handler for `get-creative`.
 *
 * @param service - Creative service
 * @param context - MCP context of the call
 * @param args - Organization and creative
 * @returns The creative, with the version that delivers
 */
export async function getCreative(
  service: CreativeService,
  context: McpContext,
  args: CreativeInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.get(context.auth, resolveOrganizationId(context, args.organizationId), args.creativeId)
  );
}

/**
 * Handler for `create-creative`.
 *
 * @param service - Creative service
 * @param context - MCP context of the call
 * @param args - Organization, Advertiser, the creative and its first version
 * @returns The created creative
 */
export async function createCreative(
  service: CreativeService,
  context: McpContext,
  args: CreateCreativeInput
): Promise<McpToolResult> {
  const { organizationId, advertiserId, ...body } = args;
  return runTool(async () =>
    service.create(context.auth, resolveOrganizationId(context, organizationId), advertiserId, body)
  );
}

/**
 * Handler for `update-creative`.
 *
 * @param service - Creative service
 * @param context - MCP context of the call
 * @param args - Organization, creative and what to change
 * @returns The updated creative
 */
export async function updateCreative(
  service: CreativeService,
  context: McpContext,
  args: UpdateCreativeInput
): Promise<McpToolResult> {
  const { organizationId, creativeId, ...body } = args;
  return runTool(async () =>
    service.update(context.auth, resolveOrganizationId(context, organizationId), creativeId, body)
  );
}

/**
 * Handler for `delete-creative`.
 *
 * @param service - Creative service
 * @param context - MCP context of the call
 * @param args - Organization and creative
 * @returns Its id and when it was deleted
 */
export async function deleteCreative(
  service: CreativeService,
  context: McpContext,
  args: CreativeInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.delete(context.auth, resolveOrganizationId(context, args.organizationId), args.creativeId)
  );
}

/**
 * Handler for `restore-creative`.
 *
 * @param service - Creative service
 * @param context - MCP context of the call
 * @param args - Organization and creative
 * @returns Its id, with `deletedAt` back to `null`
 */
export async function restoreCreative(
  service: CreativeService,
  context: McpContext,
  args: CreativeInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.restore(context.auth, resolveOrganizationId(context, args.organizationId), args.creativeId)
  );
}

/**
 * Handler for `set-creative-labels`.
 *
 * @param service - Creative service
 * @param context - MCP context of the call
 * @param args - Organization, creative and the complete set of labels
 * @returns The creative, with the labels it now carries
 */
export async function setCreativeLabels(
  service: CreativeService,
  context: McpContext,
  args: SetCreativeLabelsInput
): Promise<McpToolResult> {
  const { organizationId, creativeId, ...body } = args;
  return runTool(async () =>
    service.setLabels(context.auth, resolveOrganizationId(context, organizationId), creativeId, body)
  );
}

/**
 * Handler for `list-creative-versions`.
 *
 * @param service - Creative service
 * @param context - MCP context of the call
 * @param args - Organization, creative and page
 * @returns A page of versions
 */
export async function listCreativeVersions(
  service: CreativeService,
  context: McpContext,
  args: ListCreativeVersionsInput
): Promise<McpToolResult> {
  const { organizationId, creativeId, ...query } = args;
  return runTool(async () =>
    service.listVersions(context.auth, resolveOrganizationId(context, organizationId), creativeId, query)
  );
}

/**
 * Handler for `create-creative-version`.
 *
 * @param service - Creative service
 * @param context - MCP context of the call
 * @param args - Organization, creative, and the version to add
 * @returns The created version
 */
export async function createCreativeVersion(
  service: CreativeService,
  context: McpContext,
  args: CreateCreativeVersionInput
): Promise<McpToolResult> {
  const { organizationId, creativeId, ...body } = args;
  return runTool(async () =>
    service.createVersion(context.auth, resolveOrganizationId(context, organizationId), creativeId, body)
  );
}

/**
 * Handler for `get-creative-version`.
 *
 * @param service - Creative service
 * @param context - MCP context of the call
 * @param args - Organization and version
 * @returns The version, with its assets
 */
export async function getCreativeVersion(
  service: CreativeService,
  context: McpContext,
  args: CreativeVersionInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.getVersion(context.auth, resolveOrganizationId(context, args.organizationId), args.versionId)
  );
}

/**
 * Handler for `activate-creative-version`.
 *
 * @param service - Creative service
 * @param context - MCP context of the call
 * @param args - Organization and version
 * @returns The version, now active
 */
export async function activateCreativeVersion(
  service: CreativeService,
  context: McpContext,
  args: CreativeVersionInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.activateVersion(context.auth, resolveOrganizationId(context, args.organizationId), args.versionId)
  );
}

/**
 * Handler for `bulk-create-creatives`.
 *
 * @param service - Creative service
 * @param context - MCP context of the call
 * @param args - Organization, Advertiser, mode and the creatives to create
 * @returns What was created, and what was not
 */
export async function bulkCreateCreatives(
  service: CreativeService,
  context: McpContext,
  args: BulkCreateCreativesInput
): Promise<McpToolResult> {
  const { organizationId, advertiserId, ...body } = args;
  await mcpToolRateLimiter.consume(context, 'POST /advertisers/:id/creatives/bulk');
  return runTool(async () =>
    service.bulkCreate(context.auth, resolveOrganizationId(context, organizationId), advertiserId, body)
  );
}

/**
 * Handler for `bulk-update-creatives`.
 *
 * @param service - Creative service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the creatives to change
 * @returns What was changed, and what was not
 */
export async function bulkUpdateCreatives(
  service: CreativeService,
  context: McpContext,
  args: BulkUpdateCreativesInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  await mcpToolRateLimiter.consume(context, 'PATCH /creatives/bulk');
  return runTool(async () => service.bulkUpdate(context.auth, resolveOrganizationId(context, organizationId), body));
}

/**
 * Handler for `bulk-delete-creatives`.
 *
 * @param service - Creative service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the ids
 * @returns What was deleted, and what was not
 */
export async function bulkDeleteCreatives(
  service: CreativeService,
  context: McpContext,
  args: BulkCreativeIdsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  await mcpToolRateLimiter.consume(context, 'DELETE /creatives/bulk');
  return runTool(async () => service.bulkDelete(context.auth, resolveOrganizationId(context, organizationId), body));
}

/**
 * Handler for `bulk-restore-creatives`.
 *
 * @param service - Creative service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the ids
 * @returns What was restored, and what was not
 */
export async function bulkRestoreCreatives(
  service: CreativeService,
  context: McpContext,
  args: BulkCreativeIdsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  await mcpToolRateLimiter.consume(context, 'POST /creatives/bulk/restore');
  return runTool(async () => service.bulkRestore(context.auth, resolveOrganizationId(context, organizationId), body));
}
