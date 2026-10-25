import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { mcpServerConfig } from '@configs';
import { createMcpServer } from '@src/mcp';
import { AuthContext, McpContext, ORGANIZATION_HEADER } from '@src/types';
import { actorOf, httpError, LoggerBuilder, Logger } from '@utils';

/** Header carrying the MCP session id in stateful mode. */
const SESSION_HEADER = 'mcp-session-id';

/** Upper bound on how often idle sessions are swept. */
const MAX_SWEEP_INTERVAL_IN_MS = 60000;

/**
 * Largest body of an MCP request: `upload-asset` carries an image of `Storage.maxUploadBytes` (5 MB) in base64, a
 * third larger, in its JSON. Fastify's default (1 MB) refused most images; every other route keeps it.
 */
export const MCP_BODY_LIMIT: number = 8 * 1024 * 1024;

/** Shape of a canonical UUID, used to read the optional organization header. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parameter of the server's address naming the default Organization of a connector that sends no header. */
const ORGANIZATION_QUERY = 'organization';

/** A stateful MCP session, the user who opened it, and the last time a request touched it. */
type McpSession = {
  transport: StreamableHTTPServerTransport;
  userId: string;
  lastSeenAt: number;
};

/**
 * Build the MCP context of a request: the authenticated caller, plus the default Organization the client names,
 * in a well-formed `X-Organization-Id` (Claude Code), or else in the `organization` parameter of the server's address
 * (`/mcp?organization=<id>`: Claude's and ChatGPT's connectors send no header, the Organization is chosen once,
 * when the connector is added).
 *
 * @param request - An MCP request authenticated by the auth plugin
 * @returns The context handed to the tools
 */
function contextOf(request: FastifyRequest): McpContext {
  const header: string | string[] | undefined = request.headers[ORGANIZATION_HEADER];
  const query: unknown = (request.query as Record<string, unknown> | undefined)?.[ORGANIZATION_QUERY];
  const named: unknown = typeof header === 'string' ? header : query;
  const organizationId: string | undefined = typeof named === 'string' && UUID_PATTERN.test(named) ? named : undefined;
  return { auth: actorOf(request), organizationId };
}

/**
 * The MCP context of the tools of every stateful session: each read gives the caller of the request being served
 * (set by {@link registerStatefulRoutes} around the transport's handling), not the caller who opened the session.
 * A session thus never keeps an identity: a token of the same user with other rights (super-admin flag, e-mail),
 * or another default Organization, applies from the next request.
 *
 * @param store - Where the context of the request being served lives
 * @returns The context to hand to the tools of a session
 * @throws Error on a read outside a request (a tool called by nothing the client sent)
 */
export function requestBoundContext(store: AsyncLocalStorage<McpContext>): McpContext {
  const current = (): McpContext => {
    const context: McpContext | undefined = store.getStore();
    if (!context) throw new Error('An MCP tool ran outside of a request: it has no caller');
    return context;
  };
  return {
    get auth(): AuthContext {
      return current().auth;
    },
    get organizationId(): string | undefined {
      return current().organizationId;
    },
  };
}

/**
 * Fastify plugin that exposes an MCP (Model Context Protocol) endpoint.
 *
 * Every MCP route authenticates with a token issued for the MCP resource
 * (`config: { auth: 'mcp' }`, see the auth plugin); the tools then act as that
 * user, with the same permission checks as the HTTP API.
 *
 * Two modes, selected by `mcpServerConfig.stateful`:
 *
 * - **Stateless (default)** — every `POST` builds its own server and transport,
 *   answers, and throws them away. Nothing is kept between requests, so any
 *   replica can serve any request: this is the mode that survives horizontal
 *   scaling. `GET` / `DELETE` are session operations and answer 405.
 * - **Stateful** — sessions (and their SSE streams) live in this process's
 *   memory, which buys server-to-client notifications at the cost of pinning a
 *   client to one pod. `CADRAGE.md` § 19 ("Scalabilité horizontale") says **never to enable it**;
 *   it is kept, and tested, because it comes from multi-search. Sessions are capped by `maxSessions`
 *   and evicted after `sessionIdleTimeout` of silence, so a client that vanishes without sending
 *   `DELETE` cannot leak its transport for the life of the pod. A session belongs
 *   to the user who opened it, but its tools act as the caller of each request,
 *   authenticated again every time (see {@link requestBoundContext}).
 *
 * @param fastify - The Fastify instance to register the MCP routes on
 * @returns A promise that resolves once the routes are registered
 *
 * @example
 * ```typescript
 * await fastify.register(McpPlugin);
 * // MCP endpoint available at POST (+ GET/DELETE when stateful) /mcp
 * ```
 */
