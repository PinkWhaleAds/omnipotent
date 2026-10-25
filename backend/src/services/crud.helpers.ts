/**
 * @module services/crud.helpers
 *
 * The mechanics of the **reference CRUD** that every domain resource shares: running a bulk in the
 * mode the caller asked for, turning a sort into TypeORM's order, and filtering a list on labels
 * (`docs/phase-2.md` § 2).
 *
 * A service of a later phase composes these instead of writing them again. What stays in the
 * service is what is specific to its resource: its uniqueness rules, its children, its codes.
 */
import { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';

import { BulkFailure, BulkMode, BulkResult, LabelMode } from '@src/types/crud.types';
import { MessageParams } from '@src/types/error.types';
import { errorCodeOf, statusCodeOf } from '@utils/http.utils';

/** What a bulk item handler gets: the item, its position, and the manager of its transaction. */
export type BulkItemHandler<I, O> = (item: I, index: number, manager: EntityManager) => Promise<O>;

/**
 * Turn a thrown failure into the entry a `partial` bulk reports for it.
 *
 * A failure with no stable code is not reported per item: it is not something the caller can act on,
 * so it is rethrown and becomes a 500 for the whole request.
 *
 * Exported because a resource whose bulk is not one transaction per item — the keywords, judged in
 * memory and inserted in one statement — still reports its refusals in **this** shape
 * (`docs/phase-5.md` § 4).
 *
 * @param error - What the item's handler threw
 * @param index - Its position in the array that was sent
 * @returns The entry for `failed`
 * @throws The error itself when it carries no 4xx status
 *
 * @example
 * ```typescript
 * failed.push(toBulkFailure(error, index));
 * ```
 */
export function toBulkFailure(error: unknown, index: number): BulkFailure {
  const statusCode: number | undefined = statusCodeOf(error);
  const coded: { code: string; params: MessageParams } | undefined = errorCodeOf(error);
  if (statusCode === undefined || statusCode >= 500 || !coded) throw error;
  return { index, code: coded.code, params: coded.params, message: (error as Error).message };
}

/**
 * Run a bulk request in the mode the caller asked for.
 *
 * - **`atomic`** — everything in one transaction: the first failure rolls the whole thing back and
 *   the error travels out, so the caller gets exactly what the single-item route would have
 *   answered.
 * - **`partial`** — one transaction per item, so a failure rolls back only its own item. The answer
 *   carries what succeeded and what did not, and `items` plus `failed` always account for every
 *   element that was sent.
 *
 * Permissions are **not** checked here: the role is asserted once, before the bulk, and a refusal
 * refuses the whole request. Only per-item failures are collected.
 *
 * @typeParam I - Type of one input item
 * @typeParam O - Type of one processed item
 * @param dataSource - Application database
 * @param mode - What to do when an item fails
 * @param items - The items, in the order the caller sent them
 * @param handle - Processes one item inside a transaction
 * @returns What was processed, and what was not
 *
 * @example
 * ```typescript
 * return runBulk(this.dataSource, body.mode, body.items, (item, _index, manager) =>
 *   this.createOne(manager, organizationId, item)
 * );
 * ```
 */
export async function runBulk<I, O>(
  dataSource: DataSource,
  mode: BulkMode,
  items: I[],
  handle: BulkItemHandler<I, O>
): Promise<BulkResult<O>> {
  if (mode === 'atomic') {
    const processed: O[] = await dataSource.transaction(async (manager: EntityManager): Promise<O[]> => {
      const output: O[] = [];
      for (const [index, item] of items.entries()) output.push(await handle(item, index, manager));
      return output;
    });
    return { items: processed, failed: [] };
  }

  const processed: O[] = [];
  const failed: BulkFailure[] = [];
  for (const [index, item] of items.entries()) {
    try {
      processed.push(
        await dataSource.transaction((manager: EntityManager): Promise<O> => handle(item, index, manager))
      );
    } catch (error: unknown) {
      failed.push(toBulkFailure(error, index));
    }
  }
  return { items: processed, failed };
}

/**
 * The order a list route asked for, ended by the primary key.
 *
 * The tie-breaker is not optional: without a total order a row can show on two pages and another on
 * none, which is the bug a reader never reproduces.
 *
 * @param sortBy - The field to sort on, one the resource declared
 * @param sortOrder - Which way
 * @returns The `order` to pass to TypeORM
 *
 * @example
 * ```typescript
 * const [rows, total] = await repository.findAndCount({ where, order: toOrder('name', 'asc'), ...toSkipTake(query) });
 * ```
 */
export function toOrder(sortBy: string, sortOrder: 'asc' | 'desc'): Record<string, 'ASC' | 'DESC'> {
  const direction: 'ASC' | 'DESC' = sortOrder === 'desc' ? 'DESC' : 'ASC';
  return sortBy === 'id' ? { id: direction } : { [sortBy]: direction, id: direction };
}

/**
 * Restrict a list to the resources carrying the asked-for labels (D39).
 *
 * - **`any`** — at least one of them, an `EXISTS` on the assignments;
 * - **`all`** — every one of them, which is the same `EXISTS` plus a count of the distinct labels
 *   matched.
 *
 * The filter is expressed in SQL rather than by loading the assignments: a list of a thousand
 * advertisers must not read a thousand sets of labels to drop most of them.
 *
 * @typeParam T - The entity being listed
 * @param builder - The query being built, its main alias naming the resource's table
 * @param resourceType - The kind of resource, as the assignments store it
 * @param labelIds - The labels asked for; nothing happens when there are none
 * @param labelMode - How they combine
 * @returns The same builder, for chaining
 *
 * @example
 * ```typescript
 * applyLabelFilter(builder, 'advertiser', query.labelIds, query.labelMode);
 * ```
 */
export function applyLabelFilter<T extends object>(
  builder: SelectQueryBuilder<T>,
  resourceType: string,
  labelIds: string[] | undefined,
  labelMode: LabelMode
): SelectQueryBuilder<T> {
  if (!labelIds || labelIds.length === 0) return builder;

  const alias: string = builder.alias;
  const having: string = labelMode === 'all' ? 'HAVING COUNT(DISTINCT assignment.label_id) = :labelCount' : '';
  builder.andWhere(
    `EXISTS (
       SELECT 1 FROM label_assignments assignment
        WHERE assignment.resource_type = :labelResourceType
          AND assignment.resource_id = ${alias}.id
          AND assignment.label_id IN (:...labelIds)
        ${having}
     )`,
    { labelResourceType: resourceType, labelIds, labelCount: labelIds.length }
  );
  return builder;
}
