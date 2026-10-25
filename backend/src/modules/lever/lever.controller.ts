import type { FastifyInstance } from 'fastify';

import {
  createLever,
  deleteLever,
  getLever,
  listLevers,
  restoreLever,
  setLeverLabels,
  updateLever,
} from './lever.handler';
import {
  createLeverSchema,
  deleteLeverSchema,
  getLeverSchema,
  listLeversSchema,
  restoreLeverSchema,
  setLeverLabelsSchema,
  updateLeverSchema,
} from './lever.schema';

/**
 * Levers controller: one channel of a Campaign, and the platforms it buys on.
 *
 * Wires URL → schema → handler. Listing and creating live **under the parent**, reading, changing
 * and deleting live **flat** on the resource, since an id carries its own parents
 * (`docs/phase-3.md` § 7).
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 */
export default async function LeverController(fastify: FastifyInstance): Promise<void> {
  fastify.route({
    method: 'GET',
    url: '/campaigns/:id/levers',
    schema: listLeversSchema,
    handler: listLevers,
  });
  fastify.route({
    method: 'POST',
    url: '/campaigns/:id/levers',
    schema: createLeverSchema,
    handler: createLever,
  });
  fastify.route({ method: 'GET', url: '/levers/:id', schema: getLeverSchema, handler: getLever });
  fastify.route({ method: 'PATCH', url: '/levers/:id', schema: updateLeverSchema, handler: updateLever });
  fastify.route({ method: 'DELETE', url: '/levers/:id', schema: deleteLeverSchema, handler: deleteLever });
  fastify.route({
    method: 'POST',
    url: '/levers/:id/restore',
    schema: restoreLeverSchema,
    handler: restoreLever,
  });
  fastify.route({
    method: 'PUT',
    url: '/levers/:id/labels',
    schema: setLeverLabelsSchema,
    handler: setLeverLabels,
  });
}
