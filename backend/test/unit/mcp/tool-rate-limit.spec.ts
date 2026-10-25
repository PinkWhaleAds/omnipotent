import { McpToolRateLimiter, mcpToolRateLimiter } from '@src/mcp/tool-rate-limit';
import { ROUTE_RATE_LIMITS } from '@src/plugins/rate-limit.plugin';
import { McpContext } from '@src/types';
import { JANE, SUPER_ADMIN } from '@test/unit/mocks/auth.fixtures';

describe('Unit::Mcp::McpToolRateLimiter', () => {
  const jane: McpContext = { auth: JANE };
  const admin: McpContext = { auth: SUPER_ADMIN };
  let now: number;
  let limiter: McpToolRateLimiter;

  beforeEach((): void => {
    now = Date.parse('2026-10-18T12:00:00.000Z');
    limiter = new McpToolRateLimiter(
      { 'POST /x': { max: 2, windowMs: 60_000 }, 'GET /free': false },
      (): number => now
    );
  });

  it('should allow the calls of a user up to the limit of the route, then answer 429 like the route', (): void => {
    limiter.consume(jane, 'POST /x');
    now += 10_000;
    limiter.consume(jane, 'POST /x');

    let error: unknown;
    try {
      limiter.consume(jane, 'POST /x');
    } catch (thrown: unknown) {
      error = thrown;
    }

    expect(error).toMatchObject({
      statusCode: 429,
      errorCode: 'rate_limited',
      errorParams: { retryAfter: 50, max: 2 },
      message: 'Too many requests: retry in 50 seconds',
    });
  });

  it('should count each user apart, and allow again once the window is over', (): void => {
    limiter.consume(jane, 'POST /x');
    limiter.consume(jane, 'POST /x');
    expect(() => limiter.consume(admin, 'POST /x')).not.toThrow();

    now += 60_000;
    expect(() => limiter.consume(jane, 'POST /x')).not.toThrow();
  });

  it('should never limit a route without its own limit', (): void => {
    for (let call = 0; call < 5; call += 1) {
      limiter.consume(jane, 'GET /free');
      limiter.consume(jane, 'GET /unknown');
    }
  });

  it('should take the limits of the routes by default', (): void => {
    // The socle only limits the MCP endpoint itself; a phase adding a costly tool gives its route a
    // limit in ROUTE_RATE_LIMITS, and the tool consumes it here.
    const limit = ROUTE_RATE_LIMITS['POST /mcp'];
    expect(limit).toEqual({ max: 120, windowMs: 60_000 });
    const context: McpContext = { auth: { ...JANE, userId: 'rate-limit-spec' } };
    for (let call = 0; call < 120; call += 1) mcpToolRateLimiter.consume(context, 'POST /mcp');
    expect(() => mcpToolRateLimiter.consume(context, 'POST /mcp')).toThrow(
      expect.objectContaining({ statusCode: 429 })
    );
  });
});
