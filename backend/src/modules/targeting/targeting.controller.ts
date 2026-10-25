import type { FastifyInstance } from 'fastify';

import {
  getTargeting,
  getTargetingDimensions,
  removeTargetingDimension,
  setTargeting,
  setTargetingDimension,
} from './targeting.handler';
import {
  getTargetingDimensionsSchema,
  getTargetingSchema,
  removeTargetingDimensionSchema,
  setTargetingDimensionSchema,
  setTargetingSchema,
} from './targeting.schema';

/**
 * Targeting controller: the registry of dimensions, and the targeting of a TargetingGroup.
 *
 * Wires URL → schema → handler. All the targeting lives on the TargetingGroup
 * (`../../CADRAGE.md` § 8), so there is one place to read it and three ways to write it: the whole
 * object, one dimension, or the removal of one.
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 */
export default async function TargetingController(fastify: FastifyInstance): Promise<void> {
  fastify.route({
    method: 'GET',
    url: '/targeting-dimensions',
    schema: getTargetingDimensionsSchema,
    handler: getTargetingDimensions,
  });
  fastify.route({
    method: 'GET',
    url: '/targeting-groups/:id/targeting',
    schema: getTargetingSchema,
    handler: getTargeting,
  });
  fastify.route({
    method: 'PUT',
    url: '/targeting-groups/:id/targeting',
    schema: setTargetingSchema,
    handler: setTargeting,
  });
  fastify.route({
    method: 'PUT',
    url: '/targeting-groups/:id/targeting/:dimension',
    schema: setTargetingDimensionSchema,
    handler: setTargetingDimension,
  });
  fastify.route({
    method: 'DELETE',
    url: '/targeting-groups/:id/targeting/:dimension',
    schema: removeTargetingDimensionSchema,
    handler: removeTargetingDimension,
  });
}
