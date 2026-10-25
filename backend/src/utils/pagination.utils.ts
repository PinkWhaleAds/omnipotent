import type { Paginated, PaginationQuery } from '@src/types/api.types';

/**
 * Translate a page request into the `skip` / `take` pair TypeORM expects.
 *
 * The read must have a total order, or a row may show on two pages and another on none: end it with
 * the primary key (`id: 'ASC'`) unless a unique column already orders it.
 *
 * @param query - The requested page and page size
 * @returns The number of rows to skip and to take
 *
 * @example
 * ```typescript
 * toSkipTake({ page: 3, limit: 20 }); // { skip: 40, take: 20 }
 * ```
 */
export function toSkipTake(query: PaginationQuery): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.limit, take: query.limit };
}

/**
 * Wrap the rows of one page into the {@link Paginated} shape every list returns.
 *
 * @param items - Items of the page, already mapped to their API shape
 * @param total - Number of items across all pages
 * @param query - The page request that produced them
 * @returns The page
 *
 * @example
 * ```typescript
 * const [rows, total] = await repository.findAndCount({ ...toSkipTake(query) });
 * return toPage(rows.map(toAdvertiser), total, query);
 * ```
 */
export function toPage<T>(items: T[], total: number, query: PaginationQuery): Paginated<T> {
  return { items, total, page: query.page, limit: query.limit };
}
