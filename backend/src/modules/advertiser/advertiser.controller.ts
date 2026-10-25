import type { FastifyInstance } from 'fastify';

import {
  bulkCreateAdvertisers,
  bulkDeleteAdvertisers,
  bulkRestoreAdvertisers,
  bulkUpdateAdvertisers,
  createAdvertiser,
  deleteAdvertiser,
  getAdvertiser,
  listAdvertisers,
  restoreAdvertiser,
  setAdvertiserLabels,
  updateAdvertiser,
} from './advertiser.handler';
import {
  bulkCreateAdvertisersSchema,
  bulkDeleteAdvertisersSchema,
  bulkRestoreAdvertisersSchema,
  bulkUpdateAdvertisersSchema,
  createAdvertiserSchema,
  deleteAdvertiserSchema,
  getAdvertiserSchema,
  listAdvertisersSchema,
  restoreAdvertiserSchema,
  setAdvertiserLabelsSchema,
  updateAdvertiserSchema,
} from './advertiser.schema';

/**
 * Advertisers controller: the brands of the Organization named by `X-Organization-Id`.
 *
 * Wires URL → schema → handler. No business logic and no inline schemas; the role each route
 * requires is asserted by the service, so HTTP, MCP and jobs share one rule.
 *
 * The `bulk` URLs are static, so Fastify's router prefers them to `/:id` whatever the order they are
 * registered in.
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 */
export default async function AdvertiserController(fastify: FastifyInstance): Promise<void> {
  fastify.route({ method: 'GET', url: '/advertisers', schema: listAdvertisersSchema, handler: listAdvertisers });
  fastify.route({ method: 'POST', url: '/advertisers', schema: createAdvertiserSchema, handler: createAdvertiser });
  fastify.route({
    method: 'POST',
    url: '/advertisers/bulk',
    schema: bulkCreateAdvertisersSchema,
    handler: bulkCreateAdvertisers,
  });
  fastify.route({
    method: 'PATCH',
    url: '/advertisers/bulk',
    schema: bulkUpdateAdvertisersSchema,
    handler: bulkUpdateAdvertisers,
  });
  fastify.route({
    method: 'DELETE',
    url: '/advertisers/bulk',
    schema: bulkDeleteAdvertisersSchema,
    handler: bulkDeleteAdvertisers,
  });
  fastify.route({
    method: 'POST',
    url: '/advertisers/bulk/restore',
    schema: bulkRestoreAdvertisersSchema,
    handler: bulkRestoreAdvertisers,
  });
  fastify.route({ method: 'GET', url: '/advertisers/:id', schema: getAdvertiserSchema, handler: getAdvertiser });
  fastify.route({
    method: 'PATCH',
    url: '/advertisers/:id',
    schema: updateAdvertiserSchema,
    handler: updateAdvertiser,
  });
  fastify.route({
    method: 'DELETE',
    url: '/advertisers/:id',
    schema: deleteAdvertiserSchema,
    handler: deleteAdvertiser,
  });
  fastify.route({
    method: 'POST',
    url: '/advertisers/:id/restore',
    schema: restoreAdvertiserSchema,
    handler: restoreAdvertiser,
  });
  fastify.route({
    method: 'PUT',
    url: '/advertisers/:id/labels',
    schema: setAdvertiserLabelsSchema,
    handler: setAdvertiserLabels,
  });
}