async function McpPlugin(fastify: FastifyInstance): Promise<void> {
  if (!mcpServerConfig.enabled) {
    return;
  }

  const logger: Logger = LoggerBuilder.getChildLogger('McpPlugin');

  if (mcpServerConfig.stateful) {
    registerStatefulRoutes(fastify, logger);
    return;
  }

  registerStatelessRoutes(fastify, logger);
}

/**
 * Register the stateless MCP endpoint: one server and transport per request.
 *
 * @param fastify - The Fastify instance to register the routes on
 * @param logger - Logger scoped to the plugin
 * @returns Nothing; routes are registered as a side effect
 *
 * @example
 * ```typescript
 * // Called internally when mcpServerConfig.stateful is false:
 * // registerStatelessRoutes(fastify, logger);
 * ```
 */
function registerStatelessRoutes(fastify: FastifyInstance, logger: Logger): void {
  const endpoint: string = mcpServerConfig.endpoint;
  logger.info(`MCP endpoint ${endpoint} registered in stateless mode`);

  fastify.route({
    method: 'POST',
    url: endpoint,
    bodyLimit: MCP_BODY_LIMIT,
    config: { auth: 'mcp' },
    handler: async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const mcpServer: McpServer = createMcpServer(fastify, contextOf(request));
      // `sessionIdGenerator: undefined` is what puts the SDK in stateless
      // mode: no session id is issued and no session validation happens.
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      // Tear both down once the response is over — nothing may outlive the request.
      reply.raw.on('close', (): void => {
        void transport.close();
        void mcpServer.close();
      });

      await mcpServer.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
      reply.hijack();
    },
  });

  // Streaming and termination are session operations, and stateless mode has
  // no sessions. 405 says so, where a 404 would suggest a wrong URL.
  (['GET', 'DELETE'] as const).forEach((method: 'GET' | 'DELETE'): void => {
    fastify.route({
      method,
      url: endpoint,
      config: { auth: 'none' },
      handler: (): never => {
        throw httpError(405, `${method} ${endpoint} requires stateful MCP sessions, which are disabled`, {
          code: 'mcp_sessions_disabled',
          params: { method },
        });
      },
    });
  });
}

/**
 * Register the stateful MCP endpoint, holding sessions in process memory.
 *
 * @param fastify - The Fastify instance to register the routes on
 * @param logger - Logger scoped to the plugin
 * @returns Nothing; routes, the eviction sweep and the close hook are registered as side effects
 *
 * @example
 * ```typescript
 * // Called internally when mcpServerConfig.stateful is true:
 * // registerStatefulRoutes(fastify, logger);
 * ```
 */
