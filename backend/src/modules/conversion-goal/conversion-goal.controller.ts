import type { FastifyInstance } from 'fastify';

import {
  createConversionGoal,
  getConversionGoal,
  listConversionGoals,
  updateConversionGoal,
} from './conversion-goal.handler';
import {
  createConversionGoalSchema,
  getConversionGoalSchema,
  listConversionGoalsSchema,
  updateConversionGoalSchema,
} from './conversion-goal.schema';

/**
 * Conversion goals controller: what the sites of the Advertisers send (D58, `docs/phase-10.md` § 8.10).
 *
 * Wires URL → schema → handler. Listing and creating live **under the Advertiser** whose goals they
 * are, the rest stays flat, since an id carries its own parents (`docs/phase-3.md` § 7). No delete: a
 * goal is archived, never deleted.
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 */
export default async function ConversionGoalController(fastify: FastifyInstance): Promise<void> {
  fastify.route({
    method: 'GET',
    url: '/advertisers/:id/conversion-goals',
    schema: listConversionGoalsSchema,
    handler: listConversionGoals,
  });
  fastify.route({
    method: 'POST',
    url: '/advertisers/:id/conversion-goals',
    schema: createConversionGoalSchema,
    handler: createConversionGoal,
  });
  fastify.route({
    method: 'GET',
    url: '/conversion-goals/:id',
    schema: getConversionGoalSchema,
    handler: getConversionGoal,
  });
  fastify.route({
    method: 'PATCH',
    url: '/conversion-goals/:id',
    schema: updateConversionGoalSchema,
    handler: updateConversionGoal,
  });
}
