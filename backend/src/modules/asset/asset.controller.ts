import type { FastifyInstance } from 'fastify';

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
 * Assets controller: the bytes of an Advertiser's library, a resource of their own.
 *
 * Wires URL → schema → handler. Listing and uploading live **under the Advertiser** whose library it
 * is, the rest stays flat, since an id carries its own parents (`docs/phase-3.md` § 7).
 *
 * No bulk route: the creation of an asset **is** bytes, and one request carries one file
 * (`docs/phase-6.md` § 7).
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 */
export default async function AssetController(fastify: FastifyInstance): Promise<void> {
  fastify.route({ method: 'GET', url: '/advertisers/:id/assets', schema: listAssetsSchema, handler: listAssets });
  fastify.route({ method: 'POST', url: '/advertisers/:id/assets', schema: uploadAssetSchema, handler: uploadAsset });
  fastify.route({ method: 'GET', url: '/assets/:id', schema: getAssetSchema, handler: getAsset });
  fastify.route({ method: 'PATCH', url: '/assets/:id', schema: updateAssetSchema, handler: updateAsset });
  fastify.route({ method: 'DELETE', url: '/assets/:id', schema: deleteAssetSchema, handler: deleteAsset });
  fastify.route({ method: 'POST', url: '/assets/:id/restore', schema: restoreAssetSchema, handler: restoreAsset });
  fastify.route({ method: 'PUT', url: '/assets/:id/labels', schema: setAssetLabelsSchema, handler: setAssetLabels });
}
