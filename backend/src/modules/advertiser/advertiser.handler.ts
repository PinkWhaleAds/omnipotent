import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  BulkCreateAdvertisersBody,
  BulkIdsBody,
  BulkUpdateAdvertisersBody,
  CreateAdvertiserBody,
  IdParam,
  ListAdvertisersQuery,
  SetLabelsBody,
  UpdateAdvertiserBody,
} from '@src/types';
import { actorOf, organizationIdOf } from '@utils';

/**
 * Handler for `GET /advertisers`.
 *
 * @param request - The request, with the page, the sort, the search and the Label filter
 * @param reply - The reply, sent with a page of Advertisers
 * @returns A promise that resolves once the response has been sent
 */
export async function listAdvertisers(
  this: FastifyInstance,
  request: FastifyRequest<{ Querystring: ListAdvertisersQuery }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.advertiserService.list(actorOf(request), organizationIdOf(request), request.query));
}

/**
 * Handler for `POST /advertisers`.
 *
 * @param request - The request, with the Advertiser to create
 * @param reply - The reply, sent with the created Advertiser (201)
 * @returns A promise that resolves once the response has been sent
 */
export async function createAdvertiser(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: CreateAdvertiserBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.code(201).send(await this.advertiserService.create(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `GET /advertisers/:id`.
 *
 * @param request - The request, with the Advertiser id
 * @param reply - The reply, sent with the Advertiser
 * @returns A promise that resolves once the response has been sent
 */
export async function getAdvertiser(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.advertiserService.get(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `PATCH /advertisers/:id`.
 *
 * @param request - The request, with the Advertiser id and the fields to change
 * @param reply - The reply, sent with the updated Advertiser
 * @returns A promise that resolves once the response has been sent
 */
export async function updateAdvertiser(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: UpdateAdvertiserBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.advertiserService.update(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `DELETE /advertisers/:id`.
 *
 * Answers the deletion rather than an empty 204: the deletion is a soft one, and `deletedAt` is what
 * `restore` undoes.
 *
 * @param request - The request, with the Advertiser id
 * @param reply - The reply, sent with the id and the deletion instant
 * @returns A promise that resolves once the response has been sent
 */
export async function deleteAdvertiser(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.advertiserService.delete(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `POST /advertisers/:id/restore`.
 *
 * @param request - The request, with the Advertiser id
 * @param reply - The reply, sent with the id and `deletedAt` back to `null`
 * @returns A promise that resolves once the response has been sent
 */
export async function restoreAdvertiser(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.advertiserService.restore(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `PUT /advertisers/:id/labels`.
 *
 * @param request - The request, with the Advertiser id and the complete set of Label ids
 * @param reply - The reply, sent with the Advertiser and the Labels it now carries
 * @returns A promise that resolves once the response has been sent
 */
export async function setAdvertiserLabels(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: SetLabelsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.advertiserService.setLabels(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `POST /advertisers/bulk`.
 *
 * @param request - The request, with the mode and the Advertisers to create
 * @param reply - The reply, sent with what was created and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkCreateAdvertisers(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkCreateAdvertisersBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.advertiserService.bulkCreate(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `PATCH /advertisers/bulk`.
 *
 * @param request - The request, with the mode and the changes, each naming its Advertiser
 * @param reply - The reply, sent with what was changed and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkUpdateAdvertisers(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkUpdateAdvertisersBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.advertiserService.bulkUpdate(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `DELETE /advertisers/bulk`.
 *
 * @param request - The request, with the mode and the ids
 * @param reply - The reply, sent with what was deleted and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkDeleteAdvertisers(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkIdsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.advertiserService.bulkDelete(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `POST /advertisers/bulk/restore`.
 *
 * @param request - The request, with the mode and the ids
 * @param reply - The reply, sent with what was restored and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkRestoreAdvertisers(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkIdsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.advertiserService.bulkRestore(actorOf(request), organizationIdOf(request), request.body));
}
