import { RateLimit, ROUTE_RATE_LIMITS } from '@src/plugins/rate-limit.plugin';
import type { McpContext } from '@src/types/mcp.types';
import { httpError, TtlCache } from '@utils';

/** Most callers counted per route at once (the oldest are forgotten first). */
const MAX_CALLERS = 10_000;

/**
 * The calls of one caller in the current window.
 *
 * @property count - Calls made so far
 * @property resetAt - When the window ends, in milliseconds since the epoch
 */
type CallWindow = { count: number; resetAt: number };

/**
 * Limits how often each user may call the MCP tools that mirror a route of {@link ROUTE_RATE_LIMITS}: the same limit
 * as the route (the platforms' quotas or the e-mails a tool spends are the route's), per user and per process. The
 * MCP endpoint's own limit counts every tool call besides. A tool's counter is its own, apart from the route's.
 *
 * @example
 * ```typescript
 * return runTool(async () => {
 *   mcpToolRateLimiter.consume(context, 'POST /agency-links');
 *   return service.create(context.auth, organizationId, body);
 * });
 * ```
 */
export class McpToolRateLimiter {
  /** The windows of the callers, by route. */
  private readonly windows = new Map<string, TtlCache<CallWindow>>();

  /**
   * @param limits - The limits by route ({@link ROUTE_RATE_LIMITS} by default)
   * @param now - Clock, in milliseconds since the epoch
   */
  constructor(
    private readonly limits: Readonly<Record<string, RateLimit | false>> = ROUTE_RATE_LIMITS,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Count one call of a tool for its caller, refusing it past its route's limit.
   *
   * @param context - The MCP context of the call
   * @param route - The route the tool mirrors, as `METHOD /pattern`
   * @returns Nothing
   * @throws Error with status 429 coded `rate_limited` (params `retryAfter` in seconds and `max`), as the route answers
   */
  public consume(context: McpContext, route: string): void {
    const limit: RateLimit | false | undefined = this.limits[route];
    if (!limit) return;
    let callers: TtlCache<CallWindow> | undefined = this.windows.get(route);
    if (!callers) {
      callers = new TtlCache<CallWindow>(limit.windowMs, MAX_CALLERS, this.now);
      this.windows.set(route, callers);
    }
    const key = `user:${context.auth.userId}`;
    let window: CallWindow | undefined = callers.get(key);
    if (!window) {
      window = { count: 0, resetAt: this.now() + limit.windowMs };
      callers.set(key, window);
    }
    if (window.count >= limit.max) {
      const retryAfter: number = Math.max(1, Math.ceil((window.resetAt - this.now()) / 1000));
      throw httpError(429, `Too many requests: retry in ${retryAfter} seconds`, {
        code: 'rate_limited',
        params: { retryAfter, max: limit.max },
      });
    }
    window.count += 1;
  }
}

/** The limiter of the MCP tools of this process. */
export const mcpToolRateLimiter: McpToolRateLimiter = new McpToolRateLimiter();
