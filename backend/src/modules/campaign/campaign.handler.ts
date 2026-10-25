import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  BulkCreateCampaignsBody,
  BulkIdsBody,
  BulkUpdateCampaignsBody,
  CreateCampaignBody,
  IdParam,
  ListCampaignsQuery,
  SetLabelsBody,
  UpdateCampaignBody,
} from '@src/types';
import { actorOf, organizationIdOf } from '@utils';

/**
 * Handler for `GET /advertisers/:id/campaigns`.
 *
 * @param request - The request, with the Advertiser id and the page
 * @param reply - The reply, sent with a page of Campaigns
 * @returns A promise that resolves once the response has been sent
 */
export async function listCampaigns(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Querystring: ListCampaignsQuery }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.campaignService.list(actorOf(request), organizationIdOf(request), request.params.id, request.query)
  );
}

/**
 * Handler for `POST /advertisers/:id/campaigns`.
 *
 * @param request - The request, with the Advertiser id and the Campaign to create
 * @param reply - The reply, sent with the created Campaign (201)
 * @returns A promise that resolves once the response has been sent
 */
export async function createCampaign(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: CreateCampaignBody }>,
  reply: FastifyReply
): Promise<void> {
  reply
    .code(201)
    .send(
      await this.campaignService.create(actorOf(request), organizationIdOf(request), request.params.id, request.body)
    );
}

/**
 * Handler for `GET /campaigns/:id`.
 *
 * @param request - The request, with the Campaign id
 * @param reply - The reply, sent with the Campaign
 * @returns A promise that resolves once the response has been sent
 */
export async function getCampaign(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.campaignService.get(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `PATCH /campaigns/:id`.
 *
 * @param request - The request, with the Campaign id and the fields to change
 * @param reply - The reply, sent with the updated Campaign
 * @returns A promise that resolves once the response has been sent
 */
export async function updateCampaign(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: UpdateCampaignBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.campaignService.update(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `DELETE /campaigns/:id`.
 *
 * @param request - The request, with the Campaign id
 * @param reply - The reply, sent with the id and the deletion instant
 * @returns A promise that resolves once the response has been sent
 */
export async function deleteCampaign(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.campaignService.delete(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `POST /campaigns/:id/restore`.
 *
 * @param request - The request, with the Campaign id
 * @param reply - The reply, sent with the id and `deletedAt` back to `null`
 * @returns A promise that resolves once the response has been sent
 */
export async function restoreCampaign(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.campaignService.restore(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `PUT /campaigns/:id/labels`.
 *
 * @param request - The request, with the Campaign id and the complete set of Label ids
 * @param reply - The reply, sent with the Campaign and the Labels it now carries
 * @returns A promise that resolves once the response has been sent
 */
export async function setCampaignLabels(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: SetLabelsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.campaignService.setLabels(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `POST /advertisers/:id/campaigns/bulk`.
 *
 * @param request - The request, with the Advertiser id, the mode and the Campaigns to create
 * @param reply - The reply, sent with what was created and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkCreateCampaigns(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: BulkCreateCampaignsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.campaignService.bulkCreate(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `PATCH /campaigns/bulk`.
 *
 * @param request - The request, with the mode and the changes, each naming its Campaign
 * @param reply - The reply, sent with what was changed and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkUpdateCampaigns(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkUpdateCampaignsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.campaignService.bulkUpdate(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `DELETE /campaigns/bulk`.
 *
 * @param request - The request, with the mode and the ids
 * @param reply - The reply, sent with what was deleted and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkDeleteCampaigns(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkIdsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.campaignService.bulkDelete(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `POST /campaigns/bulk/restore`.
 *
 * @param request - The request, with the mode and the ids
 * @param reply - The reply, sent with what was restored and what was not
 * @returns A promise that resolves once the response has been sent
 */
export async function bulkRestoreCampaigns(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: BulkIdsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.campaignService.bulkRestore(actorOf(request), organizationIdOf(request), request.body));
}
