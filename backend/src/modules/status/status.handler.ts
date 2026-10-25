import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Handler for `GET /status`.
 *
 * Responds with the application name, version, and the current Unix timestamp
 * in milliseconds. Uses `this: FastifyInstance` to reach the decorated
 * `statusService`.
 *
 * @param request - The incoming Fastify request
 * @param reply - The Fastify reply used to send the response
 * @returns A promise that resolves once the response has been sent
 */
export async function getStatus(this: FastifyInstance, _request: FastifyRequest, reply: FastifyReply): Promise<void> {
  reply.send(this.statusService.getStatus());
}
