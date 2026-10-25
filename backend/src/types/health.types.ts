import { z } from 'zod';

/**
 * Zod schema for the outcome of a single health check.
 *
 * `ok` means the check passed, `error` means it failed or threw.
 */
export const healthStatusSchema: z.ZodEnum<{ ok: 'ok'; error: 'error' }> = z.enum(['ok', 'error']);

/**
 * TypeScript type inferred from {@link healthStatusSchema}.
 */
export type HealthStatus = z.infer<typeof healthStatusSchema>;

/**
 * Zod schema describing one named health check and its outcome, as the probes answer it: never the reason of a
 * failure, which may carry addresses or connection details and only goes to the logs.
 *
 * @example
 * ```typescript
 * const result = { name: 'postgres', status: 'error' };
 * ```
 */
export const healthCheckResultSchema: z.ZodObject<{
  name: z.ZodString;
  status: typeof healthStatusSchema;
}> = z.object({
  name: z.string(),
  status: healthStatusSchema,
});

/**
 * The outcome of a health check, as `HealthService` reports it.
 *
 * @property name - The name the check was registered under
 * @property status - Whether the check passed
 * @property message - The failure reason, present only when `status` is `error`; logged, never answered
 *
 * @example
 * ```typescript
 * const result: HealthCheckResult = { name: 'postgres', status: 'error', message: 'ECONNREFUSED' };
 * ```
 */
export type HealthCheckResult = z.infer<typeof healthCheckResultSchema> & { message?: string };

/**
 * Zod schema for a probe response body.
 *
 * Single source of truth for the `/livez`, `/readyz` and `/healthz` payloads —
 * used to infer {@link PublicHealthReport} and to generate the route JSON Schema via
 * `toJsonSchema` from `@utils`. Statuses only: the reasons of the failures stay in the logs.
 *
 * @example
 * ```typescript
 * const report: HealthReport = { status: 'error', checks: [{ name: 'app', status: 'error' }] };
 * ```
 */
export const healthReportSchema: z.ZodObject<{
  status: typeof healthStatusSchema;
  checks: z.ZodArray<typeof healthCheckResultSchema>;
}> = z.object({
  status: healthStatusSchema,
  checks: z.array(healthCheckResultSchema),
});

/**
 * TypeScript type inferred from {@link healthReportSchema}: what a probe answers.
 *
 * @property status - `ok` only when every reported check passed
 * @property checks - The individual check outcomes, without their reasons
 */
export type PublicHealthReport = z.infer<typeof healthReportSchema>;

/**
 * A report of `HealthService`: {@link PublicHealthReport} with the reason of each failed check.
 *
 * @property status - `ok` only when every reported check passed
 * @property checks - The individual check outcomes
 */
export type HealthReport = { status: HealthStatus; checks: HealthCheckResult[] };

/**
 * Which probe a check answers.
 *
 * - `liveness` — is the process still functional? A failure means Kubernetes
 *   restarts the container, so only register checks that a restart can fix
 *   (deadlocks, corrupted in-process state). Never register a dependency here.
 * - `readiness` — can the process serve traffic right now? A failure only
 *   removes the pod from the Service endpoints; it recovers without a restart.
 *   This is where dependencies (database, cache, broker) belong.
 */
export type HealthCheckKind = 'liveness' | 'readiness';

/**
 * A health check: resolve (or return) to report healthy, throw to report
 * unhealthy. The thrown error's message becomes the check's `message`.
 *
 * @example
 * ```typescript
 * const postgresCheck: HealthCheck = async (): Promise<void> => {
 *   await pool.query('SELECT 1');
 * };
 * ```
 */
export type HealthCheck = () => void | Promise<void>;
