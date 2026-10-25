import { mcpToolRateLimiter } from '@src/mcp/tool-rate-limit';
import { McpToolResult, resolveOrganizationId, runTool } from '@src/mcp/tool-result';
import { AdvertiserService } from '@services';
import { McpContext } from '@src/types';
import {
  AdvertiserInput,
  BulkAdvertiserIdsInput,
  BulkCreateAdvertisersInput,
  BulkUpdateAdvertisersInput,
  CreateAdvertiserInput,
  ListAdvertisersInput,
  SetAdvertiserLabelsInput,
  UpdateAdvertiserInput,
} from './advertiser.schema';

/**
 * Handler for `list-advertisers`.
 *
 * @param service - Advertiser service
 * @param context - MCP context of the call
 * @param args - Organization, page, sort, search and Label filter
 * @returns A page of Advertisers
 */
export async function listAdvertisers(
  service: AdvertiserService,
  context: McpContext,
  args: ListAdvertisersInput
): Promise<McpToolResult> {
  const { organizationId, ...query } = args;
  return runTool(async () => service.list(context.auth, resolveOrganizationId(context, organizationId), query));
}

/**
 * Handler for `get-advertiser`.
 *
 * @param service - Advertiser service
 * @param context - MCP context of the call
 * @param args - Organization and Advertiser
 * @returns The Advertiser
 */
export async function getAdvertiser(
  service: AdvertiserService,
  context: McpContext,
  args: AdvertiserInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.get(context.auth, resolveOrganizationId(context, args.organizationId), args.advertiserId)
  );
}

/**
 * Handler for `create-advertiser`.
 *
 * @param service - Advertiser service
 * @param context - MCP context of the call
 * @param args - Organization, name, website and Labels
 * @returns The created Advertiser
 */
export async function createAdvertiser(
  service: AdvertiserService,
  context: McpContext,
  args: CreateAdvertiserInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => service.create(context.auth, resolveOrganizationId(context, organizationId), body));
}

/**
 * Handler for `update-advertiser`.
 *
 * @param service - Advertiser service
 * @param context - MCP context of the call
 * @param args - Organization, Advertiser and the fields to change
 * @returns The updated Advertiser
 */
export async function updateAdvertiser(
  service: AdvertiserService,
  context: McpContext,
  args: UpdateAdvertiserInput
): Promise<McpToolResult> {
  const { organizationId, advertiserId, ...body } = args;
  return runTool(async () =>
    service.update(context.auth, resolveOrganizationId(context, organizationId), advertiserId, body)
  );
}

/**
 * Handler for `delete-advertiser`.
 *
 * @param service - Advertiser service
 * @param context - MCP context of the call
 * @param args - Organization and Advertiser
 * @returns Its id and when it was deleted
 */
export async function deleteAdvertiser(
  service: AdvertiserService,
  context: McpContext,
  args: AdvertiserInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.delete(context.auth, resolveOrganizationId(context, args.organizationId), args.advertiserId)
  );
}

/**
 * Handler for `restore-advertiser`.
 *
 * @param service - Advertiser service
 * @param context - MCP context of the call
 * @param args - Organization and Advertiser
 * @returns Its id, with `deletedAt` back to `null`
 */
export async function restoreAdvertiser(
  service: AdvertiserService,
  context: McpContext,
  args: AdvertiserInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.restore(context.auth, resolveOrganizationId(context, args.organizationId), args.advertiserId)
  );
}

/**
 * Handler for `set-advertiser-labels`.
 *
 * @param service - Advertiser service
 * @param context - MCP context of the call
 * @param args - Organization, Advertiser and the complete set of Label ids
 * @returns The Advertiser, with the Labels it now carries
 */
export async function setAdvertiserLabels(
  service: AdvertiserService,
  context: McpContext,
  args: SetAdvertiserLabelsInput
): Promise<McpToolResult> {
  const { organizationId, advertiserId, ...body } = args;
  return runTool(async () =>
    service.setLabels(context.auth, resolveOrganizationId(context, organizationId), advertiserId, body)
  );
}

/**
 * Handler for `bulk-create-advertisers`.
 *
 * Counted against the limit of the route it mirrors: a bulk holds a connection and a transaction for
 * up to 200 items, whichever door it came through.
 *
 * @param service - Advertiser service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the Advertisers to create
 * @returns What was created, and what was not
 */
export async function bulkCreateAdvertisers(
  service: AdvertiserService,
  context: McpContext,
  args: BulkCreateAdvertisersInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'POST /advertisers/bulk');
    return service.bulkCreate(context.auth, resolveOrganizationId(context, organizationId), body);
  });
}

/**
 * Handler for `bulk-update-advertisers`.
 *
 * @param service - Advertiser service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the changes, each naming its Advertiser
 * @returns What was changed, and what was not
 */
export async function bulkUpdateAdvertisers(
  service: AdvertiserService,
  context: McpContext,
  args: BulkUpdateAdvertisersInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'PATCH /advertisers/bulk');
    return service.bulkUpdate(context.auth, resolveOrganizationId(context, organizationId), body);
  });
}

/**
 * Handler for `bulk-delete-advertisers`.
 *
 * @param service - Advertiser service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the ids
 * @returns What was deleted, and what was not
 */
export async function bulkDeleteAdvertisers(
  service: AdvertiserService,
  context: McpContext,
  args: BulkAdvertiserIdsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'DELETE /advertisers/bulk');
    return service.bulkDelete(context.auth, resolveOrganizationId(context, organizationId), body);
  });
}

/**
 * Handler for `bulk-restore-advertisers`.
 *
 * @param service - Advertiser service
 * @param context - MCP context of the call
 * @param args - Organization, mode and the ids
 * @returns What was restored, and what was not
 */
export async function bulkRestoreAdvertisers(
  service: AdvertiserService,
  context: McpContext,
  args: BulkAdvertiserIdsInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => {
    mcpToolRateLimiter.consume(context, 'POST /advertisers/bulk/restore');
    return service.bulkRestore(context.auth, resolveOrganizationId(context, organizationId), body);
  });
}
