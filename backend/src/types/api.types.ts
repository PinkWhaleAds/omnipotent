import { z } from 'zod';

/**
 * Header naming the Organization an org-scoped request acts on.
 *
 * Every route working on data owned by an Organization (advertisers, members,
 * and later campaigns) reads it; the caller must have a role in that Organization.
 */
export const ORGANIZATION_HEADER = 'x-organization-id';

/**
 * Zod schema of the headers of an org-scoped route.
 *
 * Declared on the route so Fastify rejects a missing or malformed header with a
 * 400 and Swagger documents it.
 */
export const organizationHeadersSchema = z.object({
  [ORGANIZATION_HEADER]: z.uuid(),
});

/**
 * Zod schema for a route parameter carrying a resource id.
 *
 * @example
 * ```typescript
 * params: toJsonSchema(idParamSchema, 'input') // GET /advertisers/:id
 * ```
 */
export const idParamSchema = z.object({
  id: z.uuid(),
});

/** TypeScript type inferred from {@link idParamSchema}. */
export type IdParam = z.infer<typeof idParamSchema>;

/** Default number of items per page. */
export const DEFAULT_PAGE_SIZE = 50;

/** Largest page a caller may ask for. */
export const MAX_PAGE_SIZE = 200;

/**
 * Highest page number a caller may ask for: an offset past millions of rows makes the database read and discard
 * them all, for a page nobody reads.
 */
export const MAX_PAGE = 10_000;

/**
 * Zod schema for the pagination querystring shared by every list route.
 *
 * @property page - 1-based page number, at most {@link MAX_PAGE}
 * @property limit - Number of items per page, at most {@link MAX_PAGE_SIZE}
 */
export const paginationQuerySchema = z.object({
  page: z.number().int().min(1).max(MAX_PAGE).default(1),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

/** TypeScript type inferred from {@link paginationQuerySchema}, after defaults apply. */
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Build the Zod schema of a page of items.
 *
 * @param item - Schema of one item
 * @returns The schema of `{ items, total, page, limit }`
 *
 * @example
 * ```typescript
 * export const advertiserPageSchema = paginatedSchema(advertiserSchema);
 * ```
 */
export function paginatedSchema<T extends z.ZodType>(
  item: T
): z.ZodObject<{ items: z.ZodArray<T>; total: z.ZodNumber; page: z.ZodNumber; limit: z.ZodNumber }> {
  return z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
  });
}

/**
 * A page of items, as returned by every list route and list tool.
 *
 * @typeParam T - Type of one item
 * @property items - Items of the requested page
 * @property total - Number of items across all pages
 * @property page - The page returned
 * @property limit - The page size used
 */
export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
};
