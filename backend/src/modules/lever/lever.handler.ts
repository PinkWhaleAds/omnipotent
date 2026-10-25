import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { CreateLeverBody, IdParam, ListLeversQuery, SetLabelsBody, UpdateLeverBody } from '@src/types';
import { actorOf, organizationIdOf } from '@utils';

/**
 * Handler for `GET /campaigns/:id/levers`.
 *
 * @param request - The request, with the Campaign id and the page
 * @param reply - The reply, sent with a page of Levers
 * @returns A promise that resolves once the response has been sent
 */
export async function listLevers(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Querystring: ListLeversQuery }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.leverService.list(actorOf(request), organizationIdOf(request), request.params.id, request.query)
  );
}

/**
 * Handler for `POST /campaigns/:id/levers`.
 *
 * @param request - The request, with the Campaign id and the Lever to create
 * @param reply - The reply, sent with the created Lever (201)
 * @returns A promise that resolves once the response has been sent
 */
export async function createLever(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: CreateLeverBody }>,
  reply: FastifyReply
): Promise<void> {
  reply
    .code(201)
    .send(await this.leverService.create(actorOf(request), organizationIdOf(request), request.params.id, request.body));
}

/**
 * Handler for `GET /levers/:id`.
 *
 * @param request - The request, with the Lever id
 * @param reply - The reply, sent with the Lever
 * @returns A promise that resolves once the response has been sent
 */
export async function getLever(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.leverService.get(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `PATCH /levers/:id`.
 *
 * @param request - The request, with the Lever id and the fields to change
 * @param reply - The reply, sent with the updated Lever
 * @returns A promise that resolves once the response has been sent
 */
export async function updateLever(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: UpdateLeverBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.leverService.update(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `DELETE /levers/:id`.
 *
 * @param request - The request, with the Lever id
 * @param reply - The reply, sent with the id and the deletion instant
 * @returns A promise that resolves once the response has been sent
 */
export async function deleteLever(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.leverService.delete(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `POST /levers/:id/restore`.
 *
 * @param request - The request, with the Lever id
 * @param reply - The reply, sent with the id and `deletedAt` back to `null`
 * @returns A promise that resolves once the response has been sent
 */
export async function restoreLever(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.leverService.restore(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `PUT /levers/:id/labels`.
 *
 * @param request - The request, with the Lever id and the complete set of Label ids
 * @param reply - The reply, sent with the Lever and the Labels it now carries
 * @returns A promise that resolves once the response has been sent
 */
export async function setLeverLabels(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: SetLabelsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.leverService.setLabels(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}
