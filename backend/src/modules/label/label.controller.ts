import type { FastifyInstance } from 'fastify';

import {
  bulkCreateLabels,
  bulkDeleteLabels,
  bulkRestoreLabels,
  bulkUpdateLabels,
  createLabel,
  deleteLabel,
  getLabel,
  listLabelResources,
  listLabels,
  restoreLabel,
  updateLabel,
} from './label.handler';
import {
  bulkCreateLabelsSchema,
  bulkDeleteLabelsSchema,
  bulkRestoreLabelsSchema,
  bulkUpdateLabelsSchema,
  createLabelSchema,
  deleteLabelSchema,
  getLabelSchema,
  listLabelResourcesSchema,
  listLabelsSchema,
  restoreLabelSchema,
  updateLabelSchema,
} from './label.schema';

/**
 * Labels controller: the Labels of the Organization named by `X-Organization-Id`, and what they mark.
 *
 * Wires URL → schema → handler. No business logic and no inline schemas; the role each route
 * requires is asserted by the service, so HTTP, MCP and jobs share one rule.
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 */
export default async function LabelController(fastify: FastifyInstance): Promise<void> {
  fastify.route({ method: 'GET', url: '/labels', schema: listLabelsSchema, handler: listLabels });
  fastify.route({ method: 'POST', url: '/labels', schema: createLabelSchema, handler: createLabel });
  fastify.route({ method: 'POST', url: '/labels/bulk', schema: bulkCreateLabelsSchema, handler: bulkCreateLabels });
  fastify.route({ method: 'PATCH', url: '/labels/bulk', schema: bulkUpdateLabelsSchema, handler: bulkUpdateLabels });
  fastify.route({ method: 'DELETE', url: '/labels/bulk', schema: bulkDeleteLabelsSchema, handler: bulkDeleteLabels });
  fastify.route({
    method: 'POST',
    url: '/labels/bulk/restore',
    schema: bulkRestoreLabelsSchema,
    handler: bulkRestoreLabels,
  });
  fastify.route({ method: 'GET', url: '/labels/:id', schema: getLabelSchema, handler: getLabel });
  fastify.route({ method: 'PATCH', url: '/labels/:id', schema: updateLabelSchema, handler: updateLabel });
  fastify.route({ method: 'DELETE', url: '/labels/:id', schema: deleteLabelSchema, handler: deleteLabel });
  fastify.route({ method: 'POST', url: '/labels/:id/restore', schema: restoreLabelSchema, handler: restoreLabel });
  fastify.route({
    method: 'GET',
    url: '/labels/:id/resources',
    schema: listLabelResourcesSchema,
    handler: listLabelResources,
  });
}
