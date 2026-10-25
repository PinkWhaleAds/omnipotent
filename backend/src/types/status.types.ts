import { z } from 'zod';

/**
 * Zod schema defining the shape of a status response.
 *
 * Single source of truth for the status data structure — used to:
 * - Infer the `StatusResult` TypeScript type via `z.infer`
 * - Generate JSON Schema for Fastify route validation via `toJsonSchema` from `@utils`
 * - Validate MCP tool output
 *
 * @example
 * ```typescript
 * import { toJsonSchema } from '@utils';
 *
 * const parsed: StatusResult = statusResultSchema.parse(data);
 * const jsonSchema: unknown = toJsonSchema(statusResultSchema);
 * ```
 */
export const statusResultSchema: z.ZodObject<{
  app_name: z.ZodString;
  app_version: z.ZodString;
  timestamp: z.ZodNumber;
}> = z.object({
  app_name: z.string(),
  app_version: z.string(),
  timestamp: z.number(),
});

/**
 * TypeScript type inferred from {@link statusResultSchema}.
 *
 * Represents the result of a status check.
 *
 * @property app_name - The application name
 * @property app_version - The application version
 * @property timestamp - The current Unix timestamp in milliseconds
 */
export type StatusResult = z.infer<typeof statusResultSchema>;
