import type { FastifyInstance } from 'fastify';

import {
  bulkCreateLines,
  bulkDeleteLines,
  bulkRestoreLines,
  bulkUpdateLines,
  createLine,
  deleteLine,
  getLine,
  listLines,
  restoreLine,
  setLineLabels,
  updateLine,
} from './line.handler';
import {
  bulkCreateLinesSchema,
  bulkDeleteLinesSchema,
  bulkRestoreLinesSchema,
  bulkUpdateLinesSchema,
  createLineSchema,
  deleteLineSchema,
  getLineSchema,
  listLinesSchema,
  restoreLineSchema,
  setLineLabelsSchema,
  updateLineSchema,
} from './line.schema';

/**
 * Lines controller: the leaf of the tree, under its TargetingGroup.
 *
 * Wires URL → schema → handler. Listing and creating live **under the parent**, reading, changing
 * and deleting live **flat** on the resource, since an id carries its own parents
 * (`docs/phase-3.md` § 7).
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 */
export default async function LineController(fastify: FastifyInstance): Promise<void> {
  fastify.route({
    method: 'GET',
    url: '/targeting-groups/:id/lines',
    schema: listLinesSchema,
    handler: listLines,
  });
  fastify.route({
    method: 'POST',
    url: '/targeting-groups/:id/lines',
    schema: createLineSchema,
    handler: createLine,
  });
  fastify.route({
    method: 'POST',
    url: '/targeting-groups/:id/lines/bulk',
    schema: bulkCreateLinesSchema,
    handler: bulkCreateLines,
  });
  fastify.route({
    method: 'PATCH',
    url: '/lines/bulk',
    schema: bulkUpdateLinesSchema,
    handler: bulkUpdateLines,
  });
  fastify.route({
    method: 'DELETE',
    url: '/lines/bulk',
    schema: bulkDeleteLinesSchema,
    handler: bulkDeleteLines,
  });
  fastify.route({
    method: 'POST',
    url: '/lines/bulk/restore',
    schema: bulkRestoreLinesSchema,
    handler: bulkRestoreLines,
  });
  fastify.route({ method: 'GET', url: '/lines/:id', schema: getLineSchema, handler: getLine });
  fastify.route({ method: 'PATCH', url: '/lines/:id', schema: updateLineSchema, handler: updateLine });
  fastify.route({ method: 'DELETE', url: '/lines/:id', schema: deleteLineSchema, handler: deleteLine });
  fastify.route({
    method: 'POST',
    url: '/lines/:id/restore',
    schema: restoreLineSchema,
    handler: restoreLine,
  });
  fastify.route({
    method: 'PUT',
    url: '/lines/:id/labels',
    schema: setLineLabelsSchema,
    handler: setLineLabels,
  });
}
