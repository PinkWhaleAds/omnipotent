import FastifyRateLimit, { errorResponseBuilderContext, normalizeIP } from '@fastify/rate-limit';
import { FastifyInstance, FastifyRequest, FastifySchema, RouteOptions } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { mcpServerConfig } from '@configs/mcp-server.config';
import { errorResponseSchema } from '@src/types/error.types';
import { clientIpOf, httpError, toJsonSchema } from '@utils';

/** One minute, in milliseconds. */
const MINUTE = 60_000;

/**
 * A rate limit: at most `max` requests per `windowMs` milliseconds, per caller — the authenticated user, or the
 * client address on a public route.
 */
export type RateLimit = { max: number; windowMs: number };

/** What a route not listed in {@link ROUTE_RATE_LIMITS} allows: 600 requests a minute (10 a second on average). */
export const DEFAULT_RATE_LIMIT: RateLimit = { max: 600, windowMs: MINUTE };

/**
 * The routes with their own limit, by `METHOD /pattern` (`false`: never limited). Each has its own counter; the
 * other routes share one, {@link DEFAULT_RATE_LIMIT}.
 *
 * A route that costs — a platform quota, an AI call, an e-mail sent to someone else, a file, a heavy
 * read — gets its own limit here, in the phase that adds it (`CLAUDE.md`); a public route gets one
 * too, since it is counted per client address.
 */
export const ROUTE_RATE_LIMITS: Readonly<Record<string, RateLimit | false>> = {
  // Probes: the load balancer and the orchestrator call them every few seconds.
  'GET /livez': false,
  'GET /readyz': false,
  'GET /healthz': false,
  // Public routes, per client address.
  'GET /status': { max: 60, windowMs: MINUTE },
  // MCP: one request per tool call of an assistant.
  [`POST ${mcpServerConfig.endpoint}`]: { max: 120, windowMs: MINUTE },
};

/**
 * Options of {@link RateLimitPlugin}, for tests.
 *
 * @property limits - The limits by route ({@link ROUTE_RATE_LIMITS} by default)
 * @property defaultLimit - The limit of the other routes ({@link DEFAULT_RATE_LIMIT} by default)
 */
export type RateLimitPluginOptions = {
  limits?: Readonly<Record<string, RateLimit | false>>;
  defaultLimit?: RateLimit;
};

/** The documented answer of a refused request. */
const RATE_LIMITED_RESPONSE: object = toJsonSchema(errorResponseSchema);

/**
 * Who a request is counted for: its authenticated user, else its client address (an IPv6 address by its /64,
 * which one client usually holds whole).
 *
 * @param request - The request, authenticated or not (the limit runs after the authentication)
 * @returns `user:<id>` or `ip:<address>`
 *
 * @example
 * ```typescript
 * rateLimitKey(request); // 'user:6f1c…' or 'ip:198.51.100.7'
 * ```
 */
export function rateLimitKey(request: FastifyRequest): string {
  return request.auth ? `user:${request.auth.userId}` : `ip:${normalizeIP(clientIpOf(request))}`;
}

/**
 * The error of a refused request, in the shape of every error: 429 `rate_limited`, with `retryAfter` (seconds)
 * and `max` (requests allowed in the window). The `Retry-After` header carries the same delay.
 *
 * @param _request - The request
 * @param context - The limit and when it resets
 * @returns The error to throw
 */
export function rateLimitError(_request: FastifyRequest, context: errorResponseBuilderContext): Error {
  const retryAfter: number = Math.max(1, Math.ceil(context.ttl / 1000));
  return httpError(429, `Too many requests: retry in ${retryAfter} seconds`, {
    code: 'rate_limited',
    params: { retryAfter, max: context.max },
  });
}

/**
 * The limit of a route.
 *
 * @param limits - The limits by route
 * @param method - Its method(s); a `HEAD` route takes the limit of its `GET`
 * @param url - Its pattern
 * @returns Its own limit, `false` when it is never limited, `undefined` for the shared one
 */
function limitOf(
  limits: Readonly<Record<string, RateLimit | false>>,
  method: RouteOptions['method'],
  url: string
): RateLimit | false | undefined {
  const methods: string[] = Array.isArray(method) ? method : [method];
  for (const name of methods) {
    const limit: RateLimit | false | undefined = limits[`${name === 'HEAD' ? 'GET' : name} ${url}`];
    if (limit !== undefined) return limit;
  }
  return undefined;
}

/**
 * Limits how often each caller may call the API (`@fastify/rate-limit`): per authenticated user, or per client
 * address on public routes ({@link rateLimitKey}). Every route allows {@link DEFAULT_RATE_LIMIT} on a counter shared
 * by them all, except those of {@link ROUTE_RATE_LIMITS}, each with its own counter (the probes are never limited).
 * A refused request answers 429 `rate_limited` with `retryAfter`, and the `Retry-After` header; every answer carries
 * `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`. The 429 is added to the documented
 * responses of every limited route.
 *
 * The counters live in each process: with several API tasks, a caller reaching them all gets as many times the
 * limit. The firewall in front of CloudFront (AWS WAF) limits each address across all of them.
 *
 * Register it after the error handler and before the routes; the check runs on each route's `onRequest`, after the
 * authentication (route hooks follow the instance's), so a request is counted for its user.
 *
 * @param fastify - The Fastify instance to protect
 * @param options - Limits, for tests
 * @returns A promise that resolves once the plugin is registered
 *
 * @example
 * ```typescript
 * await fastify.register(RateLimitPlugin);
 * ```
 */
async function RateLimitPlugin(fastify: FastifyInstance, options: RateLimitPluginOptions): Promise<void> {
  const limits: Readonly<Record<string, RateLimit | false>> = options.limits ?? ROUTE_RATE_LIMITS;
  const defaultLimit: RateLimit = options.defaultLimit ?? DEFAULT_RATE_LIMIT;

  // Before the hook of `@fastify/rate-limit`, which reads `config.rateLimit` of each route.
  fastify.addHook('onRoute', (routeOptions: RouteOptions): void => {
    const limit: RateLimit | false | undefined = limitOf(limits, routeOptions.method, routeOptions.url);
    if (limit !== undefined) {
      routeOptions.config = {
        ...routeOptions.config,
        rateLimit: limit === false ? false : { max: limit.max, timeWindow: limit.windowMs },
      };
    }
    const schema: FastifySchema | undefined = routeOptions.schema;
    if (limit !== false && schema?.response) {
      routeOptions.schema = { ...schema, response: { ...(schema.response as object), 429: RATE_LIMITED_RESPONSE } };
    }
  });

  await fastify.register(FastifyRateLimit, {
    global: true,
    max: defaultLimit.max,
    timeWindow: defaultLimit.windowMs,
    keyGenerator: rateLimitKey,
    errorResponseBuilder: rateLimitError,
  });
}

export default fastifyPlugin(RateLimitPlugin, {
  name: 'RateLimitPlugin',
  dependencies: ['ErrorHandlerPlugin'],
});
