import { z } from 'zod';

import { paginatedSchema, paginationQuerySchema } from './api.types';
import { bulkModeSchema, bulkResultSchema } from './crud.types';

/** How closely a query must match a keyword (Google and Microsoft; the LLM platforms read hints). */
export const matchTypeSchema = z.enum(['broad', 'phrase', 'exact']);

/** TypeScript type inferred from {@link matchTypeSchema}. */
export type MatchType = z.infer<typeof matchTypeSchema>;

/** How many keywords one request posts, as multi-search has proven it. */
export const MAX_KEYWORDS_PER_REQUEST = 500;

/** How long a keyword is, and how many words it holds, as the Search platforms accept it. */
export const MAX_KEYWORD_LENGTH = 80;

/** How many words one keyword holds. */
export const MAX_KEYWORD_WORDS = 10;

/** The text of a keyword, trimmed; the service lower-cases it and collapses its spaces. */
const keywordTextSchema = z.string().trim().min(1).max(MAX_KEYWORD_LENGTH);

/**
 * Zod schema of a keyword as returned by the API.
 *
 * @property id - Keyword id
 * @property targetingGroupId - TargetingGroup it belongs to: all the targeting lives there
 * @property text - The keyword, lower-cased with single spaces
 * @property matchType - How closely a query must match it
 * @property negative - A negative keyword prevents delivery instead of triggering it
 * @property createdAt - Creation date (ISO 8601)
 */
export const keywordSchema = z.object({
  id: z.uuid(),
  targetingGroupId: z.uuid(),
  text: z.string(),
  matchType: matchTypeSchema,
  negative: z.boolean(),
  createdAt: z.iso.datetime(),
});

/** TypeScript type inferred from {@link keywordSchema}. */
export type Keyword = z.infer<typeof keywordSchema>;

/** Zod schema of a page of keywords. */
export const keywordPageSchema = paginatedSchema(keywordSchema);

/**
 * Zod schema of the querystring listing the keywords of a TargetingGroup.
 *
 * The querystring is validated by AJV, which coerces `?negative=true`; the MCP tools send a real
 * boolean. One schema serves both, as `includeDeleted` already does elsewhere.
 *
 * @property negative - Only the positive ones (`false`) or only the negative ones (`true`)
 */
export const listKeywordsQuerySchema = paginationQuerySchema.extend({
  negative: z.boolean().optional(),
});

/** TypeScript type inferred from {@link listKeywordsQuerySchema}, after defaults apply. */
export type ListKeywordsQuery = z.infer<typeof listKeywordsQuerySchema>;

/**
 * Zod schema of the body posting keywords on a TargetingGroup.
 *
 * A keyword the TargetingGroup already carries — same text, same match type, same polarity — is
 * **not a failure**: it is answered as it stands, so posting a list twice changes nothing. What fails
 * is a text the platforms would refuse (`docs/phase-5.md` § 4).
 *
 * @property mode - `atomic` refuses the whole request on the first refusal, `partial` reports it
 * @property keywords - The keywords: a text, a match type (default `broad`), a polarity (default positive)
 */
export const addKeywordsBodySchema = z.strictObject({
  mode: bulkModeSchema,
  keywords: z
    .array(
      z.strictObject({
        text: keywordTextSchema,
        matchType: matchTypeSchema.default('broad'),
        negative: z.boolean().default(false),
      })
    )
    .min(1)
    .max(MAX_KEYWORDS_PER_REQUEST),
});

/** TypeScript type inferred from {@link addKeywordsBodySchema}, after defaults apply. */
export type AddKeywordsBody = z.infer<typeof addKeywordsBodySchema>;

/**
 * Zod schema of the body changing one keyword.
 *
 * @property matchType - New match type
 * @property negative - New polarity
 */
export const updateKeywordBodySchema = z.strictObject({
  matchType: matchTypeSchema.optional(),
  negative: z.boolean().optional(),
});

/** TypeScript type inferred from {@link updateKeywordBodySchema}. */
export type UpdateKeywordBody = z.infer<typeof updateKeywordBodySchema>;

/** Zod schema of what posting keywords answers: what the TargetingGroup now carries, and what failed. */
export const addKeywordsResultSchema = bulkResultSchema(keywordSchema);

/**
 * Zod schema of what removing a keyword answers.
 *
 * A keyword is **deleted outright**, so there is no `deletedAt` to answer as the soft-deleted
 * resources do: what the caller needs to know is that it is gone (`docs/phase-5.md` § 4).
 *
 * @property id - The keyword that was removed
 * @property deleted - Always `true`: a removal that did not happen is a 404
 */
export const keywordRemovalSchema = z.object({
  id: z.uuid(),
  deleted: z.literal(true),
});

/** TypeScript type inferred from {@link keywordRemovalSchema}. */
export type KeywordRemoval = z.infer<typeof keywordRemovalSchema>;
