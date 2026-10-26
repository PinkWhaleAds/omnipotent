import type { FastifyInstance } from 'fastify';

import {
  activateCreativeVersion,
  bulkCreateCreatives,
  bulkDeleteCreatives,
  bulkRestoreCreatives,
  bulkUpdateCreatives,
  createCreative,
  createCreativeVersion,
  deleteCreative,
  getCreative,
  getCreativeFormats,
  getCreativeVersion,
  listCreativeVersions,
  listCreatives,
  restoreCreative,
  setCreativeLabels,
  updateCreative,
} from './creative.handler';
import {
  activateCreativeVersionSchema,
  bulkCreateCreativesSchema,
  bulkDeleteCreativesSchema,
  bulkRestoreCreativesSchema,
  bulkUpdateCreativesSchema,
  createCreativeSchema,
  createCreativeVersionSchema,
  deleteCreativeSchema,
  getCreativeFormatsSchema,
  getCreativeSchema,
  getCreativeVersionSchema,
  listCreativeVersionsSchema,
  listCreativesSchema,
  restoreCreativeSchema,
  setCreativeLabelsSchema,
  updateCreativeSchema,
} from './creative.schema';

/**
 * Creatives controller: the library of an Advertiser, and the immutable versions of each creative.
 *
 * Wires URL → schema → handler. Listing and creating live **under the Advertiser**, the rest stays
 * flat; the versions hang from their creative, and one is read and activated by its own id, since an
 * id carries its parents (`docs/phase-3.md` § 7).
 *
 * The bulk routes are declared **before** `/creatives/:id`, so `bulk` is never read as an id.
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 */
export default async function CreativeController(fastify: FastifyInstance): Promise<void> {
  fastify.route({
    method: 'GET',
    url: '/creative-formats',
    schema: getCreativeFormatsSchema,
    handler: getCreativeFormats,
  });
  fastify.route({
    method: 'GET',
    url: '/advertisers/:id/creatives',
    schema: listCreativesSchema,
    handler: listCreatives,
  });
  fastify.route({
    method: 'POST',
    url: '/advertisers/:id/creatives',
    schema: createCreativeSchema,
    handler: createCreative,
  });
  fastify.route({
    method: 'POST',
    url: '/advertisers/:id/creatives/bulk',
    schema: bulkCreateCreativesSchema,
    handler: bulkCreateCreatives,
  });
  fastify.route({
    method: 'PATCH',
    url: '/creatives/bulk',
    schema: bulkUpdateCreativesSchema,
    handler: bulkUpdateCreatives,
  });
  fastify.route({
    method: 'DELETE',
    url: '/creatives/bulk',
    schema: bulkDeleteCreativesSchema,
    handler: bulkDeleteCreatives,
  });
  fastify.route({
    method: 'POST',
    url: '/creatives/bulk/restore',
    schema: bulkRestoreCreativesSchema,
    handler: bulkRestoreCreatives,
  });
  fastify.route({ method: 'GET', url: '/creatives/:id', schema: getCreativeSchema, handler: getCreative });
  fastify.route({ method: 'PATCH', url: '/creatives/:id', schema: updateCreativeSchema, handler: updateCreative });
  fastify.route({ method: 'DELETE', url: '/creatives/:id', schema: deleteCreativeSchema, handler: deleteCreative });
  fastify.route({
    method: 'POST',
    url: '/creatives/:id/restore',
    schema: restoreCreativeSchema,
    handler: restoreCreative,
  });
  fastify.route({
    method: 'PUT',
    url: '/creatives/:id/labels',
    schema: setCreativeLabelsSchema,
    handler: setCreativeLabels,
  });
  fastify.route({
    method: 'GET',
    url: '/creatives/:id/versions',
    schema: listCreativeVersionsSchema,
    handler: listCreativeVersions,
  });
  fastify.route({
    method: 'POST',
    url: '/creatives/:id/versions',
    schema: createCreativeVersionSchema,
    handler: createCreativeVersion,
  });
  fastify.route({
    method: 'GET',
    url: '/creative-versions/:id',
    schema: getCreativeVersionSchema,
    handler: getCreativeVersion,
  });
  fastify.route({
    method: 'POST',
    url: '/creative-versions/:id/activate',
    schema: activateCreativeVersionSchema,
    handler: activateCreativeVersion,
  });
}
