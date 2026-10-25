import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { dimensionCatalog } from '@src/targeting/dimensions';
import { DimensionParam, IdParam, SetTargetingDimensionBody, Targeting } from '@src/types';
import { actorOf, organizationIdOf } from '@utils';

/**
 * Handler for `GET /targeting-dimensions`.
 *
 * The registry is the same for everyone: it names no Organization and reads nothing, so it needs no
 * role beyond being authenticated.
 *
 * @param _request - The request, which carries nothing
 * @param reply - The reply, sent with the registry
 * @returns A promise that resolves once the response has been sent
 */
export async function getTargetingDimensions(
  this: FastifyInstance,
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  reply.send({ dimensions: dimensionCatalog() });
}

/**
 * Handler for `GET /targeting-groups/:id/targeting`.
 *
 * @param request - The request, with the TargetingGroup id
 * @param reply - The reply, sent with its targeting
 * @returns A promise that resolves once the response has been sent
 */
export async function getTargeting(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.targetingService.get(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `PUT /targeting-groups/:id/targeting`.
 *
 * @param request - The request, with the TargetingGroup id and the complete targeting
 * @param reply - The reply, sent with its targeting
 * @returns A promise that resolves once the response has been sent
 */
export async function setTargeting(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: { targeting: Targeting } }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.targetingService.replace(
      actorOf(request),
      organizationIdOf(request),
      request.params.id,
      request.body.targeting
    )
  );
}

/**
 * Handler for `PUT /targeting-groups/:id/targeting/:dimension`.
 *
 * @param request - The request, with the TargetingGroup id, the dimension and its criteria
 * @param reply - The reply, sent with its targeting
 * @returns A promise that resolves once the response has been sent
 */
export async function setTargetingDimension(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam & DimensionParam; Body: SetTargetingDimensionBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.targetingService.setDimension(
      actorOf(request),
      organizationIdOf(request),
      request.params.id,
      request.params.dimension,
      request.body.criteria
    )
  );
}

/**
 * Handler for `DELETE /targeting-groups/:id/targeting/:dimension`.
 *
 * @param request - The request, with the TargetingGroup id and the dimension
 * @param reply - The reply, sent with its targeting
 * @returns A promise that resolves once the response has been sent
 */
export async function removeTargetingDimension(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam & DimensionParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.targetingService.removeDimension(
      actorOf(request),
      organizationIdOf(request),
      request.params.id,
      request.params.dimension
    )
  );
}
