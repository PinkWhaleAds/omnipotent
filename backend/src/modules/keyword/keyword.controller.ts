import type { FastifyInstance } from 'fastify';

import { addKeywords, deleteKeyword, listKeywords, updateKeyword } from './keyword.handler';
import { addKeywordsSchema, deleteKeywordSchema, listKeywordsSchema, updateKeywordSchema } from './keyword.schema';

/**
 * Keywords controller: the words a Search campaign buys, under the TargetingGroup that carries them.
 *
 * Wires URL → schema → handler. Listing and posting live **under the TargetingGroup**, changing and
 * removing live flat on the keyword, since an id carries its own parents — the convention of the tree
 * (`docs/phase-3.md` § 7).
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 */
export default async function KeywordController(fastify: FastifyInstance): Promise<void> {
  fastify.route({
    method: 'GET',
    url: '/targeting-groups/:id/keywords',
    schema: listKeywordsSchema,
    handler: listKeywords,
  });
  fastify.route({
    method: 'POST',
    url: '/targeting-groups/:id/keywords',
    schema: addKeywordsSchema,
    handler: addKeywords,
  });
  fastify.route({ method: 'PATCH', url: '/keywords/:id', schema: updateKeywordSchema, handler: updateKeyword });
  fastify.route({ method: 'DELETE', url: '/keywords/:id', schema: deleteKeywordSchema, handler: deleteKeyword });
}
