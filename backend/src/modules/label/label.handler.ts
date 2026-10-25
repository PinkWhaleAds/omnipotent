import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  BulkCreateLabelsBody,
  BulkIdsBody,
  BulkUpdateLabelsBody,
  CreateLabelBody,
  IdParam,
  ListLabelsQuery,
  PaginationQuery,
  UpdateLabelBody,
} from '@src/types';
import { actorOf, organizationIdOf } from '@utils';

/**
 * Handler for `GET /labels`.
 *
 * @param request - The request, with the page, the sort and the search
 * @param reply - The reply, sent with a page of Labels
 * @returns A promise that resolves once the response has been sent
 */
export async function listLabels(
  this: FastifyInstance,
  request: FastifyRequest<{ Querystring: ListLabelsQuery }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.labelService.list(actorOf(request), organizationIdOf(request), request.query));
}

/**
 * Handler for `POST /labels`.
 *
 * @param request - The request, with the Label to create
 * @param reply - The reply, sent with the created Label (201)
 * @returns A promise that resolves once the response has been sent
 */
export async function createLabel(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: CreateLabelBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.code(201).send(await this.labelService.create(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `GET /labels/:id`.
 *
 * @param request - The request, with the Label id
 * @param reply - The reply, sent with the Label
 * @returns A promise that resolves once the response has been sent
 */
export async function getLabel(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.labelService.get(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `PATCH /labels/:id`.
 *
 * @param request - The request, with the Label id and the fields to change
 * @param reply - The reply, sent with the updated Label
 * @returns A promise that resolves once the response has been sent
 */
export async function updateLabel(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: UpdateLabelBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.labelService.update(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `DELETE /labels/:id`.
 *
 * Answers the deletion rather than an empty 204: the deletion is a soft one, and `deletedAt` is what
 * `restore` undoes.
 *
 * @param request - The request, with the Label id
 * @param reply - The reply, sent with the id and the deletion instant
 * @returns A promise that resolves once the response has been sent
 */
export async function deleteLabel(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.labelService.delete(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `POST /labels/:id/restore`.
 *
 * @param request - The request, with the Label id
 * @param reply - The reply, sent with the id and `deletedAt` back to `null`
 * @returns A promise that resolves once the response has been sent
 */
export async function restoreLabel(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.labelService.restore(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `GET /labels/:id/resources`.
 *
 * @param request - The request, with the Label id and the page
 * @param reply - The reply, sent with a page of what the Label marks
 * @returns A promise that resolves once the response has been sent
 */
export async function listLabelResources(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Querystring: PaginationQuery }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.labelService.resources(actorOf(request), organizationIdOf(request), request.params.id, request.query)
  );
}

/**
 * Handler for `POST /labels/bulk`.
 *
 * @param request - The request, with the mode and the Labels to create
 * @param reply - The reply, sent with what was created and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkCreateLabels(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkCreateLabelsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.labelService.bulkCreate(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `PATCH /labels/bulk`.
 *
 * @param request - The request, with the mode and the changes, each naming its Label
 * @param reply - The reply, sent with what was changed and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkUpdateLabels(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkUpdateLabelsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.labelService.bulkUpdate(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `DELETE /labels/bulk`.
 *
 * @param request - The request, with the mode and the ids
 * @param reply - The reply, sent with what was deleted and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkDeleteLabels(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkIdsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.labelService.bulkDelete(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `POST /labels/bulk/restore`.
 *
 * @param request - The request, with the mode and the ids
 * @param reply - The reply, sent with what was restored and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkRestoreLabels(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkIdsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.labelService.bulkRestore(actorOf(request), organizationIdOf(request), request.body));
}
