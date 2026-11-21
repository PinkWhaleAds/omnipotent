/**
 * @module services/lock.helpers
 *
 * The lock two workers never do the same work under: a PostgreSQL advisory lock, **tried** rather than
 * awaited (D46). Shared by the synchronization of a campaign and the conversion setup of an Advertiser.
 */
import { DataSource, QueryRunner } from 'typeorm';

/**
 * Run a task under a PostgreSQL advisory lock, or skip it when another process holds it (D46).
 *
 * Skipping rather than waiting is deliberate: the other worker is doing the same work from the same
 * database, and anything it leaves behind is still found by the sweep. Waiting would only tie up a
 * worker to do nothing twice.
 *
 * @param dataSource - Application database
 * @param key - Name of the lock
 * @param task - What to run while holding it
 * @returns A promise that resolves once the task ran, or was skipped
 *
 * @example
 * ```typescript
 * await withTryLock(dataSource, `campaign:${campaignId}`, () => this.syncUnits(campaignId));
 * ```
 */
export async function withTryLock(dataSource: DataSource, key: string, task: () => Promise<void>): Promise<void> {
  const runner: QueryRunner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    const [{ locked }]: { locked: boolean }[] = await runner.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
      [key]
    );
    if (!locked) return;
    try {
      await task();
    } finally {
      await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
    }
  } finally {
    await runner.release();
  }
}
