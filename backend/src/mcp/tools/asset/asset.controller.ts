import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpContext } from '@src/types';
import {
  deleteAsset,
  getAsset,
  listAssets,
  restoreAsset,
  setAssetLabels,
  updateAsset,
  uploadAsset,
} from './asset.handler';
import {
  deleteAssetSchema,
  getAssetSchema,
  listAssetsSchema,
  restoreAssetSchema,
  setAssetLabelsSchema,
  updateAssetSchema,
  uploadAssetSchema,
} from './asset.schema';

/**
 * Asset tools controller: one tool per route of the assets (D21).
 *
 * Wires tool name → schema → handler. No business logic and no inline schemas.
 *
 * @param server - The MCP server to register tools on
 * @param fastify - The Fastify instance providing decorated services
 * @param context - Caller of the MCP request
 */
export default function AssetToolsController(server: McpServer, fastify: FastifyInstance, context: McpContext): void {
  server.registerTool('list-assets', listAssetsSchema, async (args) => listAssets(fastify.assetService, context, args));
  server.registerTool('get-asset', getAssetSchema, async (args) => getAsset(fastify.assetService, context, args));
  server.registerTool('upload-asset', uploadAssetSchema, async (args) =>
    uploadAsset(fastify.assetService, context, args)
  );
  server.registerTool('update-asset', updateAssetSchema, async (args) =>
    updateAsset(fastify.assetService, context, args)
  );
  server.registerTool('delete-asset', deleteAssetSchema, async (args) =>
    deleteAsset(fastify.assetService, context, args)
  );
  server.registerTool('restore-asset', restoreAssetSchema, async (args) =>
    restoreAsset(fastify.assetService, context, args)
  );
  server.registerTool('set-asset-labels', setAssetLabelsSchema, async (args) =>
    setAssetLabels(fastify.assetService, context, args)
  );
}
