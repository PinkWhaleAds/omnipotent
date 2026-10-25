import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  BulkCreateTargetingGroupsBody,
  BulkIdsBody,
  BulkUpdateTargetingGroupsBody,
  CreateTargetingGroupBody,
  IdParam,
  ListTargetingGroupsQuery,
  SetLabelsBody,
  UpdateTargetingGroupBody,
} from '@src/types';
import { actorOf, organizationIdOf } from '@utils';

/**
 * Handler for `GET /ad-groups/:id/targeting-groups`.
 *
 * @param request - The request, with the AdGroup id and the page
 * @param reply - The reply, sent with a page of TargetingGroups
 * @returns A promise that resolves once the response has been sent
 */
export async function listTargetingGroups(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Querystring: ListTargetingGroupsQuery }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.targetingGroupService.list(actorOf(request), organizationIdOf(request), request.params.id, request.query)
  );
}

/**
 * Handler for `POST /ad-groups/:id/targeting-groups`.
 *
 * @param request - The request, with the AdGroup id and the TargetingGroup to create
 * @param reply - The reply, sent with the created TargetingGroup (201)
 * @returns A promise that resolves once the response has been sent
 */
export async function createTargetingGroup(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: CreateTargetingGroupBody }>,
  reply: FastifyReply
): Promise<void> {
  reply
    .code(201)
    .send(
      await this.targetingGroupService.create(
        actorOf(request),
        organizationIdOf(request),
        request.params.id,
        request.body
      )
    );
}

/**
 * Handler for `GET /targeting-groups/:id`.
 *
 * @param request - The request, with the TargetingGroup id
 * @param reply - The reply, sent with the TargetingGroup
 * @returns A promise that resolves once the response has been sent
 */
export async function getTargetingGroup(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.targetingGroupService.get(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `PATCH /targeting-groups/:id`.
 *
 * @param request - The request, with the TargetingGroup id and the fields to change
 * @param reply - The reply, sent with the updated TargetingGroup
 * @returns A promise that resolves once the response has been sent
 */
export async function updateTargetingGroup(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: UpdateTargetingGroupBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.targetingGroupService.update(
      actorOf(request),
      organizationIdOf(request),
      request.params.id,
      request.body
    )
  );
}

/**
 * Handler for `DELETE /targeting-groups/:id`.
 *
 * @param request - The request, with the TargetingGroup id
 * @param reply - The reply, sent with the id and the deletion instant
 * @returns A promise that resolves once the response has been sent
 */
export async function deleteTargetingGroup(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.targetingGroupService.delete(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `POST /targeting-groups/:id/restore`.
 *
 * @param request - The request, with the TargetingGroup id
 * @param reply - The reply, sent with the id and `deletedAt` back to `null`
 * @returns A promise that resolves once the response has been sent
 */
export async function restoreTargetingGroup(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.targetingGroupService.restore(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `PUT /targeting-groups/:id/labels`.
 *
 * @param request - The request, with the TargetingGroup id and the complete set of Label ids
 * @param reply - The reply, sent with the TargetingGroup and the Labels it now carries
 * @returns A promise that resolves once the response has been sent
 */
export async function setTargetingGroupLabels(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: SetLabelsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.targetingGroupService.setLabels(
      actorOf(request),
      organizationIdOf(request),
      request.params.id,
      request.body
    )
  );
}

/**
 * Handler for `POST /ad-groups/:id/targeting-groups/bulk`.
 *
 * @param request - The request, with the AdGroup id, the mode and the TargetingGroups to create
 * @param reply - The reply, sent with what was created and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkCreateTargetingGroups(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: BulkCreateTargetingGroupsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.targetingGroupService.bulkCreate(
      actorOf(request),
      organizationIdOf(request),
      request.params.id,
      request.body
    )
  );
}

/**
 * Handler for `PATCH /targeting-groups/bulk`.
 *
 * @param request - The request, with the mode and the changes, each naming its TargetingGroup
 * @param reply - The reply, sent with what was changed and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkUpdateTargetingGroups(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkUpdateTargetingGroupsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.targetingGroupService.bulkUpdate(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `DELETE /targeting-groups/bulk`.
 *
 * @param request - The request, with the mode and the ids
 * @param reply - The reply, sent with what was deleted and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkDeleteTargetingGroups(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkIdsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.targetingGroupService.bulkDelete(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `POST /targeting-groups/bulk/restore`.
 *
 * @param request - The request, with the mode and the ids
 * @param reply - The reply, sent with what was restored and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkRestoreTargetingGroups(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkIdsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.targetingGroupService.bulkRestore(actorOf(request), organizationIdOf(request), request.body));
}
