import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  BulkCreateListsBody,
  BulkIdsBody,
  BulkUpdateListsBody,
  CreateListBody,
  IdParam,
  ListListsQuery,
  TransferListBody,
  UpdateListBody,
} from '@src/types';
import { actorOf, organizationIdOf } from '@utils';

/**
 * Handler for `GET /lists`.
 *
 * @param request - The request, with the page, the sort, the search and the kind
 * @param reply - The reply, sent with a page of lists
 * @returns A promise that resolves once the response has been sent
 */
export async function listLists(
  this: FastifyInstance,
  request: FastifyRequest<{ Querystring: ListListsQuery }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.listService.list(actorOf(request), organizationIdOf(request), request.query));
}

/**
 * Handler for `POST /lists`.
 *
 * @param request - The request, with the list to create
 * @param reply - The reply, sent with the created list (201)
 * @returns A promise that resolves once the response has been sent
 */
export async function createList(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: CreateListBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.code(201).send(await this.listService.create(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `GET /lists/:id`.
 *
 * @param request - The request, with the list id
 * @param reply - The reply, sent with the list
 * @returns A promise that resolves once the response has been sent
 */
export async function getList(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.listService.get(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `PATCH /lists/:id`.
 *
 * @param request - The request, with the list id and the fields to change
 * @param reply - The reply, sent with the updated list
 * @returns A promise that resolves once the response has been sent
 */
export async function updateList(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: UpdateListBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.listService.update(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `DELETE /lists/:id`.
 *
 * @param request - The request, with the list id
 * @param reply - The reply, sent with its id and when it was deleted
 * @returns A promise that resolves once the response has been sent
 */
export async function deleteList(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.listService.delete(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `POST /lists/:id/restore`.
 *
 * @param request - The request, with the list id
 * @param reply - The reply, sent with its id and `deletedAt` back to `null`
 * @returns A promise that resolves once the response has been sent
 */
export async function restoreList(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.listService.restore(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `POST /lists/:id/duplicate`.
 *
 * @param request - The request, with the list id and the Organization the copy goes to
 * @param reply - The reply, sent with the copy (201)
 * @returns A promise that resolves once the response has been sent
 */
export async function duplicateList(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: TransferListBody }>,
  reply: FastifyReply
): Promise<void> {
  reply
    .code(201)
    .send(
      await this.listService.duplicate(actorOf(request), organizationIdOf(request), request.params.id, request.body)
    );
}

/**
 * Handler for `POST /lists/:id/move`.
 *
 * @param request - The request, with the list id and the Organization it goes to
 * @param reply - The reply, sent with the list in its new Organization
 * @returns A promise that resolves once the response has been sent
 */
export async function moveList(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: TransferListBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.listService.move(actorOf(request), organizationIdOf(request), request.params.id, request.body));
}

/**
 * Handler for `POST /lists/bulk`.
 *
 * @param request - The request, with the mode and the lists to create
 * @param reply - The reply, sent with what was created and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkCreateLists(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkCreateListsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.listService.bulkCreate(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `PATCH /lists/bulk`.
 *
 * @param request - The request, with the mode and the lists to change
 * @param reply - The reply, sent with what was changed and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkUpdateLists(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkUpdateListsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.listService.bulkUpdate(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `DELETE /lists/bulk`.
 *
 * @param request - The request, with the mode and the ids
 * @param reply - The reply, sent with what was deleted and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkDeleteLists(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkIdsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.listService.bulkDelete(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `POST /lists/bulk/restore`.
 *
 * @param request - The request, with the mode and the ids
 * @param reply - The reply, sent with what was restored and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkRestoreLists(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkIdsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.listService.bulkRestore(actorOf(request), organizationIdOf(request), request.body));
}
