import type { FastifyInstance } from 'fastify';

import {
  bulkCreateAdGroups,
  bulkDeleteAdGroups,
  bulkRestoreAdGroups,
  bulkUpdateAdGroups,
  createAdGroup,
  deleteAdGroup,
  getAdGroup,
  listAdGroups,
  restoreAdGroup,
  setAdGroupLabels,
  updateAdGroup,
} from './ad-group.handler';
import {
  bulkCreateAdGroupsSchema,
  bulkDeleteAdGroupsSchema,
  bulkRestoreAdGroupsSchema,
  bulkUpdateAdGroupsSchema,
  createAdGroupSchema,
  deleteAdGroupSchema,
  getAdGroupSchema,
  listAdGroupsSchema,
  restoreAdGroupSchema,
  setAdGroupLabelsSchema,
  updateAdGroupSchema,
} from './ad-group.schema';

/**
 * AdGroups controller: the level the platforms carry a budget on, under its Lever.
 *
 * Wires URL → schema → handler. Listing and creating live **under the parent**, reading, changing
 * and deleting live **flat** on the resource, since an id carries its own parents
 * (`docs/phase-3.md` § 7).
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 */
export default async function AdGroupController(fastify: FastifyInstance): Promise<void> {
  fastify.route({
    method: 'GET',
    url: '/levers/:id/ad-groups',
    schema: listAdGroupsSchema,
    handler: listAdGroups,
  });
  fastify.route({
    method: 'POST',
    url: '/levers/:id/ad-groups',
    schema: createAdGroupSchema,
    handler: createAdGroup,
  });
  fastify.route({
    method: 'POST',
    url: '/levers/:id/ad-groups/bulk',
    schema: bulkCreateAdGroupsSchema,
    handler: bulkCreateAdGroups,
  });
  fastify.route({
    method: 'PATCH',
    url: '/ad-groups/bulk',
    schema: bulkUpdateAdGroupsSchema,
    handler: bulkUpdateAdGroups,
  });
  fastify.route({
    method: 'DELETE',
    url: '/ad-groups/bulk',
    schema: bulkDeleteAdGroupsSchema,
    handler: bulkDeleteAdGroups,
  });
  fastify.route({
    method: 'POST',
    url: '/ad-groups/bulk/restore',
    schema: bulkRestoreAdGroupsSchema,
    handler: bulkRestoreAdGroups,
  });
  fastify.route({ method: 'GET', url: '/ad-groups/:id', schema: getAdGroupSchema, handler: getAdGroup });
  fastify.route({ method: 'PATCH', url: '/ad-groups/:id', schema: updateAdGroupSchema, handler: updateAdGroup });
  fastify.route({ method: 'DELETE', url: '/ad-groups/:id', schema: deleteAdGroupSchema, handler: deleteAdGroup });
  fastify.route({
    method: 'POST',
    url: '/ad-groups/:id/restore',
    schema: restoreAdGroupSchema,
    handler: restoreAdGroup,
  });
  fastify.route({
    method: 'PUT',
    url: '/ad-groups/:id/labels',
    schema: setAdGroupLabelsSchema,
    handler: setAdGroupLabels,
  });
}
