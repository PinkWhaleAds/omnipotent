import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { HealthCheckKind, HealthReport, PublicHealthReport } from '@src/types';
import { Logger, LoggerBuilder } from '@utils';

/** HTTP status returned when every reported check passed. */
const HEALTHY_CODE = 200;

/** HTTP status returned when at least one reported check failed. */
const UNHEALTHY_CODE = 503;

/** @internal Logger of the failed checks, whose reasons the probes do not answer. */
const logger: Logger = LoggerBuilder.getChildLogger('Health');

/**
 * Handler for `GET /livez` — the Kubernetes liveness probe.
 *
 * Answers `200` while the process is functional. A `503` here means Kubernetes
 * restarts the container, so only liveness checks are considered.
 *
 * @param _request - The incoming Fastify request
 * @param reply - The Fastify reply used to send the response
 * @returns A promise that resolves once the response has been sent
 */
export async function getLivez(this: FastifyInstance, _request: FastifyRequest, reply: FastifyReply): Promise<void> {
  sendReport(reply, 'liveness', await this.healthService.report('liveness'));
}

/**
 * Handler for `GET /readyz` — the Kubernetes readiness probe.
 *
 * Answers `503` until the server is listening, while a readiness check fails,
 * and as soon as a graceful shutdown starts, so the pod is taken out of the
 * Service endpoints without being restarted.
 *
 * @param _request - The incoming Fastify request
 * @param reply - The Fastify reply used to send the response
 * @returns A promise that resolves once the response has been sent
 */
export async function getReadyz(this: FastifyInstance, _request: FastifyRequest, reply: FastifyReply): Promise<void> {
  sendReport(reply, 'readiness', await this.healthService.report('readiness'));
}

/**
 * Handler for `GET /healthz` — the aggregate probe.
 *
 * Runs every registered check, liveness and readiness alike. Kept for the
 * conventional `healthz` name and for humans / uptime monitors; prefer
 * `/livez` and `/readyz` in probe definitions since they carry the distinct
 * "restart me" and "stop routing to me" meanings.
 *
 * @param _request - The incoming Fastify request
 * @param reply - The Fastify reply used to send the response
 * @returns A promise that resolves once the response has been sent
 */
export async function getHealthz(this: FastifyInstance, _request: FastifyRequest, reply: FastifyReply): Promise<void> {
  sendReport(reply, 'all', await this.healthService.report());
}

/**
 * Send a probe report with the status code matching its outcome: the status of each check only, the probes being
 * public; the reason of each failed check is logged (a database error carries its address).
 *
 * @param reply - The Fastify reply used to send the response
 * @param probe - Which checks ran, for the logs
 * @param report - The report
 * @returns Nothing; the reply is sent as a side effect
 *
 * @example
 * ```typescript
 * sendReport(reply, 'readiness', { status: 'ok', checks: [] }); // 200
 * ```
 */
function sendReport(reply: FastifyReply, probe: HealthCheckKind | 'all', report: HealthReport): void {
  for (const check of report.checks) {
    if (check.status === 'error') {
      logger.warn(`Health check ${check.name} failed`, { probe, check: check.name, reason: check.message });
    }
  }
  const body: PublicHealthReport = {
    status: report.status,
    checks: report.checks.map(({ name, status }) => ({ name, status })),
  };
  reply.code(report.status === 'ok' ? HEALTHY_CODE : UNHEALTHY_CODE).send(body);
}
