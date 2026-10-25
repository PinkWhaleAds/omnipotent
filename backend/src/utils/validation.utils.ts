import type { FastifySchemaCompiler, FastifySchemaValidationError } from 'fastify';
import { z } from 'zod';

import { zodSchemaOf } from './schema.utils';

/** What Fastify hands a validator compiler: the JSON Schema of a part of a route, its method, URL and part. */
export type RouteSchemaDefinition = Parameters<FastifySchemaCompiler<unknown>>[0];

/** What a validator compiler returns: the function Fastify calls with the value of the part. */
export type RouteValidator = ReturnType<FastifySchemaCompiler<unknown>>;

/** The first rule a value breaks: where, which rule (a JSON Schema keyword) and why, in English. */
type Failure = { path: PropertyKey[]; rule: string; message: string };

/**
 * Build the validator of a route body from the Zod schema of its JSON Schema.
 *
 * The body is parsed by Zod, as an MCP tool's arguments are: `trim`, lowercase/uppercase and defaults apply,
 * no type is coerced (`"25"` is not a number, `0` is not `null`), lengths count UTF-16 code units (an emoji
 * counts 2), refinements and URL protocols are checked, and unknown fields are dropped. The parsed value
 * replaces `request.body`. A refused body gives its first issue in the shape of an AJV error, so the error
 * handler answers `validation_failed` with the same `field`, `rule` and `location` as for the other parts.
 *
 * @param route - The route definition Fastify compiles: its body JSON Schema, method and URL
 * @returns The validator Fastify calls with the body
 * @throws Error when the JSON Schema was not written by `toJsonSchema(zodSchema, 'input')`: the route fails
 *   to build, so a body never goes unchecked
 *
 * @example
 * ```typescript
 * const validate = zodBodyValidator({ schema: toJsonSchema(createSeatBodySchema, 'input'), method: 'POST', url: '/seats' });
 * validate({ name: '  Acme  ' }); // { value: { name: 'Acme' } }
 * ```
 */
export function zodBodyValidator(route: RouteSchemaDefinition): RouteValidator {
  const schema: z.ZodType | undefined = zodSchemaOf(route.schema);
  if (!schema) {
    throw new Error(
      `The body of ${route.method} ${route.url} has no Zod schema: declare it with toJsonSchema(zodSchema, 'input')`
    );
  }
  return (data: unknown): { value?: unknown; error?: FastifySchemaValidationError[] } => {
    const result = schema.safeParse(data, { reportInput: true });
    return result.success ? { value: result.data } : { error: [toValidationError(result.error.issues[0])] };
  };
}

/**
 * Turn a Zod issue into the AJV error Fastify and the error handler read.
 *
 * @param issue - The first issue of a refused value
 * @returns Its JSON pointer (`/platforms/0/share`), its rule as the JSON Schema keyword and its message;
 *   the input is never copied, so a refused secret does not reach the logs
 *
 * @example
 * ```typescript
 * toValidationError({ code: 'too_small', origin: 'string', minimum: 1, inclusive: true, path: ['name'], message: 'Too small' });
 * // { keyword: 'minLength', instancePath: '/name', schemaPath: '#', params: {}, message: 'Too small' }
 * ```
 */
export function toValidationError(issue: z.core.$ZodIssue): FastifySchemaValidationError {
  const failure: Failure = failureOf(issue, []);
  return {
    keyword: failure.rule,
    instancePath: failure.path.map((part: PropertyKey): string => `/${String(part)}`).join(''),
    schemaPath: '#',
    params: {},
    message: failure.message,
  };
}

/**
 * The rule a Zod issue breaks, named as the JSON Schema keyword the API documents (`docs/error-codes.md`).
 *
 * @param issue - The issue
 * @param prefix - The path of the union the issue comes from, if any
 * @returns Its failure
 */
function failureOf(issue: z.core.$ZodIssue, prefix: PropertyKey[]): Failure {
  const path: PropertyKey[] = [...prefix, ...issue.path];
  const failure = (rule: string): Failure => ({ path, rule, message: issue.message });
  switch (issue.code) {
    // A JSON body has no `undefined`: a value Zod got as `undefined` is a missing field, whatever it checks first
    // (a type, a list of values, the options of a union).
    case 'invalid_type':
      return failure(issue.input === undefined ? 'required' : 'type');
    case 'too_small':
      return failure(boundRule(issue.origin, 'min', issue.inclusive));
    case 'too_big':
      return failure(boundRule(issue.origin, 'max', issue.inclusive));
    case 'invalid_format':
      // A URL is parsed: its `format`. Every other format (uuid, day, email, `.regex`, `.startsWith`…) is matched
      // by a regular expression its JSON Schema carries as a `pattern`, the keyword AJV reported.
      return failure(issue.format === 'url' ? 'format' : 'pattern');
    case 'not_multiple_of':
      return failure('multipleOf');
    case 'invalid_value':
      return failure(issue.input === undefined ? 'required' : 'enum');
    case 'unrecognized_keys':
      return failure('additionalProperties');
    case 'invalid_union':
      return unionFailure(issue, path);
    case 'invalid_key':
      return failure('propertyNames');
    case 'invalid_element':
      return failure('items');
    case 'custom':
      // A refinement (`.refine`, `.superRefine`): its message says what is wrong.
      return failure('custom');
  }
}

/**
 * The keyword of a bound: a length for a text, a count for a list, a value for a number or a date.
 *
 * @param origin - What Zod measured (`string`, `array`, `number`…)
 * @param bound - Which bound was crossed
 * @param inclusive - Whether the bound itself was allowed (`false` for `.positive()`)
 * @returns `minLength`, `maxItems`, `minimum`, `exclusiveMinimum`…
 */
function boundRule(origin: string, bound: 'min' | 'max', inclusive: boolean | undefined): string {
  if (origin === 'string') return bound === 'min' ? 'minLength' : 'maxLength';
  if (origin === 'array' || origin === 'set') return bound === 'min' ? 'minItems' : 'maxItems';
  const keyword: string = bound === 'min' ? 'Minimum' : 'Maximum';
  return inclusive === false ? `exclusive${keyword}` : keyword.toLowerCase();
}

/**
 * The failure of a value no option of a union accepts.
 *
 * A missing value is `required`. A discriminated union names its discriminator: missing, or none of its values.
 * Otherwise the option the value came closest to tells what to fix: among those that accepted its type, the one
 * with the fewest issues.
 *
 * @param issue - The union issue
 * @param path - Where the union is
 * @returns Its failure
 */
function unionFailure(issue: z.core.$ZodIssueInvalidUnion, path: PropertyKey[]): Failure {
  if (issue.input === undefined) return { path, rule: 'required', message: issue.message };
  if (issue.discriminator !== undefined) {
    const sent: unknown = (issue.input as Record<string, unknown> | undefined)?.[issue.discriminator];
    return { path, rule: sent === undefined ? 'required' : 'enum', message: issue.message };
  }
  if (issue.inclusive === false) return { path, rule: 'oneOf', message: issue.message };
  const closest: z.core.$ZodIssue[] | undefined = issue.errors
    .filter(
      (issues: z.core.$ZodIssue[]): boolean => !(issues[0].code === 'invalid_type' && issues[0].path.length === 0)
    )
    .sort((a: z.core.$ZodIssue[], b: z.core.$ZodIssue[]): number => a.length - b.length)[0];
  return closest ? failureOf(closest[0], path) : { path, rule: 'type', message: issue.message };
}
