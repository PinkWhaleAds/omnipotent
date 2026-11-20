import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { actorOf } from '@utils';

/**
 * Handler for `GET /me`: what omnipass answered for the caller, as it answered it.
 *
 * No service: there is nothing to check nor to read — the auth plugin resolved the caller through
 * omnipass before the handler runs, and the snapshot is the contract's own shape.
 *
 * @param this - The Fastify instance
 * @param request - The request
 * @param reply - The reply
 * @returns A promise that resolves once sent
 */
export async function getMe(this: FastifyInstance, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  reply.send(actorOf(request).tenancy);
}