function registerStatefulRoutes(fastify: FastifyInstance, logger: Logger): void {
  const endpoint: string = mcpServerConfig.endpoint;

  /** Active MCP sessions indexed by session ID. */
  const sessions = new Map<string, McpSession>();

  /** The caller of the request being served, which the tools of every session read. */
  const requests = new AsyncLocalStorage<McpContext>();
  const context: McpContext = requestBoundContext(requests);

  logger.warn(
    `MCP endpoint ${endpoint} registered in stateful mode: sessions live in this process, ` +
      'so run a single replica or pin each client to one pod (session affinity) — ' +
      'otherwise a client will reach a replica that does not know its session'
  );

  /**
   * Look up a live session and mark it as just used.
   *
   * A session belongs to the user who opened it: another user presenting its
   * id is refused, so a leaked session id cannot be replayed with other credentials.
   *
   * @param request - The incoming request carrying the session header
   * @returns The session's transport
   * @throws Error with status 400 when the header is missing or unknown, 403 when the session belongs to someone else
   */
  const takeSession: (request: FastifyRequest) => StreamableHTTPServerTransport = (
    request: FastifyRequest
  ): StreamableHTTPServerTransport => {
    const sessionId: string | undefined = request.headers[SESSION_HEADER] as string | undefined;
    const session: McpSession | undefined = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) throw httpError(400, 'Invalid or missing session ID', { code: 'mcp_session_invalid' });
    if (session.userId !== actorOf(request).userId) {
      throw httpError(403, 'This MCP session belongs to another user', { code: 'mcp_session_of_another_user' });
    }

    session.lastSeenAt = Date.now();
    return session.transport;
  };

  fastify.route({
    method: 'POST',
    url: endpoint,
    bodyLimit: MCP_BODY_LIMIT,
    config: { auth: 'mcp' },
    handler: async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const sessionId: string | undefined = request.headers[SESSION_HEADER] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId) {
        transport = takeSession(request);
      } else {
        if (sessions.size >= mcpServerConfig.maxSessions) {
          logger.warn(`Refused a new MCP session: ${mcpServerConfig.maxSessions} sessions already active`);
          throw httpError(429, 'Too many active MCP sessions', {
            code: 'mcp_sessions_limit_reached',
            params: { max: mcpServerConfig.maxSessions },
          });
        }

        const mcpServer: McpServer = createMcpServer(fastify, context);
        const newTransport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: (): string => randomUUID(),
        });

        newTransport.onclose = (): void => {
          if (newTransport.sessionId) {
            sessions.delete(newTransport.sessionId);
            logger.info(`MCP session closed: ${newTransport.sessionId}`);
          }
          void mcpServer.close();
        };

        await mcpServer.connect(newTransport);
        transport = newTransport;
      }

      await requests.run(contextOf(request), () => transport.handleRequest(request.raw, reply.raw, request.body));

      // Store the session after handleRequest: the ID only exists once the
      // initialize response has been produced.
      if (transport.sessionId && !sessions.has(transport.sessionId)) {
        sessions.set(transport.sessionId, { transport, userId: actorOf(request).userId, lastSeenAt: Date.now() });
        logger.info(`MCP session initialized: ${transport.sessionId}`);
      }

      reply.hijack();
    },
  });

  fastify.route({
    method: 'GET',
    url: endpoint,
    config: { auth: 'mcp' },
    handler: async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const transport: StreamableHTTPServerTransport = takeSession(request);
      await transport.handleRequest(request.raw, reply.raw);
      reply.hijack();
    },
  });

  fastify.route({
    method: 'DELETE',
    url: endpoint,
    config: { auth: 'mcp' },
    handler: async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const transport: StreamableHTTPServerTransport = takeSession(request);
      await transport.handleRequest(request.raw, reply.raw);
      reply.hijack();
    },
  });

  const sweepInterval: number = Math.min(mcpServerConfig.sessionIdleTimeout, MAX_SWEEP_INTERVAL_IN_MS);
  const sweeper: NodeJS.Timeout = setInterval((): void => {
    evictIdleSessions(sessions, logger);
  }, sweepInterval);
  // Never let the sweep hold the event loop open during shutdown.
  sweeper.unref();

  fastify.addHook('onClose', async (): Promise<void> => {
    clearInterval(sweeper);
    for (const [id, session] of sessions) {
      logger.info(`Closing MCP transport for session: ${id}`);
      await session.transport.close();
    }
    sessions.clear();
  });
}

/**
 * Close every session whose last request is older than the idle timeout.
 *
 * @param sessions - The live session map, mutated in place
 * @param logger - Logger scoped to the plugin
 * @returns Nothing; idle transports are closed as a side effect
 *
 * @example
 * ```typescript
 * // Called internally on each sweep:
 * // evictIdleSessions(sessions, logger);
 * ```
 */
function evictIdleSessions(sessions: Map<string, McpSession>, logger: Logger): void {
  const deadline: number = Date.now() - mcpServerConfig.sessionIdleTimeout;

  for (const [id, session] of sessions) {
    if (session.lastSeenAt > deadline) continue;

    logger.info(`Evicting idle MCP session: ${id}`);
    sessions.delete(id);
    void session.transport.close();
  }
}

export default fastifyPlugin(McpPlugin, {
  name: 'McpPlugin',
});
