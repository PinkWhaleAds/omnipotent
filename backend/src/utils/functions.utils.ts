import { Callback, Nullable, Opt } from '@src/types';

/**
 * Invokes a callback function if it is defined.
 *
 * This is a convenience wrapper that safely calls an optional callback,
 * passing along an optional error and data payload.
 *
 * @param callback - The optional callback function to invoke
 * @param error - An optional error to pass to the callback
 * @param data - An optional data payload to pass to the callback
 * @returns Nothing; the callback is invoked for its side effects only
 *
 * @example
 * ```typescript
 * import { callCallback } from '@utils/functions.utils';
 * import { Callback } from '@src/types';
 *
 * const onComplete: Callback<string> = (err, data) => {
 *   if (err) console.error(err);
 *   else console.log(data);
 * };
 *
 * callCallback(onComplete, null, 'done');
 * // Logs: "done"
 *
 * callCallback(undefined, null, 'ignored');
 * // Does nothing since callback is undefined
 * ```
 */
export function callCallback<T = void>(callback: Opt<Callback<T>>, error?: Nullable<Error>, data?: Nullable<T>): void {
  if (callback) return callback(error, data);
}
