import { z } from 'zod';

/**
 * Zod schema of the values a coded message carries (a platform, a count, a name), so that a client
 * can write the message in its own language from its `code`.
 *
 * An object with a catch-all rather than a record: a record's `propertyNames` trips the response
 * serializer in strict mode.
 *
 * @example
 * ```typescript
 * messageParamsSchema.parse({ platform: 'google_ads', max: 3 });
 * ```
 */
export const messageParamsSchema = z.object({}).catchall(z.union([z.string(), z.number(), z.boolean(), z.null()]));

/** TypeScript type inferred from {@link messageParamsSchema}. */
export type MessageParams = z.infer<typeof messageParamsSchema>;

/**
 * Stable code of a message: lower case snake_case, the key a client translates.
 *
 * @example
 * ```typescript
 * messageCodeSchema.parse('campaign_not_draft');
 * ```
 */
export const messageCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

/**
 * Zod schema for the error payload returned by every failing route.
 *
 * Single source of truth for the error shape — used to infer
 * {@link ErrorResponse}, to serialize failures in
 * `src/plugins/error-handler.plugin.ts`, and to document the non-2xx
 * responses of a route via `toJsonSchema` from `@utils`.
 *
 * @example
 * ```typescript
 * import { errorResponseSchema } from '@src/types';
 * import { toJsonSchema } from '@utils';
 *
 * export const getFooSchema: FastifySchema = {
 *   response: { 200: toJsonSchema(fooSchema), 404: toJsonSchema(errorResponseSchema) },
 * };
 * ```
 */
export const errorResponseSchema = z.object({
  statusCode: z.number(),
  error: z.string(),
  code: z.string(),
  params: messageParamsSchema,
  message: z.string(),
  requestId: z.string(),
});

/**
 * TypeScript type inferred from {@link errorResponseSchema}.
 *
 * @property statusCode - The HTTP status code of the response
 * @property error - The status reason phrase (e.g. 'Not Found')
 * @property code - Stable code of the failure (`campaign_not_draft`, `validation_failed`, `not_found`…), to translate
 * @property params - The values of the message, for its translation
 * @property message - A human-readable description of what went wrong, in English
 * @property requestId - The Fastify request id, to correlate the response with the logs
 */
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
