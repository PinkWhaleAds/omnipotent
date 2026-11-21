import AjvCompiler from '@fastify/ajv-compiler';
import { FastifyInstance, FastifySchemaCompiler } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { RouteSchemaDefinition, RouteValidator, zodBodyValidator } from '@utils';

/**
 * Options of the AJV validating querystrings, params and headers: Fastify's own (types coerced from strings,
 * defaults filled), with one change.
 *
 * - `removeAdditional: false` — a querystring parameter the route does not declare is **refused**
 *   (`validation_failed`, rule `additionalProperties`), where Fastify's default silently deletes it.
 *   `?sort=name` instead of `?sortBy=name` must not answer a list sorted by default: a parameter
 *   quietly ignored is a bug nobody sees. Only a schema that says `additionalProperties: false` is
 *   concerned — every input schema of the API does, being built from a strict Zod object
 *   (`backend/CLAUDE.md`); the headers schemas do not, since a request carries many headers of its own.
 *
 * Lengths are counted in Unicode code points, AJV's default, as Zod counts them since 4.6 (an emoji counts
 * 1): a body and a querystring measure the same text alike. Zod 4.4 counted UTF-16 code units, and AJV was
 * set to match it; Zod moved for GHSA-mrhx-c7xc-m3w5, and AJV followed (Lorin, 2026-11-21).
 */
const AJV_OPTIONS = {
  customOptions: { removeAdditional: false },
  plugins: [],
};

/**
 * Validates every request with the schemas of its route.
 *
 * - The body is parsed by the Zod schema its JSON Schema was written from (`toJsonSchema(zodSchema, 'input')`),
 *   exactly as an MCP tool's arguments: `trim` and defaults apply, nothing is coerced, refinements are checked.
 *   A body declared any other way makes the route fail to build. See `zodBodyValidator`.
 * - Querystrings, params and headers stay with AJV on the JSON Schema: they arrive as strings, and AJV turns
 *   them into the numbers, booleans and lists their schemas describe. A parameter the route does not
 *   declare is refused, not dropped (see {@link AJV_OPTIONS}).
 *
 * Either way a refused request answers `validation_failed` (`src/plugins/error-handler.plugin.ts`).
 * Registered with `fastify-plugin` before any route, so it applies to every route.
 *
 * @param fastify - The Fastify instance
 * @returns A promise that resolves once the validator compiler is set
 *
 * @example
 * ```typescript
 * await fastify.register(ValidationPlugin);
 * await fastify.register(Controllers);
 * ```
 */
async function ValidationPlugin(fastify: FastifyInstance): Promise<void> {
  // Typed as compiling a schema, it compiles the route definition Fastify hands to a validator compiler.
  const ajvCompile = AjvCompiler()({}, AJV_OPTIONS) as unknown as FastifySchemaCompiler<unknown>;

  fastify.setValidatorCompiler((route: RouteSchemaDefinition): RouteValidator => {
    if (route.httpPart === 'body') return zodBodyValidator(route);
    if (route.httpPart === 'headers') return ajvCompile({ ...route, schema: lowerCaseHeaders(route.schema) });
    return ajvCompile(route);
  });
}

/**
 * Header names in lower case, as Node reads them: what Fastify does to a headers schema unless a validator
 * compiler of its own is set.
 *
 * @param schema - The JSON Schema of the headers
 * @returns The same schema, its property names and required names in lower case
 */
function lowerCaseHeaders(schema: unknown): unknown {
  const { properties, required, ...rest } = schema as { properties?: object; required?: string[] };
  return {
    ...rest,
    ...(properties && {
      properties: Object.fromEntries(
        Object.entries(properties).map(([name, value]: [string, unknown]): [string, unknown] => [
          name.toLowerCase(),
          value,
        ])
      ),
    }),
    ...(required && { required: required.map((name: string): string => name.toLowerCase()) }),
  };
}

export default fastifyPlugin(ValidationPlugin, { name: 'ValidationPlugin' });
