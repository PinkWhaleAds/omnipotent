import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { HealthCheck, HealthCheckKind, HealthCheckResult, HealthReport, HealthStatus } from '@src/types';

/** A registered check together with the probe it answers. */
type RegisteredCheck = {
  kind: HealthCheckKind;
  check: HealthCheck;
};

/** Name of the built-in readiness check that gates traffic on the app lifecycle. */
const APP_CHECK_NAME = 'app';

/**
 * Service backing the Kubernetes probe endpoints (`/livez`, `/readyz`, `/healthz`).
 *
 * Holds the process-wide readiness flag and the registry of health checks.
 * A built-in `app` readiness check keeps the pod out of the Service endpoints
 * until {@link setReady} is called (after the server starts listening) and puts
 * it back out as soon as a shutdown begins.
 *
 * @example
 * ```typescript
 * // Register a dependency so /readyz reports it (in a plugin, or on boot):
 * fastify.healthService.register('postgres', 'readiness', async (): Promise<void> => {
 *   await pool.query('SELECT 1');
 * });
 * ```
 */
export class HealthService {
  /** @internal Checks by name — a re-registration under the same name replaces the previous check. */
  private readonly checks = new Map<string, RegisteredCheck>();

  /** @internal Whether the app currently accepts traffic. */
  private ready = false;

  /**
   * Creates the service and registers the built-in `app` readiness check.
   *
   * @example
   * ```typescript
   * const healthService: HealthService = new HealthService();
   * ```
   */
  constructor() {
    this.register(APP_CHECK_NAME, 'readiness', (): void => {
      if (!this.ready) throw new Error('Application is not accepting traffic');
    });
  }

  /**
   * Register a health check under a name.
   *
   * Registering an existing name replaces the previous check, which makes the
   * call idempotent when a plugin is reloaded.
   *
   * @param name - Identifier reported in the probe payload
   * @param kind - Which probe the check answers — see {@link HealthCheckKind}
   * @param check - The check itself: throw (or reject) to report unhealthy
   * @returns Nothing; the check is stored for subsequent probe calls
   *
   * @example
   * ```typescript
   * healthService.register('redis', 'readiness', async (): Promise<void> => {
   *   await redis.ping();
   * });
   * ```
   */
  public register(name: string, kind: HealthCheckKind, check: HealthCheck): void {
    this.checks.set(name, { kind, check });
  }

  /**
   * Set whether the app accepts traffic, which drives the built-in `app` check.
   *
   * Called with `true` once the server listens, and with `false` at the start of
   * a graceful shutdown so load balancers deregister the pod before it closes.
   *
   * @param ready - The new readiness state
   * @returns Nothing; mutates the readiness flag
   *
   * @example
   * ```typescript
   * healthService.setReady(true); // /readyz -> 200
   * ```
   */
  public setReady(ready: boolean): void {
    this.ready = ready;
  }

  /**
   * Whether the app currently declares itself ready to accept traffic.
   *
   * @returns `true` when {@link setReady} was last called with `true`
   *
   * @example
   * ```typescript
   * if (!healthService.isReady()) return;
   * ```
   */
  public isReady(): boolean {
    return this.ready;
  }

  /**
   * Run the registered checks and build a probe report.
   *
   * Checks run concurrently; a check that throws or rejects is reported as
   * `error` with its message, and never propagates — a probe endpoint must
   * answer even when a dependency is down.
   *
   * @param kind - Restrict to one probe's checks; omit to run every check (`/healthz`)
   * @returns A report whose `status` is `ok` only when every reported check passed
   *
   * @example
   * ```typescript
   * const report: HealthReport = await healthService.report('readiness');
   * ```
   */
  public async report(kind?: HealthCheckKind): Promise<HealthReport> {
    const selected: [string, RegisteredCheck][] = [...this.checks.entries()].filter(
      ([, registered]: [string, RegisteredCheck]): boolean => !kind || registered.kind === kind
    );

    const checks: HealthCheckResult[] = await Promise.all(
      selected.map(([name, registered]: [string, RegisteredCheck]): Promise<HealthCheckResult> =>
        HealthService.runCheck(name, registered.check)
      )
    );

    const status: HealthStatus = checks.every((check: HealthCheckResult): boolean => check.status === 'ok')
      ? 'ok'
      : 'error';

    return { status, checks };
  }

  /**
   * Run a single check and turn its outcome into a {@link HealthCheckResult}.
   *
   * @param name - The name the check was registered under
   * @param check - The check to run
   * @returns The check outcome; failures carry the error message
   *
   * @example
   * ```typescript
   * // Called internally by report():
   * // await HealthService.runCheck('postgres', check);
   * ```
   */
  private static async runCheck(name: string, check: HealthCheck): Promise<HealthCheckResult> {
    try {
      await check();
      return { name, status: 'ok' };
    } catch (error: unknown) {
      return { name, status: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  }
}

/**
 * Fastify plugin that decorates the instance with a {@link HealthService}.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function healthServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('healthService', new HealthService());
}

export default fastifyPlugin(healthServicePlugin, {
  name: 'HealthServicePlugin',
});
