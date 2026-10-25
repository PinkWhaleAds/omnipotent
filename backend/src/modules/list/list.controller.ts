import type { FastifyInstance } from 'fastify';

import {
  bulkCreateLists,
  bulkDeleteLists,
  bulkRestoreLists,
  bulkUpdateLists,
  createList,
  deleteList,
  duplicateList,
  getList,
  listLists,
  moveList,
  restoreList,
  updateList,
} from './list.handler';
import {
  bulkCreateListsSchema,
  bulkDeleteListsSchema,
  bulkRestoreListsSchema,
  bulkUpdateListsSchema,
  createListSchema,
  deleteListSchema,
  duplicateListSchema,
  getListSchema,
  listListsSchema,
  moveListSchema,
  restoreListSchema,
  updateListSchema,
} from './list.schema';

/**
 * Lists controller: the reusable lists of an Organization, and their travels inside the Seat.
 *
 * Wires URL → schema → handler. The reference CRUD of `docs/phase-2.md`, without the labels — a list
 * is a tool, not something a campaign is organized by — plus the duplication and the move of
 * `../../CADRAGE.md` § 8.
 *
 * The bulk routes are declared **before** `/lists/:id`, so `bulk` is never read as an id.
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 */
export default async function ListController(fastify: FastifyInstance): Promise<void> {
  fastify.route({ method: 'GET', url: '/lists', schema: listListsSchema, handler: listLists });
  fastify.route({ method: 'POST', url: '/lists', schema: createListSchema, handler: createList });
  fastify.route({ method: 'POST', url: '/lists/bulk', schema: bulkCreateListsSchema, handler: bulkCreateLists });
  fastify.route({ method: 'PATCH', url: '/lists/bulk', schema: bulkUpdateListsSchema, handler: bulkUpdateLists });
  fastify.route({ method: 'DELETE', url: '/lists/bulk', schema: bulkDeleteListsSchema, handler: bulkDeleteLists });
  fastify.route({
    method: 'POST',
    url: '/lists/bulk/restore',
    schema: bulkRestoreListsSchema,
    handler: bulkRestoreLists,
  });
  fastify.route({ method: 'GET', url: '/lists/:id', schema: getListSchema, handler: getList });
  fastify.route({ method: 'PATCH', url: '/lists/:id', schema: updateListSchema, handler: updateList });
  fastify.route({ method: 'DELETE', url: '/lists/:id', schema: deleteListSchema, handler: deleteList });
  fastify.route({ method: 'POST', url: '/lists/:id/restore', schema: restoreListSchema, handler: restoreList });
  fastify.route({
    method: 'POST',
    url: '/lists/:id/duplicate',
    schema: duplicateListSchema,
    handler: duplicateList,
  });
  fastify.route({ method: 'POST', url: '/lists/:id/move', schema: moveListSchema, handler: moveList });
}
