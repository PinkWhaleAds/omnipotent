import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { IdParam, NodeLevel, SetCampaignStatusBody, SetNodeStatusBody } from '@src/types';
import { actorOf, organizationIdOf } from '@utils';

/**
 * Handler for `GET /campaigns/:id/preview`.
 *
 * @param request - The request, with the campaign id
 * @param reply - The reply, sent with what each platform receives and the findings
 * @returns A promise that resolves once the response has been sent
 */
export async function getPreview(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.previewService.preview(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `POST /campaigns/:id/launch`.
 *
 * @param request - The request, with the campaign id
 * @param reply - The reply, sent with the campaign, now active
 * @returns A promise that resolves once the response has been sent
 */
export async function launchCampaign(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.previewService.launch(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `PUT /campaigns/:id/status`.
 *
 * @param request - The request, with the campaign id and where it goes
 * @param reply - The reply, sent with the campaign in its new state
 * @returns A promise that resolves once the response has been sent
 */
export async function setCampaignStatus(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: SetCampaignStatusBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.previewService.setStatus(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * The handler of `PUT /<level>/:id/status`, for one level below the campaign.
 *
 * @param level - The level its route names
 * @returns The handler
 */
export function setNodeStatusOf(
  level: NodeLevel
): (
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: SetNodeStatusBody }>,
  reply: FastifyReply
) => Promise<void> {
  return async function setNodeStatus(
    this: FastifyInstance,
    request: FastifyRequest<{ Params: IdParam; Body: SetNodeStatusBody }>,
    reply: FastifyReply
  ): Promise<void> {
    reply.send(
      await this.previewService.setNodeStatus(
        actorOf(request),
        organizationIdOf(request),
        level,
        request.params.id,
        request.body
      )
    );
  };
}
