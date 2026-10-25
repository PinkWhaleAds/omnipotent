import type { FastifyInstance } from 'fastify';

import {
  bulkCreateTargetingGroups,
  bulkDeleteTargetingGroups,
  bulkRestoreTargetingGroups,
  bulkUpdateTargetingGroups,
  createTargetingGroup,
  deleteTargetingGroup,
  getTargetingGroup,
  listTargetingGroups,
  restoreTargetingGroup,
  setTargetingGroupLabels,
  updateTargetingGroup,
} from './targeting-group.handler';
import {
  bulkCreateTargetingGroupsSchema,
  bulkDeleteTargetingGroupsSchema,
  bulkRestoreTargetingGroupsSchema,
  bulkUpdateTargetingGroupsSchema,
  createTargetingGroupSchema,
  deleteTargetingGroupSchema,
  getTargetingGroupSchema,
  listTargetingGroupsSchema,
  restoreTargetingGroupSchema,
  setTargetingGroupLabelsSchema,
  updateTargetingGroupSchema,
} from './targeting-group.schema';

/**
 * TargetingGroups controller: all the targeting, under its AdGroup.
 *
 * Wires URL → schema → handler. Listing and creating live **under the parent**, reading, changing
 * and deleting live **flat** on the resource, since an id carries its own parents
 * (`docs/phase-3.md` § 7).
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 */
export default async function TargetingGroupController(fastify: FastifyInstance): Promise<void> {
  fastify.route({
    method: 'GET',
    url: '/ad-groups/:id/targeting-groups',
    schema: listTargetingGroupsSchema,
    handler: listTargetingGroups,
  });
  fastify.route({
    method: 'POST',
    url: '/ad-groups/:id/targeting-groups',
    schema: createTargetingGroupSchema,
    handler: createTargetingGroup,
  });
  fastify.route({
    method: 'POST',
    url: '/ad-groups/:id/targeting-groups/bulk',
    schema: bulkCreateTargetingGroupsSchema,
    handler: bulkCreateTargetingGroups,
  });
  fastify.route({
    method: 'PATCH',
    url: '/targeting-groups/bulk',
    schema: bulkUpdateTargetingGroupsSchema,
    handler: bulkUpdateTargetingGroups,
  });
  fastify.route({
    method: 'DELETE',
    url: '/targeting-groups/bulk',
    schema: bulkDeleteTargetingGroupsSchema,
    handler: bulkDeleteTargetingGroups,
  });
  fastify.route({
    method: 'POST',
    url: '/targeting-groups/bulk/restore',
    schema: bulkRestoreTargetingGroupsSchema,
    handler: bulkRestoreTargetingGroups,
  });
  fastify.route({
    method: 'GET',
    url: '/targeting-groups/:id',
    schema: getTargetingGroupSchema,
    handler: getTargetingGroup,
  });
  fastify.route({
    method: 'PATCH',
    url: '/targeting-groups/:id',
    schema: updateTargetingGroupSchema,
    handler: updateTargetingGroup,
  });
  fastify.route({
    method: 'DELETE',
    url: '/targeting-groups/:id',
    schema: deleteTargetingGroupSchema,
    handler: deleteTargetingGroup,
  });
  fastify.route({
    method: 'POST',
    url: '/targeting-groups/:id/restore',
    schema: restoreTargetingGroupSchema,
    handler: restoreTargetingGroup,
  });
  fastify.route({
    method: 'PUT',
    url: '/targeting-groups/:id/labels',
    schema: setTargetingGroupLabelsSchema,
    handler: setTargetingGroupLabels,
  });
}
