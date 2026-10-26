import { mcpToolRateLimiter } from '@src/mcp/tool-rate-limit';
import { McpToolResult, resolveOrganizationId, runTool } from '@src/mcp/tool-result';
import { AssetService, UploadedAsset } from '@services';
import { McpContext } from '@src/types';
import {
  AssetInput,
  ListAssetsInput,
  SetAssetLabelsInput,
  UpdateAssetInput,
  UploadAssetToolInput,
} from './asset.schema';

/**
 * Handler for `list-assets`.
 *
 * @param service - Asset service
 * @param context - MCP context of the call
 * @param args - Organization, Advertiser, page, sort, search, kind and labels
 * @returns A page of assets
 */
export async function listAssets(
  service: AssetService,
  context: McpContext,
  args: ListAssetsInput
): Promise<McpToolResult> {
  const { organizationId, advertiserId, ...query } = args;
  return runTool(async () =>
    service.list(context.auth, resolveOrganizationId(context, organizationId), advertiserId, query)
  );
}

/**
 * Handler for `get-asset`.
 *
 * @param service - Asset service
 * @param context - MCP context of the call
 * @param args - Organization and asset
 * @returns The asset
 */
export async function getAsset(service: AssetService, context: McpContext, args: AssetInput): Promise<McpToolResult> {
  return runTool(async () =>
    service.get(context.auth, resolveOrganizationId(context, args.organizationId), args.assetId)
  );
}

/**
 * Handler for `upload-asset`.
 *
 * Counted against the rate limit of the route it mirrors: megabytes travel here, encoded.
 *
 * @param service - Asset service
 * @param context - MCP context of the call
 * @param args - Organization, Advertiser, the file and what the caller says about it
 * @returns The asset the library now holds for those bytes
 */
export async function uploadAsset(
  service: AssetService,
  context: McpContext,
  args: UploadAssetToolInput
): Promise<McpToolResult> {
  const { organizationId, advertiserId, base64, ...rest } = args;
  await mcpToolRateLimiter.consume(context, 'POST /advertisers/:id/assets');
  return runTool(async () => {
    const uploaded: UploadedAsset = await service.upload(
      context.auth,
      resolveOrganizationId(context, organizationId),
      advertiserId,
      { ...rest, data: Buffer.from(base64, 'base64') }
    );
    return uploaded.asset;
  });
}

/**
 * Handler for `update-asset`.
 *
 * @param service - Asset service
 * @param context - MCP context of the call
 * @param args - Organization, asset and the new name
 * @returns The updated asset
 */
export async function updateAsset(
  service: AssetService,
  context: McpContext,
  args: UpdateAssetInput
): Promise<McpToolResult> {
  const { organizationId, assetId, ...body } = args;
  return runTool(async () =>
    service.update(context.auth, resolveOrganizationId(context, organizationId), assetId, body)
  );
}

/**
 * Handler for `delete-asset`.
 *
 * @param service - Asset service
 * @param context - MCP context of the call
 * @param args - Organization and asset
 * @returns Its id and when it was deleted
 */
export async function deleteAsset(
  service: AssetService,
  context: McpContext,
  args: AssetInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.delete(context.auth, resolveOrganizationId(context, args.organizationId), args.assetId)
  );
}

/**
 * Handler for `restore-asset`.
 *
 * @param service - Asset service
 * @param context - MCP context of the call
 * @param args - Organization and asset
 * @returns Its id, with `deletedAt` back to `null`
 */
export async function restoreAsset(
  service: AssetService,
  context: McpContext,
  args: AssetInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.restore(context.auth, resolveOrganizationId(context, args.organizationId), args.assetId)
  );
}

/**
 * Handler for `set-asset-labels`.
 *
 * @param service - Asset service
 * @param context - MCP context of the call
 * @param args - Organization, asset and the complete set of labels
 * @returns The asset, with the labels it now carries
 */
export async function setAssetLabels(
  service: AssetService,
  context: McpContext,
  args: SetAssetLabelsInput
): Promise<McpToolResult> {
  const { organizationId, assetId, ...body } = args;
  return runTool(async () =>
    service.setLabels(context.auth, resolveOrganizationId(context, organizationId), assetId, body)
  );
}
