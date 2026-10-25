import type { FastifyInstance } from 'fastify';

import { TreeLevel } from '@src/types';
import { applyBudgetPreset, getBudgetDays, getPacing, resetBudgetDays, updateBudgetDays } from './budget-day.handler';
import { budgetDaySchemas, BudgetDaySchemas } from './budget-day.schema';

/** What a level needs to serve its curve: its name in a URL, and its name in the documentation. */
type CurveLevel = {
  /** The level, as the service and the `budget_days` rows name it. */
  level: TreeLevel;
  /** Its segment in a URL, the plural the rest of the API already uses. */
  resource: string;
  /** Its name in the documentation of the routes. */
  name: string;
};

/** The five levels carrying a curve, from the root of the tree down to its leaf. */
const CURVE_LEVELS: readonly CurveLevel[] = [
  { level: 'campaign', resource: 'campaigns', name: 'Campaign' },
  { level: 'lever', resource: 'levers', name: 'lever' },
  { level: 'ad_group', resource: 'ad-groups', name: 'AdGroup' },
  { level: 'targeting_group', resource: 'targeting-groups', name: 'TargetingGroup' },
  { level: 'line', resource: 'lines', name: 'Line' },
];

/**
 * Budget days controller: the daily curve and the pacing, on each level of the tree.
 *
 * Wires URL → schema → handler. The five levels serve the **same** five routes, over one table and
 * one service, so they are registered from one table rather than written five times
 * (`docs/phase-4.md` § 6); the routes live flat on the resource, since an id carries its own parents.
 *
 * A level with no budget of its own still answers `GET`, with the curve of its parent at its scale;
 * writing on it is a 400, refused by the service.
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 */
export default async function BudgetDayController(fastify: FastifyInstance): Promise<void> {
  for (const { level, resource, name } of CURVE_LEVELS) {
    const schemas: BudgetDaySchemas = budgetDaySchemas(name);
    fastify.route({
      method: 'GET',
      url: `/${resource}/:id/budget-days`,
      schema: schemas.get,
      handler: getBudgetDays(level),
    });
    fastify.route({
      method: 'PUT',
      url: `/${resource}/:id/budget-days`,
      schema: schemas.update,
      handler: updateBudgetDays(level),
    });
    fastify.route({
      method: 'POST',
      url: `/${resource}/:id/budget-days/preset`,
      schema: schemas.preset,
      handler: applyBudgetPreset(level),
    });
    fastify.route({
      method: 'DELETE',
      url: `/${resource}/:id/budget-days`,
      schema: schemas.reset,
      handler: resetBudgetDays(level),
    });
    fastify.route({
      method: 'GET',
      url: `/${resource}/:id/pacing`,
      schema: schemas.pacing,
      handler: getPacing(level),
    });
  }
}
