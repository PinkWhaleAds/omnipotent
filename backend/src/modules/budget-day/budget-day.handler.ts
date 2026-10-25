import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { ApplyBudgetPresetBody, IdParam, TreeLevel, UpdateBudgetDaysBody } from '@src/types';
import { actorOf, organizationIdOf } from '@utils';

/**
 * Handler for `GET /<level>/:id/budget-days`.
 *
 * Built for one level: the five levels share **one** service, whose methods take the level as an
 * argument, so a handler per level would be the same line five times (`docs/phase-4.md` § 1).
 *
 * @param level - The level the route serves
 * @returns The handler of that level
 */
export function getBudgetDays(level: TreeLevel) {
  return async function handler(
    this: FastifyInstance,
    request: FastifyRequest<{ Params: IdParam }>,
    reply: FastifyReply
  ): Promise<void> {
    reply.send(
      await this.budgetCurveService.get(actorOf(request), organizationIdOf(request), level, request.params.id)
    );
  };
}

/**
 * Handler for `PUT /<level>/:id/budget-days`.
 *
 * @param level - The level the route serves
 * @returns The handler of that level
 */
export function updateBudgetDays(level: TreeLevel) {
  return async function handler(
    this: FastifyInstance,
    request: FastifyRequest<{ Params: IdParam; Body: UpdateBudgetDaysBody }>,
    reply: FastifyReply
  ): Promise<void> {
    reply.send(
      await this.budgetCurveService.update(
        actorOf(request),
        organizationIdOf(request),
        level,
        request.params.id,
        request.body
      )
    );
  };
}

/**
 * Handler for `POST /<level>/:id/budget-days/preset`.
 *
 * @param level - The level the route serves
 * @returns The handler of that level
 */
export function applyBudgetPreset(level: TreeLevel) {
  return async function handler(
    this: FastifyInstance,
    request: FastifyRequest<{ Params: IdParam; Body: ApplyBudgetPresetBody }>,
    reply: FastifyReply
  ): Promise<void> {
    reply.send(
      await this.budgetCurveService.applyPreset(
        actorOf(request),
        organizationIdOf(request),
        level,
        request.params.id,
        request.body
      )
    );
  };
}

/**
 * Handler for `DELETE /<level>/:id/budget-days`.
 *
 * @param level - The level the route serves
 * @returns The handler of that level
 */
export function resetBudgetDays(level: TreeLevel) {
  return async function handler(
    this: FastifyInstance,
    request: FastifyRequest<{ Params: IdParam }>,
    reply: FastifyReply
  ): Promise<void> {
    reply.send(
      await this.budgetCurveService.reset(actorOf(request), organizationIdOf(request), level, request.params.id)
    );
  };
}

/**
 * Handler for `GET /<level>/:id/pacing`.
 *
 * @param level - The level the route serves
 * @returns The handler of that level
 */
export function getPacing(level: TreeLevel) {
  return async function handler(
    this: FastifyInstance,
    request: FastifyRequest<{ Params: IdParam }>,
    reply: FastifyReply
  ): Promise<void> {
    reply.send(
      await this.budgetCurveService.pacing(actorOf(request), organizationIdOf(request), level, request.params.id)
    );
  };
}
