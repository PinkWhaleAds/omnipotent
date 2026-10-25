import type { Logform } from 'winston';

/*
 * What a log line may carry. Winston's JSON format writes an `Error` as `{}` (its message and stack are not
 * enumerable) and drops the arguments after the metadata, so a failure was logged without its cause; and an
 * axios error, written naively, carries its request configuration with the `Authorization` header. Every line
 * therefore goes through {@link sanitizeLogInfo} first: errors become plain objects (name, message, stack,
 * code, cause chain), the arguments winston leaves aside are folded into the line, and secrets are masked at
 * any depth.
 */

/** What replaces a value kept out of the logs. */
export const REDACTED = '[REDACTED]';

/** Symbol of the level winston reads (`triple-beam`'s, registered globally). */
const LEVEL: symbol = Symbol.for('level');

/** Symbol of the arguments given after the message (`triple-beam`'s). */
const SPLAT: symbol = Symbol.for('splat');

/**
 * Keys whose value never reaches the logs, lower-cased, without `-` nor `_` (`api_key`, `apiKey` and `API-Key` are
 * all `apikey`).
 */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'apikey',
  'password',
  'passphrase',
  'privatekey',
  'clientsecret',
  'secret',
  'token',
]);

/** Endings of the keys masked too: `refresh_token`, `accessToken`, `resendApiKey`, `secretAccessKey`, `smtpPassword`… */
const SENSITIVE_SUFFIXES: readonly string[] = ['token', 'secret', 'password', 'apikey', 'privatekey', 'accesskey'];

/**
 * Keys whose object is masked: an axios error's or response's `config` (headers, credentials, body) and `request`
 * (the socket and the headers sent).
 */
const OPAQUE_OBJECT_KEYS: ReadonlySet<string> = new Set(['config', 'request']);

/** Query parameters masked in any text (URLs in messages, stacks, values): tokens, keys, signatures. */
const SENSITIVE_QUERY =
  /([?&](?:access_token|refresh_token|id_token|token|api_key|apikey|client_secret|code|password|signature|sig|x-amz-signature|x-amz-credential|x-amz-security-token)=)[^&#\s"'<>]*/gi;

/** The user and password of a URL (`postgres://user:secret@host`); every part bounded, so it stays linear. */
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]{0,31}:\/\/)[^/\s:@]{1,256}:[^/\s@]{1,256}@/gi;

/** A bearer token written in a text. */
const BEARER_VALUE = /\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

/** Deepest nesting written; deeper values become {@link TRUNCATED}. */
const MAX_DEPTH = 8;

/** Most items of an array written; the rest is counted. */
const MAX_ITEMS = 50;

/** Most keys of an object written. */
const MAX_KEYS = 100;

/** Longest text written (a response body, a stack): the rest is cut. */
const MAX_STRING_LENGTH = 8192;

/** What replaces a value nested too deep. */
const TRUNCATED = '[Truncated]';

/** What replaces an object already being written above (a cycle). */
const CIRCULAR = '[Circular]';

/** A plain record. */
type PlainRecord = Record<string, unknown>;

/**
 * Whether a key holds a secret.
 *
 * @param key - The key
 * @returns `true` for a key of {@link SENSITIVE_KEYS} or ending like {@link SENSITIVE_SUFFIXES}
 *
 * @example
 * ```typescript
 * isSensitiveKey('refresh_token'); // true
 * isSensitiveKey('inputTokens'); // false
 * ```
 */
export function isSensitiveKey(key: string): boolean {
  const normalized: string = key.toLowerCase().replace(/[-_]/g, '');
  return (
    SENSITIVE_KEYS.has(normalized) || SENSITIVE_SUFFIXES.some((suffix: string): boolean => normalized.endsWith(suffix))
  );
}

/**
 * A text with its secrets masked (tokens and signatures in query strings, credentials of URLs, bearer tokens),
 * cut at {@link MAX_STRING_LENGTH} characters.
 *
 * @param text - The text
 * @returns The text, safe to log
 *
 * @example
 * ```typescript
 * redactText('GET /email/unsubscribe?token=abc'); // 'GET /email/unsubscribe?token=[REDACTED]'
 * ```
 */
export function redactText(text: string): string {
  const cut: string =
    text.length > MAX_STRING_LENGTH ? `${text.slice(0, MAX_STRING_LENGTH)}… [${text.length} characters]` : text;
  return cut
    .replace(SENSITIVE_QUERY, `$1${REDACTED}`)
    .replace(URL_CREDENTIALS, `$1${REDACTED}@`)
    .replace(BEARER_VALUE, `$1 ${REDACTED}`);
}

