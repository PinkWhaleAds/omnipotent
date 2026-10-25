import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  BulkCreateAdGroupsBody,
  BulkIdsBody,
  BulkUpdateAdGroupsBody,
  CreateAdGroupBody,
  IdParam,
  ListAdGroupsQuery,
  SetLabelsBody,
  UpdateAdGroupBody,
} from '@src/types';
import { actorOf, organizationIdOf } from '@utils';

/**
 * Handler for `GET /levers/:id/ad-groups`.
 *
 * @param request - The request, with the Lever id and the page
 * @param reply - The reply, sent with a page of AdGroups
 * @returns A promise that resolves once the response has been sent
 */
export async function listAdGroups(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Querystring: ListAdGroupsQuery }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.adGroupService.list(actorOf(request), organizationIdOf(request), request.params.id, request.query)
  );
}

/**
 * Handler for `POST /levers/:id/ad-groups`.
 *
 * @param request - The request, with the Lever id and the AdGroup to create
 * @param reply - The reply, sent with the created AdGroup (201)
 * @returns A promise that resolves once the response has been sent
 */
export async function createAdGroup(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: CreateAdGroupBody }>,
  reply: FastifyReply
): Promise<void> {
  reply
    .code(201)
    .send(
      await this.adGroupService.create(actorOf(request), organizationIdOf(request), request.params.id, request.body)
    );
}

/**
 * Handler for `GET /ad-groups/:id`.
 *
 * @param request - The request, with the AdGroup id
 * @param reply - The reply, sent with the AdGroup
 * @returns A promise that resolves once the response has been sent
 */
export async function getAdGroup(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.adGroupService.get(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `PATCH /ad-groups/:id`.
 *
 * @param request - The request, with the AdGroup id and the fields to change
 * @param reply - The reply, sent with the updated AdGroup
 * @returns A promise that resolves once the response has been sent
 */
export async function updateAdGroup(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: UpdateAdGroupBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.adGroupService.update(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `DELETE /ad-groups/:id`.
 *
 * @param request - The request, with the AdGroup id
 * @param reply - The reply, sent with the id and the deletion instant
 * @returns A promise that resolves once the response has been sent
 */
export async function deleteAdGroup(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.adGroupService.delete(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `POST /ad-groups/:id/restore`.
 *
 * @param request - The request, with the AdGroup id
 * @param reply - The reply, sent with the id and `deletedAt` back to `null`
 * @returns A promise that resolves once the response has been sent
 */
export async function restoreAdGroup(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.adGroupService.restore(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `PUT /ad-groups/:id/labels`.
 *
 * @param request - The request, with the AdGroup id and the complete set of Label ids
 * @param reply - The reply, sent with the AdGroup and the Labels it now carries
 * @returns A promise that resolves once the response has been sent
 */
export async function setAdGroupLabels(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: SetLabelsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.adGroupService.setLabels(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `POST /levers/:id/ad-groups/bulk`.
 *
 * @param request - The request, with the Lever id, the mode and the AdGroups to create
 * @param reply - The reply, sent with what was created and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkCreateAdGroups(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: BulkCreateAdGroupsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.adGroupService.bulkCreate(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `PATCH /ad-groups/bulk`.
 *
 * @param request - The request, with the mode and the changes, each naming its AdGroup
 * @param reply - The reply, sent with what was changed and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkUpdateAdGroups(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkUpdateAdGroupsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.adGroupService.bulkUpdate(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `DELETE /ad-groups/bulk`.
 *
 * @param request - The request, with the mode and the ids
 * @param reply - The reply, sent with what was deleted and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkDeleteAdGroups(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkIdsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.adGroupService.bulkDelete(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `POST /ad-groups/bulk/restore`.
 *
 * @param request - The request, with the mode and the ids
 * @param reply - The reply, sent with what was restored and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkRestoreAdGroups(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkIdsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.adGroupService.bulkRestore(actorOf(request), organizationIdOf(request), request.body));
}
