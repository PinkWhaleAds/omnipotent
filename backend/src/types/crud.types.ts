import { z } from 'zod';

import { messageCodeSchema, messageParamsSchema } from './error.types';
import { paginationQuerySchema } from './api.types';

/**
 * The shared shapes of the **reference CRUD** every domain resource follows: soft-delete and
 * `restore`, bulk at the caller's choice, sorting, and the label filter (D19, D39,
 * `docs/phase-2.md` § 2).
 *
 * Every shape here is **strict**: a field the API does not declare is refused with
 * `validation_failed` (rule `additionalProperties`), never dropped in silence. A resource builds its
 * own bodies strict too, so a typo in a payload is a 400 the caller can see.
 *
 * A phase adding a resource builds its schemas from the helpers here instead of writing them again:
 * a list querystring from {@link listQuerySchema}, a bulk body from {@link bulkBodySchema} and
 * {@link bulkIdsBodySchema}, a bulk response from {@link bulkResultSchema}. That is what keeps the
 * thirty next resources identical for whoever calls them.
 */

/** Most items one bulk request may carry: past that, a request holds a connection and a transaction too long. */
export const MAX_BULK_ITEMS = 200;

/**
 * How a bulk request behaves when one of its items fails.
 *
 * - `atomic` (the default) — one transaction: the first failure cancels everything and answers its
 *   own code, exactly as the single-item route would have.
 * - `partial` — one transaction per item: the answer is **200** with what succeeded and what did
 *   not, even when some items failed.
 *
 * `atomic` is the default because it is the least surprising: either the whole request happened, or
 * none of it did.
 */
export const bulkModeSchema = z.enum(['atomic', 'partial']).default('atomic');

/** TypeScript type inferred from {@link bulkModeSchema}, after the default applies. */
export type BulkMode = z.infer<typeof bulkModeSchema>;

/**
 * Build the Zod schema of a bulk body carrying items.
 *
 * @param item - Schema of one item: a creation body, or an update body with its `id`
 * @returns The schema of `{ mode, items }`
 *
 * @example
 * ```typescript
 * export const bulkCreateAdvertisersBodySchema = bulkBodySchema(createAdvertiserBodySchema);
 * ```
 */
export function bulkBodySchema<T extends z.ZodType>(item: T) {
  return z.strictObject({
    mode: bulkModeSchema,
    items: z.array(item).min(1).max(MAX_BULK_ITEMS),
  });
}

/**
 * Zod schema of a bulk body carrying ids: what `DELETE /<resources>/bulk` and
 * `POST /<resources>/bulk/restore` take.
 *
 * The same id twice is refused (`bulk_ids_duplicated`) rather than silently collapsed: a caller who
 * sends a duplicate has built their list wrong, and a count that does not match what they asked for
 * is worse than a refusal.
 */
export const bulkIdsBodySchema = z.strictObject({
  mode: bulkModeSchema,
  ids: z.array(z.uuid()).min(1).max(MAX_BULK_ITEMS),
});

/** TypeScript type inferred from {@link bulkIdsBodySchema}, after defaults apply. */
export type BulkIdsBody = z.infer<typeof bulkIdsBodySchema>;

/**
 * Zod schema of one item a `partial` bulk could not process.
 *
 * @property index - Its position in the array that was sent, **not** an id: an item refused at
 *   creation has none
 * @property code - Stable code of the failure, the same the single-item route would have answered
 * @property params - The values of its message
 * @property message - The English text, as a fallback
 */
export const bulkFailureSchema = z.object({
  index: z.number().int().min(0),
  code: messageCodeSchema,
  params: messageParamsSchema,
  message: z.string(),
});

/** TypeScript type inferred from {@link bulkFailureSchema}. */
export type BulkFailure = z.infer<typeof bulkFailureSchema>;

/**
 * Build the Zod schema of what a bulk request answers.
 *
 * `items` and `failed` together always hold as many entries as the request carried, so a caller can
 * account for every element it sent. In `atomic` mode `failed` is always empty — a failure there is
 * an error response, not a result.
 *
 * @param item - Schema of one processed item
 * @returns The schema of `{ items, failed }`
 *
 * @example
 * ```typescript
 * export const bulkAdvertiserResultSchema = bulkResultSchema(advertiserSchema);
 * ```
 */
