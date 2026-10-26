import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { creativeCatalog } from '@src/creatives/creative-formats';
import {
  BulkCreateCreativesBody,
  BulkIdsBody,
  BulkUpdateCreativesBody,
  CreateCreativeBody,
  CreateCreativeVersionBody,
  IdParam,
  ListCreativeVersionsQuery,
  ListCreativesQuery,
  SetLabelsBody,
  UpdateCreativeBody,
} from '@src/types';
import { actorOf, organizationIdOf } from '@utils';

/**
 * Handler for `GET /creative-formats`.
 *
 * The registry belongs to no Organization and reads nothing, so it needs no role beyond being
 * authenticated — a model may read it before it knows where it works.
 *
 * @param _request - The request, which carries nothing
 * @param reply - The reply, sent with the registry
 * @returns A promise that resolves once the response has been sent
 */
export async function getCreativeFormats(
  this: FastifyInstance,
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  reply.send({ couples: creativeCatalog() });
}

/**
 * Handler for `GET /advertisers/:id/creatives`.
 *
 * @param request - The request, with the Advertiser id and the page
 * @param reply - The reply, sent with a page of creatives
 * @returns A promise that resolves once the response has been sent
 */
export async function listCreatives(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Querystring: ListCreativesQuery }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.creativeService.list(actorOf(request), organizationIdOf(request), request.params.id, request.query)
  );
}

/**
 * Handler for `POST /advertisers/:id/creatives`.
 *
 * @param request - The request, with the Advertiser id, the creative and its first version
 * @param reply - The reply, sent with the created creative (201)
 * @returns A promise that resolves once the response has been sent
 */
export async function createCreative(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: CreateCreativeBody }>,
  reply: FastifyReply
): Promise<void> {
  reply
    .code(201)
    .send(
      await this.creativeService.create(actorOf(request), organizationIdOf(request), request.params.id, request.body)
    );
}

/**
 * Handler for `GET /creatives/:id`.
 *
 * @param request - The request, with the creative id
 * @param reply - The reply, sent with the creative
 * @returns A promise that resolves once the response has been sent
 */
export async function getCreative(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.creativeService.get(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `PATCH /creatives/:id`.
 *
 * @param request - The request, with the creative id and the fields to change
 * @param reply - The reply, sent with the updated creative
 * @returns A promise that resolves once the response has been sent
 */
export async function updateCreative(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: UpdateCreativeBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.creativeService.update(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `DELETE /creatives/:id`.
 *
 * @param request - The request, with the creative id
 * @param reply - The reply, sent with its id and when it was deleted
 * @returns A promise that resolves once the response has been sent
 */
export async function deleteCreative(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.creativeService.delete(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `POST /creatives/:id/restore`.
 *
 * @param request - The request, with the creative id
 * @param reply - The reply, sent with its id and `deletedAt` back to `null`
 * @returns A promise that resolves once the response has been sent
 */
export async function restoreCreative(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.creativeService.restore(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `PUT /creatives/:id/labels`.
 *
 * @param request - The request, with the creative id and the complete set of Labels
 * @param reply - The reply, sent with the creative
 * @returns A promise that resolves once the response has been sent
 */
export async function setCreativeLabels(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: SetLabelsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.creativeService.setLabels(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `GET /creatives/:id/versions`.
 *
 * @param request - The request, with the creative id and the page
 * @param reply - The reply, sent with a page of versions
 * @returns A promise that resolves once the response has been sent
 */
export async function listCreativeVersions(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Querystring: ListCreativeVersionsQuery }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.creativeService.listVersions(
      actorOf(request),
      organizationIdOf(request),
      request.params.id,
      request.query
    )
  );
}

/**
 * Handler for `POST /creatives/:id/versions`.
 *
 * @param request - The request, with the creative id and the version to add
 * @param reply - The reply, sent with the created version (201)
 * @returns A promise that resolves once the response has been sent
 */
export async function createCreativeVersion(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: CreateCreativeVersionBody }>,
  reply: FastifyReply
): Promise<void> {
  reply
    .code(201)
    .send(
      await this.creativeService.createVersion(
        actorOf(request),
        organizationIdOf(request),
        request.params.id,
        request.body
      )
    );
}

/**
 * Handler for `GET /creative-versions/:id`.
 *
 * @param request - The request, with the version id
 * @param reply - The reply, sent with the version and its assets
 * @returns A promise that resolves once the response has been sent
 */
export async function getCreativeVersion(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.creativeService.getVersion(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `POST /creative-versions/:id/activate`.
 *
 * @param request - The request, with the version id
 * @param reply - The reply, sent with the version, now active
 * @returns A promise that resolves once the response has been sent
 */
export async function activateCreativeVersion(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.creativeService.activateVersion(actorOf(request), organizationIdOf(request), request.params.id)
  );
}

/**
 * Handler for `POST /advertisers/:id/creatives/bulk`.
 *
 * @param request - The request, with the Advertiser id, the mode and the creatives
 * @param reply - The reply, sent with what was created and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkCreateCreatives(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: BulkCreateCreativesBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.creativeService.bulkCreate(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `PATCH /creatives/bulk`.
 *
 * @param request - The request, with the mode and the creatives to change
 * @param reply - The reply, sent with what was changed and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkUpdateCreatives(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkUpdateCreativesBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.creativeService.bulkUpdate(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `DELETE /creatives/bulk`.
 *
 * @param request - The request, with the mode and the ids
 * @param reply - The reply, sent with what was deleted and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkDeleteCreatives(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkIdsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.creativeService.bulkDelete(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `POST /creatives/bulk/restore`.
 *
 * @param request - The request, with the mode and the ids
 * @param reply - The reply, sent with what was restored and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkRestoreCreatives(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkIdsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.creativeService.bulkRestore(actorOf(request), organizationIdOf(request), request.body));
}
