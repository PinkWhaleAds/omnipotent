import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { IdParam, PlatformUnitParams } from '@src/types';
import { actorOf, organizationIdOf } from '@utils';

/**
 * Handler for `GET /campaigns/:id/platform-status`.
 *
 * @param request - The request, with the campaign id
 * @param reply - The reply, sent with one entry per unit
 * @returns A promise that resolves once the response has been sent
 */
export async function getPlatformStatus(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.syncService.platformStatus(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `POST /campaigns/:id/sync`.
 *
 * @param request - The request, with the campaign id
 * @param reply - The reply, sent with how many units were marked
 * @returns A promise that resolves once the response has been sent
 */
export async function requestSync(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.syncService.requestSync(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `POST /campaigns/:id/platform-units/:unitId/retry`.
 *
 * @param request - The request, with the campaign and the unit
 * @param reply - The reply, sent with the unit, now waiting to be applied
 * @returns A promise that resolves once the response has been sent
 */
export async function retryPlatformUnit(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: PlatformUnitParams }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.syncService.retry(actorOf(request), organizationIdOf(request), request.params.id, request.params.unitId)
  );
}
