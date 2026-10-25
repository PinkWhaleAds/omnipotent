import { z } from 'zod';

import { paginatedSchema } from './api.types';
import { bulkBodySchema, bulkResultSchema, listQuerySchema } from './crud.types';
import { listKindSchema } from './targeting.types';

/** Fields a list of lists may be sorted on; the first is the default. */
export const LIST_SORTABLE_FIELDS = ['name', 'createdAt', 'updatedAt'] as const;

/** How many items one list holds: enough for a blocklist of sites, bounded so a write stays a write. */
export const MAX_LIST_ITEMS = 50_000;

/** Name of a list, unique among the live lists of its kind in its Organization. */
const listNameSchema = z.string().trim().min(1).max(255);

/**
 * Zod schema of one item of a list.
 *
 * One shape for every kind: the value the platform knows, what a human reads, and the denormalized
 * values the adapters need — the doctrine of § 6 of `docs/phase-5.md`, which is also why a
 * referential being unreachable never stops what is already composed.
 *
 * @property value - What travels to the platform
 * @property label - What an interface shows, when the value is not readable on its own
 * @property metadata - Flat, scalar values the adapters need: coordinates, régie, country, match type
 */
export const listItemSchema = z.strictObject({
  value: z.string().trim().min(1).max(512),
  label: z.string().trim().min(1).max(512).optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

/** TypeScript type inferred from {@link listItemSchema}. */
export type ListItemInput = z.infer<typeof listItemSchema>;

/**
 * Zod schema of a list as returned by the API.
 *
 * @property id - List id
 * @property organizationId - Organization owning it, an opaque uuid from omnipass
 * @property kind - What it holds, which decides the dimensions it plugs into
 * @property name - Its name
 * @property items - Its items, in the order they were posted
 * @property itemCount - How many it holds, so a list of lists needs no counting
 * @property createdAt - Creation date (ISO 8601)
 * @property updatedAt - Last update date (ISO 8601)
 * @property deletedAt - Deletion date (ISO 8601), `null` while it lives
 */
export const listSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  kind: listKindSchema,
  name: z.string(),
  items: z.array(listItemSchema),
  itemCount: z.number().int().min(0),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});

/** TypeScript type inferred from {@link listSchema}. */
export type List = z.infer<typeof listSchema>;

/** Zod schema of a page of lists. */
export const listPageSchema = paginatedSchema(listSchema);

/**
 * Zod schema of the querystring listing lists.
 *
 * The Label filter is left out: a list is a tool, not something a campaign is organized by, and it
 * carries no Label — the same reason a Label itself carries none.
 *
 * @property kind - Only the lists of that kind
 */
export const listListsQuerySchema = listQuerySchema(LIST_SORTABLE_FIELDS)
  .omit({ labelIds: true, labelMode: true })
  .extend({ kind: listKindSchema.optional() });

/** TypeScript type inferred from {@link listListsQuerySchema}, after defaults apply. */
export type ListListsQuery = z.infer<typeof listListsQuerySchema>;

/**
 * Zod schema of the body creating a list.
 *
 * @property kind - What it holds; it never changes afterwards, a targeting pointing at it by kind
 * @property name - Its name
 * @property items - Its items
 */
export const createListBodySchema = z.strictObject({
  kind: listKindSchema,
  name: listNameSchema,
  items: z.array(listItemSchema).max(MAX_LIST_ITEMS).optional(),
});

/** TypeScript type inferred from {@link createListBodySchema}. */
export type CreateListBody = z.infer<typeof createListBodySchema>;

/**
 * Zod schema of the body updating a list. A field left out is left alone.
 *
 * The **kind cannot change**: dimensions reference a list by what it holds, so turning a list of
 * sites into a list of POIs would silently break every targeting pointing at it.
 *
 * @property name - New name
 * @property items - The complete new set of items, replacing what it had
 */
export const updateListBodySchema = z.strictObject({
  name: listNameSchema.optional(),
  items: z.array(listItemSchema).max(MAX_LIST_ITEMS).optional(),
});

/** TypeScript type inferred from {@link updateListBodySchema}. */
export type UpdateListBody = z.infer<typeof updateListBodySchema>;

/**
 * Zod schema of the body duplicating or moving a list into another Organization of the Seat.
 *
 * @property organizationId - Where it goes; it must be another Organization of the same Seat
 */
export const transferListBodySchema = z.strictObject({
  organizationId: z.uuid(),
});

/** TypeScript type inferred from {@link transferListBodySchema}. */
export type TransferListBody = z.infer<typeof transferListBodySchema>;

/** Zod schema of the body creating several lists. */
export const bulkCreateListsBodySchema = bulkBodySchema(createListBodySchema);

/** TypeScript type inferred from {@link bulkCreateListsBodySchema}, after defaults apply. */
export type BulkCreateListsBody = z.infer<typeof bulkCreateListsBodySchema>;

/** Zod schema of the body updating several lists: each item names the one it changes. */
export const bulkUpdateListsBodySchema = bulkBodySchema(updateListBodySchema.extend({ id: z.uuid() }));

/** TypeScript type inferred from {@link bulkUpdateListsBodySchema}, after defaults apply. */
export type BulkUpdateListsBody = z.infer<typeof bulkUpdateListsBodySchema>;

/** Zod schema of what a bulk of lists answers. */
export const bulkListResultSchema = bulkResultSchema(listSchema);