export function bulkResultSchema<T extends z.ZodType>(
  item: T
): z.ZodObject<{ items: z.ZodArray<T>; failed: z.ZodArray<typeof bulkFailureSchema> }> {
  return z.object({
    items: z.array(item),
    failed: z.array(bulkFailureSchema),
  });
}

/**
 * A page of items a bulk request processed, and what it could not.
 *
 * @typeParam T - Type of one item
 * @property items - What was processed, in the order it was sent
 * @property failed - What was not, with its position and its code; always empty in `atomic` mode
 */
export type BulkResult<T> = {
  items: T[];
  failed: BulkFailure[];
};

/**
 * How several labels combine in a list filter (D39).
 *
 * `any` is the default — « show me everything marked *Q1* or *Q2* » is the frequent use — and `all`
 * stays available to cross two axes.
 */
export const labelModeSchema = z.enum(['any', 'all']).default('any');

/** TypeScript type inferred from {@link labelModeSchema}, after the default applies. */
export type LabelMode = z.infer<typeof labelModeSchema>;

/**
 * Which way a list is sorted.
 */
export const sortOrderSchema = z.enum(['asc', 'desc']).default('asc');

/** TypeScript type inferred from {@link sortOrderSchema}, after the default applies. */
export type SortOrder = z.infer<typeof sortOrderSchema>;

/**
 * The querystring every list route shares: the page, the sort, the text search, the label filter and
 * whether the deleted ones are listed.
 *
 * `sortBy` is **declared** by each resource, never guessed: a field a resource does not declare
 * answers `validation_failed` rather than being silently ignored, because a sort that does nothing
 * is a bug nobody sees.
 *
 * @param sortableFields - The fields this resource accepts to sort on, the first being its default
 * @returns The querystring schema
 *
 * @example
 * ```typescript
 * export const listAdvertisersQuerySchema = listQuerySchema(['name', 'createdAt', 'updatedAt']);
 * ```
 */
export function listQuerySchema<const Fields extends readonly [string, ...string[]]>(sortableFields: Fields) {
  return paginationQuerySchema.extend({
    sortBy: z.enum(sortableFields).default(sortableFields[0]),
    sortOrder: sortOrderSchema,
    search: z.string().trim().min(1).max(255).optional(),
    labelIds: z.array(z.uuid()).min(1).max(MAX_BULK_ITEMS).optional(),
    labelMode: labelModeSchema,
    includeDeleted: z.boolean().default(false),
  });
}

/**
 * What a list route reads, whatever the resource: the shape {@link listQuerySchema} produces, with
 * its sortable field left open so a service can take any resource's query.
 *
 * @property page - 1-based page number
 * @property limit - Items per page
 * @property sortBy - The field to sort on, one this resource declared
 * @property sortOrder - Which way
 * @property search - Text the name must contain, without case or accents
 * @property labelIds - Labels to filter on
 * @property labelMode - How they combine
 * @property includeDeleted - Whether the soft-deleted ones are listed too
 */
export type ListQuery = {
  page: number;
  limit: number;
  sortBy: string;
  sortOrder: SortOrder;
  search?: string;
  labelIds?: string[];
  labelMode: LabelMode;
  includeDeleted: boolean;
};

/**
 * Zod schema of the body posting labels on a resource: the **complete** list of label ids.
 *
 * It replaces rather than adds, which makes it idempotent — the interface sends what the user sees,
 * and sending the same body twice changes nothing the second time.
 */
export const setLabelsBodySchema = z.strictObject({
  labelIds: z.array(z.uuid()).max(MAX_BULK_ITEMS),
});

/** TypeScript type inferred from {@link setLabelsBodySchema}. */
export type SetLabelsBody = z.infer<typeof setLabelsBodySchema>;

/**
 * Zod schema of what a deletion or a restoration answers.
 *
 * @property id - The resource
 * @property deletedAt - When it was deleted (ISO 8601), `null` after a restoration
 */
export const deletionResultSchema = z.object({
  id: z.uuid(),
  deletedAt: z.iso.datetime().nullable(),
});

/** TypeScript type inferred from {@link deletionResultSchema}. */
export type DeletionResult = z.infer<typeof deletionResultSchema>;

/**
 * Zod schema of what a bulk deletion or restoration answers.
 *
 * The same shape whatever the resource: a bulk of deletions carries no resource, only ids and the
 * instant each one was deleted at.
 */
export const bulkDeletionResultSchema = bulkResultSchema(deletionResultSchema);
