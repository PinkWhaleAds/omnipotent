import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { CreateConversionGoalBody, IdParam, ListConversionGoalsQuery, UpdateConversionGoalBody } from '@src/types';
import { actorOf, organizationIdOf } from '@utils';

/**
 * Handler for `GET /advertisers/:id/conversion-goals`.
 *
 * @param request - The request, with the Advertiser id and the page asked
 * @param reply - The reply, sent with a page of goals
 * @returns A promise that resolves once the response has been sent
 */
export async function listConversionGoals(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Querystring: ListConversionGoalsQuery }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.conversionGoalService.list(actorOf(request), organizationIdOf(request), request.params.id, request.query)
  );
}

/**
 * Handler for `POST /advertisers/:id/conversion-goals`.
 *
 * @param request - The request, with the Advertiser id and the goal
 * @param reply - The reply, sent with the goal and 201
 * @returns A promise that resolves once the response has been sent
 */
export async function createConversionGoal(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: CreateConversionGoalBody }>,
  reply: FastifyReply
): Promise<void> {
  reply
    .code(201)
    .send(
      await this.conversionGoalService.create(
        actorOf(request),
        organizationIdOf(request),
        request.params.id,
        request.body
      )
    );
}

/**
 * Handler for `GET /conversion-goals/:id`.
 *
 * @param request - The request, with the goal id
 * @param reply - The reply, sent with the goal
 * @returns A promise that resolves once the response has been sent
 */
export async function getConversionGoal(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.conversionGoalService.get(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `PATCH /conversion-goals/:id`.
 *
 * @param request - The request, with the goal id and the fields to change
 * @param reply - The reply, sent with the goal
 * @returns A promise that resolves once the response has been sent
 */
export async function updateConversionGoal(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: UpdateConversionGoalBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.conversionGoalService.update(
      actorOf(request),
      organizationIdOf(request),
      request.params.id,
      request.body
    )
  );
}
