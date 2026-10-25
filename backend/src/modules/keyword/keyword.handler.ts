import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { AddKeywordsBody, IdParam, ListKeywordsQuery, UpdateKeywordBody } from '@src/types';
import { actorOf, organizationIdOf } from '@utils';

/**
 * Handler for `GET /targeting-groups/:id/keywords`.
 *
 * @param request - The request, with the TargetingGroup id, the page and the polarity filter
 * @param reply - The reply, sent with a page of keywords
 * @returns A promise that resolves once the response has been sent
 */
export async function listKeywords(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Querystring: ListKeywordsQuery }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.keywordService.list(actorOf(request), organizationIdOf(request), request.params.id, request.query)
  );
}

/**
 * Handler for `POST /targeting-groups/:id/keywords`.
 *
 * Answers **200**, like every bulk of the API: what the node carries for each line sent, and what was
 * refused, both in the same shape whatever the mode (`docs/phase-2.md` § 2).
 *
 * @param request - The request, with the TargetingGroup id, the mode and the keywords
 * @param reply - The reply, sent with what the node now carries and what failed
 * @returns A promise that resolves once the response has been sent
 */
export async function addKeywords(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: AddKeywordsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.keywordService.add(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `PATCH /keywords/:id`.
 *
 * @param request - The request, with the keyword id and what to change
 * @param reply - The reply, sent with the keyword
 * @returns A promise that resolves once the response has been sent
 */
export async function updateKeyword(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: UpdateKeywordBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.keywordService.update(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `DELETE /keywords/:id`.
 *
 * @param request - The request, with the keyword id
 * @param reply - The reply, sent with its id and that it is gone
 * @returns A promise that resolves once the response has been sent
 */
export async function deleteKeyword(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.keywordService.remove(actorOf(request), organizationIdOf(request), request.params.id));
}
