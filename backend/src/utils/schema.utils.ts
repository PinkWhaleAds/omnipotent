import { z } from 'zod';

import { errorResponseSchema } from '@src/types/error.types';

/**
 * Which side of a schema to describe.
 *
 * - `output` — the shape a value has *after* parsing: fields with a default are
 *   present, hence required. Use it for responses.
 * - `input` — the shape a caller may send: fields with a default may be omitted.
 *   Use it for params, querystrings and bodies, otherwise a field with a default
 *   would be rejected when absent.
 */
export type SchemaSide = 'input' | 'output';

/**
 * The Zod schema each input-side JSON Schema was written from, so a request body is validated by its Zod
 * schema itself (`src/plugins/validation.plugin.ts`) while its JSON Schema documents it.
 */
const ZOD_SCHEMAS: WeakMap<object, z.ZodType> = new WeakMap<object, z.ZodType>();

/**
 * Converts a Zod schema to its JSON Schema representation for use with
 * Fastify's route validation and Swagger generation.
 *
 * Centralizes the call to `z.toJSONSchema(...)` so every controller schema
 * goes through a single helper. It targets JSON Schema draft-07, the dialect
 * Fastify's validator (AJV) understands: Zod's default (2020-12) makes Fastify
 * refuse to build the route. An input-side JSON Schema remembers its Zod schema
 * ({@link zodSchemaOf}): a route body declared with it is validated by Zod.
 *
 * @param schema - The Zod schema to convert
 * @param side - Which side of the schema to describe, see {@link SchemaSide}
 * @returns The JSON Schema representation of the input schema
 *
 * @example
 * ```typescript
 * import { toJsonSchema } from '@utils';
 * import { statusResultSchema } from '@src/types';
 *
 * const responseSchema = toJsonSchema(statusResultSchema);
 * const querystringSchema = toJsonSchema(paginationQuerySchema, 'input');
 * ```
 */
export function toJsonSchema(schema: z.ZodType, side: SchemaSide = 'output'): object {
  const jsonSchema: object = z.toJSONSchema(schema, { target: 'draft-7', io: side, override: keepUrlProtocol });
  if (side === 'input') ZOD_SCHEMAS.set(jsonSchema, schema);
  return jsonSchema;
}

/**
 * The Zod schema a JSON Schema was written from by `toJsonSchema(schema, 'input')`.
 *
 * @param jsonSchema - A JSON Schema of a route
 * @returns Its Zod schema, or `undefined` for a JSON Schema written by hand or for the output side
 *
 * @example
 * ```typescript
 * const body: object = toJsonSchema(createSeatBodySchema, 'input');
 * zodSchemaOf(body); // createSeatBodySchema
 * ```
 */
export function zodSchemaOf(jsonSchema: unknown): z.ZodType | undefined {
  return typeof jsonSchema === 'object' && jsonSchema !== null ? ZOD_SCHEMAS.get(jsonSchema) : undefined;
}

/**
 * Keep the protocol a Zod URL allows (`z.url({ protocol: /^https?$/ })`) in its JSON Schema: Zod writes
 * `format: uri` only, which takes any scheme (`javascript:`, `ftp:`), so the documentation (and a querystring,
 * still validated by AJV) would accept what Zod refuses. The protocol becomes a case-insensitive `pattern` on
 * the scheme.
 *
 * @param context - The Zod schema and the JSON Schema written for it, changed in place
 */
function keepUrlProtocol(context: { zodSchema: unknown; jsonSchema: Record<string, unknown> }): void {
  const def = (context.zodSchema as { _zod?: { def?: { format?: string; protocol?: RegExp } } })._zod?.def;
  if (def?.format !== 'url' || def.protocol === undefined) return;
  const protocol: string = def.protocol.source
    .replace(/^\^/, '')
    .replace(/\$$/, '')
    .replace(/[a-z]/gi, (letter: string): string => `[${letter.toLowerCase()}${letter.toUpperCase()}]`);
  context.jsonSchema.pattern = `^(?:${protocol}):`;
}

/**
 * Document error responses of a route, all in the single `errorResponseSchema` shape.
 *
 * @param statusCodes - HTTP statuses the route may answer with
 * @returns The `response` entries to spread into a route schema
 *
 * @example
 * ```typescript
 * response: { 200: toJsonSchema(advertiserSchema), ...errorResponses(401, 403, 404) }
 * ```
 */
export function errorResponses(...statusCodes: number[]): Record<number, object> {
  const schema: object = toJsonSchema(errorResponseSchema);
  return Object.fromEntries(statusCodes.map((statusCode: number): [number, object] => [statusCode, schema]));
}

/** Response schema of a `204 No Content`. */
export const NO_CONTENT_RESPONSE: object = { type: 'null', description: 'No content' };
