import type { FastifyInstance } from 'fastify';

import { getMe } from './me.handler';
import { getMeSchema } from './me.schema';

/**
 * Routes of the caller: who omnipass says they are.
 *
 * @param fastify - The Fastify instance
 * @returns A promise that resolves once the routes are registered
 */
export default async function MeController(fastify: FastifyInstance): Promise<void> {
  fastify.route({ method: 'GET', url: '/me', schema: getMeSchema, handler: getMe });
}
