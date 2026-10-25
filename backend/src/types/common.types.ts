/**
 * Represents a value that may be undefined.
 *
 * @typeParam T - The base type that may be undefined
 *
 * @example
 * ```typescript
 * const value: Opt<string> = getUserName(); // string | undefined
 * ```
 */
export type Opt<T> = T | undefined;

/**
 * Represents a value that may be null.
 *
 * @typeParam T - The base type that may be null
 *
 * @example
 * ```typescript
 * const result: Nullable<number> = findIndex(); // number | null
 * ```
 */
export type Nullable<T> = T | null;

/**
 * A dictionary type where keys are strings and values are optionally defined.
 *
 * @typeParam T - The type of the values stored in the map, defaults to unknown
 *
 * @example
 * ```typescript
 * const headers: SafeMap<string> = { 'content-type': 'application/json' };
 * const missing: Opt<string> = headers['x-custom']; // string | undefined
 * ```
 */
export type SafeMap<T = unknown> = Record<string, Opt<T>>;

/**
 * A Node.js-style callback function type with optional error and data parameters.
 *
 * @typeParam T - The type of the data passed to the callback, defaults to void
 *
 * @example
 * ```typescript
 * function readFile(path: string, cb: Callback<Buffer>): void {
 *   fs.readFile(path, (err, data) => cb(err, data));
 * }
 * ```
 */
export type Callback<T = void> = (error?: Nullable<Error>, data?: Nullable<T>) => void;

/**
 * A string type alias representing an error code identifier.
 */
export type ErrorCode = string; // NOSONAR - it wants us use string directly

/**
 * Represents a value that may be null or undefined.
 *
 * @typeParam T - The base type that may be null or undefined
 *
 * @example
 * ```typescript
 * const input: Nullified<string> = getOptionalParam(); // string | null | undefined
 * ```
 */
export type Nullified<T> = T | null | undefined;
