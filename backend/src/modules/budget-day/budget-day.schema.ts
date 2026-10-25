import type { FastifySchema } from 'fastify';

import {
  applyBudgetPresetBodySchema,
  budgetCurveSchema,
  idParamSchema,
  organizationHeadersSchema,
  pacingSchema,
  updateBudgetDaysBodySchema,
} from '@src/types';
import { errorResponses, toJsonSchema } from '@utils';

/** Tag grouping the budget day routes in Swagger. */
const TAGS: string[] = ['Budget days'];

/** Headers of every budget day route: they all act on one Organization. */
const headers: object = toJsonSchema(organizationHeadersSchema, 'input');

/** Params of a route naming one node of the tree. */
const params: object = toJsonSchema(idParamSchema, 'input');

/** The five Fastify schemas one level serves on its curve. */
export type BudgetDaySchemas = {
  /** `GET /<level>/:id/budget-days`. */
  get: FastifySchema;
  /** `PUT /<level>/:id/budget-days`. */
  update: FastifySchema;
  /** `POST /<level>/:id/budget-days/preset`. */
  preset: FastifySchema;
  /** `DELETE /<level>/:id/budget-days`. */
  reset: FastifySchema;
  /** `GET /<level>/:id/pacing`. */
  pacing: FastifySchema;
};

/**
 * The schemas of the five curve routes of one level.
 *
 * Built for each level rather than written five times: the curve is **one** resource over the five
 * levels — one table, one service — and only the name in the description changes
 * (`docs/phase-4.md` § 1). The shapes themselves are the same, which is the point.
 *
 * @param name - The level as the documentation names it, `Campaign`, `AdGroup`…
 * @returns Its five schemas
 *
 * @example
 * ```typescript
 * const schemas: BudgetDaySchemas = budgetDaySchemas('AdGroup');
 * ```
 */
export function budgetDaySchemas(name: string): BudgetDaySchemas {
  return {
    get: {
      tags: TAGS,
      description: `Get the daily budget curve of a ${name}: its own, or the shape of its parent at its scale (viewer)`,
      headers,
      params,
      response: { 200: toJsonSchema(budgetCurveSchema), ...errorResponses(400, 401, 403, 404) },
    },
    update: {
      tags: TAGS,
      description: `Edit days of the curve of a ${name}; the free days rebalance so the total stays its budget (manager)`,
      headers,
      params,
      body: toJsonSchema(updateBudgetDaysBodySchema, 'input'),
      response: { 200: toJsonSchema(budgetCurveSchema), ...errorResponses(400, 401, 403, 404) },
    },
    preset: {
      tags: TAGS,
      description: `Shape the curve of a ${name} with a preset, excluding the weekdays and the days that must not deliver (manager)`,
      headers,
      params,
      body: toJsonSchema(applyBudgetPresetBodySchema, 'input'),
      response: { 200: toJsonSchema(budgetCurveSchema), ...errorResponses(400, 401, 403, 404) },
    },
    reset: {
      tags: TAGS,
      description: `Reset the curve of a ${name} to a flat one, clearing every lock (manager)`,
      headers,
      params,
      response: { 200: toJsonSchema(budgetCurveSchema), ...errorResponses(400, 401, 403, 404) },
    },
    pacing: {
      tags: TAGS,
      description: `What a ${name} is to spend today against what its curve planned (viewer)`,
      headers,
      params,
      response: { 200: toJsonSchema(pacingSchema), ...errorResponses(400, 401, 403, 404) },
    },
  };
}
