/** An entry of a {@link TtlCache}: the value and the instant it stops being valid. */
type TtlCacheEntry<V> = {
  value: V;
  expiresAt: number;
};

/** Default maximum number of entries, so a cache can never grow without bound. */
const DEFAULT_MAX_ENTRIES = 10000;

/**
 * In-process cache whose entries expire after a fixed time.
 *
 * Used to avoid a database or network round trip on every request (resolved
 * callers, permissions, public keys). It is local to one process: a change made
 * on another replica becomes visible here at the latest after `ttlMs`.
 *
 * When full, the oldest inserted entry is dropped first.
 *
 * @typeParam V - Type of the cached values
 *
 * @example
 * ```typescript
 * const cache: TtlCache<string> = new TtlCache<string>(60000);
 * cache.set('user-1', 'admin');
 * cache.get('user-1'); // 'admin', for one minute
 * ```
 */
export class TtlCache<V> {
  /** @internal Entries by key, in insertion order (a `Map` preserves it). */
  private readonly entries = new Map<string, TtlCacheEntry<V>>();

  /**
   * Create a cache.
   *
   * @param ttlMs - How long, in milliseconds, an entry stays valid
   * @param maxEntries - Maximum number of entries kept
   * @param now - Clock, injectable for tests
   */
  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Read a value that has not expired yet.
   *
   * @param key - Key of the entry
   * @returns The value, or `undefined` when absent or expired (an expired entry is removed)
   */
  public get(key: string): V | undefined {
    const entry: TtlCacheEntry<V> | undefined = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Store a value for `ttlMs`, replacing any previous value for the key.
   *
   * @param key - Key of the entry
   * @param value - Value to store
   * @returns Nothing
   */
  public set(key: string, value: V): void {
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      const oldestKey: string = this.entries.keys().next().value as string;
      this.entries.delete(oldestKey);
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  /**
   * Remove every entry whose key starts with a prefix.
   *
   * @param prefix - Prefix of the keys to forget (e.g. a user id)
   * @returns Nothing
   *
   * @example
   * ```typescript
   * cache.deleteByPrefix(`${userId}:`); // forget every permission of a user
   * ```
   */
  public deleteByPrefix(prefix: string): void {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  /**
   * Forget one entry.
   *
   * @param key - Key of the entry
   * @returns Nothing
   */
  public delete(key: string): void {
    this.entries.delete(key);
  }

  /**
   * Remove every entry.
   *
   * @returns Nothing
   */
  public clear(): void {
    this.entries.clear();
  }
}
