import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  BulkCreateLinesBody,
  BulkIdsBody,
  BulkUpdateLinesBody,
  CreateLineBody,
  IdParam,
  ListLinesQuery,
  SetLabelsBody,
  UpdateLineBody,
} from '@src/types';
import { actorOf, organizationIdOf } from '@utils';

/**
 * Handler for `GET /targeting-groups/:id/lines`.
 *
 * @param request - The request, with the TargetingGroup id and the page
 * @param reply - The reply, sent with a page of Lines
 * @returns A promise that resolves once the response has been sent
 */
export async function listLines(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Querystring: ListLinesQuery }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.lineService.list(actorOf(request), organizationIdOf(request), request.params.id, request.query)
  );
}

/**
 * Handler for `POST /targeting-groups/:id/lines`.
 *
 * @param request - The request, with the TargetingGroup id and the Line to create
 * @param reply - The reply, sent with the created Line (201)
 * @returns A promise that resolves once the response has been sent
 */
export async function createLine(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: CreateLineBody }>,
  reply: FastifyReply
): Promise<void> {
  reply
    .code(201)
    .send(await this.lineService.create(actorOf(request), organizationIdOf(request), request.params.id, request.body));
}

/**
 * Handler for `GET /lines/:id`.
 *
 * @param request - The request, with the Line id
 * @param reply - The reply, sent with the Line
 * @returns A promise that resolves once the response has been sent
 */
export async function getLine(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.lineService.get(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `PATCH /lines/:id`.
 *
 * @param request - The request, with the Line id and the fields to change
 * @param reply - The reply, sent with the updated Line
 * @returns A promise that resolves once the response has been sent
 */
export async function updateLine(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: UpdateLineBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.lineService.update(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `DELETE /lines/:id`.
 *
 * @param request - The request, with the Line id
 * @param reply - The reply, sent with the id and the deletion instant
 * @returns A promise that resolves once the response has been sent
 */
export async function deleteLine(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.lineService.delete(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `POST /lines/:id/restore`.
 *
 * @param request - The request, with the Line id
 * @param reply - The reply, sent with the id and `deletedAt` back to `null`
 * @returns A promise that resolves once the response has been sent
 */
export async function restoreLine(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.lineService.restore(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `PUT /lines/:id/labels`.
 *
 * @param request - The request, with the Line id and the complete set of Label ids
 * @param reply - The reply, sent with the Line and the Labels it now carries
 * @returns A promise that resolves once the response has been sent
 */
export async function setLineLabels(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: SetLabelsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.lineService.setLabels(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `POST /targeting-groups/:id/lines/bulk`.
 *
 * @param request - The request, with the TargetingGroup id, the mode and the Lines to create
 * @param reply - The reply, sent with what was created and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkCreateLines(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: BulkCreateLinesBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.lineService.bulkCreate(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `PATCH /lines/bulk`.
 *
 * @param request - The request, with the mode and the changes, each naming its Line
 * @param reply - The reply, sent with what was changed and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkUpdateLines(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkUpdateLinesBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.lineService.bulkUpdate(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `DELETE /lines/bulk`.
 *
 * @param request - The request, with the mode and the ids
 * @param reply - The reply, sent with what was deleted and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkDeleteLines(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkIdsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.lineService.bulkDelete(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `POST /lines/bulk/restore`.
 *
 * @param request - The request, with the mode and the ids
 * @param reply - The reply, sent with what was restored and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkRestoreLines(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkIdsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.lineService.bulkRestore(actorOf(request), organizationIdOf(request), request.body));
}
