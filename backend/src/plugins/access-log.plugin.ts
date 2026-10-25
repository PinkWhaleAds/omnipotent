import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type winston from 'winston';

import { loggerConfig } from '@configs/logger.config';
import { ORGANIZATION_HEADER } from '@src/types/api.types';
import { clientIpOf, LoggerBuilder, pathOf } from '@utils';

/** Routes never logged: the probes of the load balancer and of the orchestrator, every few seconds. */
const PROBE_ROUTES: ReadonlySet<string> = new Set(['/livez', '/readyz', '/healthz']);

/** Longest path of an unmatched request written (scanners send anything). */
const MAX_PATH_LENGTH = 200;

/** Shape of a canonical UUID: only such an Organization header is written. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One line of the access log.
 *
 * @property method - HTTP method
 * @property route - Pattern of the matched route (`/campaigns/:id`), `null` for a request no route matched
 * @property path - Path of a request no route matched, without its query string (cut at 200 characters)
 * @property status - Status answered
 * @property durationMs - Time from the request to the end of the response, in milliseconds
 * @property clientIp - Address of the client ({@link clientIpOf})
 * @property userId - The authenticated user, `null` when the route is public or authentication failed
 * @property organizationId - The `X-Organization-Id` header, when it is a well-formed id
 * @property requestId - Id of the request, as error responses give it
 */
export type AccessLogLine = {
  method: string;
  route: string | null;
  path?: string;
  status: number;
  durationMs: number;
  clientIp: string;
  userId: string | null;
  organizationId: string | null;
  requestId: string;
};

/**
 * The access log line of a finished request: never a header, a query string (tokens of `/email/unsubscribe`…) nor
 * a body; the route pattern rather than the URL, which carries secret keys (`/feeds/:key/…`, `/t/:key.js`).
 *
 * @param request - The request
 * @param reply - Its reply, sent
 * @returns The line
 */
export function accessLogLine(request: FastifyRequest, reply: FastifyReply): AccessLogLine {
  const route: string | null = request.routeOptions.url ?? null;
  const organization: unknown = request.headers[ORGANIZATION_HEADER];
  return {
    method: request.method,
    route,
    ...(route === null ? { path: pathOf(request.url).slice(0, MAX_PATH_LENGTH) } : {}),
    status: reply.statusCode,
    durationMs: Math.round(reply.elapsedTime * 10) / 10,
    clientIp: clientIpOf(request),
    userId: request.auth?.userId ?? null,
    organizationId: typeof organization === 'string' && UUID_PATTERN.test(organization) ? organization : null,
    requestId: request.id,
  };
}

/**
 * Writes one structured line per HTTP request once its response is sent (`Logger.accessLog`, on by default), at
 * `info` on the access logger whatever `Logger.level`: method, route pattern, status, duration, client address,
 * user, Organization header and request id. The probes are left out.
 *
 * Behind CloudFront then the internal load balancer, the client address is CloudFront's `CloudFront-Viewer-Address`
 * header when `HttpServer.trustCloudFrontViewerAddress` is on, else Fastify's `request.ip` with
 * `HttpServer.trustProxyHops` trusted proxies (see {@link clientIpOf}).
 *
 * @param fastify - The Fastify instance to log the requests of
 * @param options - The logger written to (the access logger by default)
 * @param options.logger - That logger
 * @returns A promise that resolves once the hook is registered
 *
 * @example
 * ```typescript
 * await fastify.register(AccessLogPlugin);
 * // {"message":"GET /campaigns/:id 200","route":"/campaigns/:id","status":200,"durationMs":12.4,…}
 * ```
 */
async function AccessLogPlugin(fastify: FastifyInstance, options: { logger?: winston.Logger }): Promise<void> {
  if (!loggerConfig.accessLog) return;
  const logger: winston.Logger = options.logger ?? LoggerBuilder.getAccessLogger();

  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const route: string | undefined = request.routeOptions.url;
    if (route !== undefined && PROBE_ROUTES.has(route)) return;
    const line: AccessLogLine = accessLogLine(request, reply);
    logger.info(`${line.method} ${line.route ?? line.path} ${line.status}`, line);
  });
}

export default fastifyPlugin(AccessLogPlugin, {
  name: 'AccessLogPlugin',
});