/**
 * A URL without its query string nor fragment, which may carry signatures.
 *
 * @param url - The URL, absolute or not
 * @returns Its part before `?` and `#`
 */
function withoutQuery(url: string): string {
  return url.split(/[?#]/)[0];
}

/**
 * Whether a value is an object (not `null`).
 *
 * @param value - The value
 * @returns `true` for an object or an array
 */
function isObject(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null;
}

/**
 * Write a failure as a plain object: name, message, stack, its own fields (`code`, `statusCode`, `params`…), the
 * method and path of an axios request (never its configuration nor headers), the status and body of its response,
 * the errors of an `AggregateError`, and its cause chain.
 *
 * @param error - The failure
 * @param depth - Its nesting in the line
 * @param ancestors - Objects being written above it (cycles)
 * @returns The object, masked
 */
function serializeError(error: Error, depth: number, ancestors: WeakSet<object>): PlainRecord {
  const output: PlainRecord = { name: error.name, message: redactText(String(error.message)) };
  if (error.stack) output.stack = redactText(error.stack);
  const fields = error as unknown as PlainRecord;
  for (const key of Object.keys(error)) {
    if (key in output || key === 'cause' || key === 'errors' || key === 'response' || OPAQUE_OBJECT_KEYS.has(key)) {
      continue;
    }
    output[key] = sanitizeEntry(key, fields[key], depth + 1, ancestors);
  }
  const config: unknown = fields.config;
  if (isObject(config)) {
    if (typeof config.method === 'string') output.method = config.method.toUpperCase();
    if (typeof config.url === 'string') output.url = redactText(withoutQuery(config.url));
  }
  const response: unknown = fields.response;
  if (isObject(response)) {
    output.response = sanitizeValue(
      { status: response.status, statusText: response.statusText, data: response.data },
      depth + 1,
      ancestors
    );
  }
  if (Array.isArray(fields.errors)) output.errors = sanitizeValue(fields.errors, depth + 1, ancestors);
  if (error.cause !== undefined) output.cause = sanitizeValue(error.cause, depth + 1, ancestors);
  return output;
}

/**
 * A value under a key, masked when the key holds a secret or an axios configuration.
 *
 * @param key - The key
 * @param value - The value
 * @param depth - Its nesting in the line
 * @param ancestors - Objects being written above it (cycles)
 * @returns The value, safe to log
 */
function sanitizeEntry(key: string, value: unknown, depth: number, ancestors: WeakSet<object>): unknown {
  if (value === undefined || value === null) return value;
  if (isSensitiveKey(key) || (OPAQUE_OBJECT_KEYS.has(key) && isObject(value))) return REDACTED;
  return sanitizeValue(value, depth, ancestors);
}

/**
 * A value written as plain data, safe to log: errors serialized, secrets masked at any depth, binaries and
 * functions summarized, long texts and lists cut, cycles and deep nesting stopped.
 *
 * @param value - The value
 * @param depth - Its nesting in the line
 * @param ancestors - Objects being written above it (cycles)
 * @returns The value, safe to log
 *
 * @example
 * ```typescript
 * sanitizeValue({ headers: { Authorization: 'Bearer x' } }, 0, new WeakSet()); // { headers: { Authorization: '[REDACTED]' } }
 * ```
 */
export function sanitizeValue(value: unknown, depth: number, ancestors: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (!isObject(value)) return value;
  if (depth > MAX_DEPTH) return TRUNCATED;
  if (ancestors.has(value)) return CIRCULAR;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return `[Binary ${value.byteLength} bytes]`;

  ancestors.add(value);
  try {
    if (value instanceof Error) return serializeError(value, depth, ancestors);
    if (Array.isArray(value)) {
      const items: unknown[] = value
        .slice(0, MAX_ITEMS)
        .map((item: unknown): unknown => sanitizeValue(item, depth + 1, ancestors));
      if (value.length > MAX_ITEMS) items.push(`[${value.length - MAX_ITEMS} more]`);
      return items;
    }
    const toJson: unknown = value.toJSON;
    if (typeof toJson === 'function') return sanitizeValue(toJson.call(value), depth + 1, ancestors);
    const output: PlainRecord = {};
    for (const key of Object.keys(value).slice(0, MAX_KEYS)) {
      const entry: unknown = sanitizeEntry(key, value[key], depth + 1, ancestors);
      if (entry !== undefined) output[key] = entry;
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Whether winston merged an argument into the entry: an object whose fields are all on the entry, as winston
 * copies them when the message has no `%s`-like token (an error's `message` is appended to the entry's instead).
 *
 * @param entry - The entry
 * @param argument - The first argument after the message
 * @returns `true` when its fields are already there
 */
function wasMerged(entry: PlainRecord, argument: PlainRecord): boolean {
  const merged: boolean = Object.keys(argument).every(
    (key: string): boolean => key === 'message' || entry[key] === argument[key]
  );
  return merged && (!(argument instanceof Error) || argument.stack === undefined || entry.stack === argument.stack);
}

/**
 * Remove from an entry what winston copied of an error given as metadata (`logger.warn('msg', error)`): its own
 * fields, its stack and its cause, which the entry carries as `error` instead.
 *
 * @param entry - The entry
 * @param error - The error
 * @returns Nothing; changes `entry`
 */
function unmerge(entry: PlainRecord, error: Error): void {
  for (const key of [...Object.keys(error), 'stack', 'cause']) {
    if (key !== 'message' && entry[key] === (error as unknown as PlainRecord)[key]) Reflect.deleteProperty(entry, key);
  }
}

/**
 * Add an error to an entry: as `error`, or in `errors` when it already has one.
 *
 * @param entry - The entry
 * @param error - The error
 * @returns Nothing; changes `entry`
 */
function addError(entry: PlainRecord, error: Error): void {
  if (entry.error === undefined) entry.error = error;
  else entry.errors = [...(Array.isArray(entry.errors) ? entry.errors : []), error];
}

/**
 * Turn a winston entry into one safe and complete to write:
 *
 * - an entry that is an `Error` itself (`logger.error(error)`) keeps its message and stack;
 * - the arguments winston leaves aside after the metadata (`logger.error('TAG', 'message', error)`) are folded
 *   in: texts appended to the message, errors as `error` (then `errors`), objects merged;
 * - an error given as metadata (`logger.warn('message', error)`) becomes `error`;
 * - every value is written as plain data with its secrets masked ({@link sanitizeValue}).
 *
 * @param info - The entry winston built
 * @returns The entry to write (its level symbol kept)
 *
 * @example
 * ```typescript
 * sanitizeLogInfo({ level: 'error', message: 'Sync failed', error: new Error('boom') });
 * // { level: 'error', message: 'Sync failed', error: { name: 'Error', message: 'boom', stack: '…' } }
 * ```
 */
export function sanitizeLogInfo(info: Logform.TransformableInfo): Logform.TransformableInfo {
  const source = info as unknown as Record<string | symbol, unknown>;
  const entry: PlainRecord = { ...source };
  if (info instanceof Error) {
    entry.message = info.message;
    if (info.stack) entry.stack = info.stack;
  }
  const extras: unknown[] = Array.isArray(source[SPLAT]) ? [...(source[SPLAT] as unknown[])] : [];
  if (isObject(extras[0]) && wasMerged(entry, extras[0])) {
    const first = extras.shift() as PlainRecord;
    if (first instanceof Error) {
      unmerge(entry, first);
      addError(entry, first);
    }
  }
  for (const extra of extras) {
    if (extra instanceof Error) addError(entry, extra);
    else if (isObject(extra)) {
      for (const [key, value] of Object.entries(extra)) if (!(key in entry)) entry[key] = value;
    } else if (extra !== undefined && extra !== null) entry.message = `${String(entry.message)} ${String(extra)}`;
  }

  const ancestors = new WeakSet<object>();
  const output: PlainRecord = {};
  for (const [key, value] of Object.entries(entry)) {
    const safe: unknown = key === 'level' ? value : sanitizeEntry(key, value, 1, ancestors);
    if (safe !== undefined) output[key] = safe;
  }
  return Object.assign(output, { [LEVEL]: source[LEVEL] }) as unknown as Logform.TransformableInfo;
}

/**
 * The winston format applying {@link sanitizeLogInfo} to every entry, before the transports format it.
 *
 * @example
 * ```typescript
 * winston.createLogger({ format: sanitizeLogFormat, transports });
 * ```
 */
export const sanitizeLogFormat: Logform.Format = { transform: sanitizeLogInfo };
