/**
 * Jest-only CommonJS stub for the `pg-boss` package.
 *
 * `pg-boss` ships as pure ESM, which jest (running ts-jest in CommonJS mode)
 * cannot `require`. It is mapped in for `^pg-boss$` by `moduleNameMapper`, so
 * every module importing pg-boss loads without touching a real database. Specs
 * exercising the queue replace it with `jest.mock('pg-boss', ...)` or inject a
 * fake through the `PgBossFactory` of `JobQueueService`.
 */
export class PgBoss {
  public on(): this {
    return this;
  }
  public async start(): Promise<this> {
    return this;
  }
  public async stop(): Promise<void> {}
  public async createQueue(): Promise<void> {}
  public async send(): Promise<string | null> {
    return null;
  }
  public async work(): Promise<string> {
    return 'worker';
  }
  public async schedule(): Promise<void> {}
}
