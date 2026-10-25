import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { McpServerConfig } from '@configs';
const CONFIG_MOCK: McpServerConfig = {
  enabled: true,
  endpoint: '/mcp',
  stateful: false,
  sessionIdleTimeout: 300000,
  maxSessions: 100,
  resourceUrl: 'https://api.omnipotent.test/mcp',
  scopes: ['mcp:use'],
  claudeClientId: '',
};
jest.mock('@configs', () => ({
  ...jest.requireActual('@configs'),
  mcpServerConfig: CONFIG_MOCK,
}));

import { IncomingMessage, ServerResponse } from 'node:http';

const handleRequestMock: jest.Mock = jest
  .fn()
  .mockImplementation(async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!res.writableEnded) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    }
  });
const transportCloseMock: jest.Mock = jest.fn().mockResolvedValue(undefined);
const connectMock: jest.Mock = jest.fn().mockResolvedValue(undefined);
const serverCloseMock: jest.Mock = jest.fn().mockResolvedValue(undefined);

let transportSessionId: string | undefined;
let capturedOnclose: (() => void) | undefined;
let statelessRequested = false;

const TransportMock: jest.Mock = jest.fn().mockImplementation((options?: { sessionIdGenerator?: () => string }) => {
  statelessRequested = options !== undefined && options.sessionIdGenerator === undefined;
  if (options?.sessionIdGenerator) options.sessionIdGenerator();

  return {
    handleRequest: handleRequestMock,
    close: transportCloseMock,
    get sessionId(): string | undefined {
      return transportSessionId;
    },
    set onclose(handler: (() => void) | undefined) {
      capturedOnclose = handler;
    },
    get onclose(): (() => void) | undefined {
      return capturedOnclose;
    },
  };
});

jest.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: TransportMock,
}));

jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: jest.fn().mockImplementation(() => ({
    connect: connectMock,
    close: serverCloseMock,
    registerTool: jest.fn(),
  })),
}));

const createMcpServerSpy: jest.Mock = jest.fn();
jest.mock('@src/mcp', () => {
  const actual: typeof import('@src/mcp') = jest.requireActual('@src/mcp');
  return {
    ...actual,
    createMcpServer: (...args: Parameters<typeof actual.createMcpServer>): unknown => {
      createMcpServerSpy(...args);
      return actual.createMcpServer(...args);
    },
  };
});

import Fastify, { FastifyInstance, FastifyRequest, LightMyRequestResponse } from 'fastify';
import { AuthContext, McpContext } from '@src/types';
import { closeTestApp } from '@test/utils/fastify-test-app.utils';
import ErrorHandlerPlugin from '@src/plugins/error-handler.plugin';
import McpPlugin, { MCP_BODY_LIMIT } from '@src/plugins/mcp.plugin';
import StatusServicePlugin from '@src/services/status.service';
import { actor } from '@test/unit/mocks/auth.fixtures';

describe('Unit::Plugins::McpPlugin', () => {
  const JANE: AuthContext = actor({
    id: '11111111-1111-4111-8111-111111111111',
    email: 'jane@a.co',
    isSuperAdmin: false,
  });
  const JOHN: AuthContext = actor({
    id: '22222222-2222-4222-8222-222222222222',
    email: 'john@a.co',
    isSuperAdmin: false,
  });
  const ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333';
  const OTHER_ORGANIZATION_ID = '44444444-4444-4444-8444-444444444444';
  let app: FastifyInstance;
  let caller: AuthContext;

  /**
   * Builds an app with the plugin, after applying config overrides.
   * The auth plugin is stood in for by a hook authenticating every request as `caller`.
   */
  async function buildApp(overrides: Partial<McpServerConfig> = {}): Promise<FastifyInstance> {
    Object.assign(CONFIG_MOCK, overrides);
    const instance: FastifyInstance = Fastify();
    instance.decorateRequest('auth', undefined);
    instance.addHook('onRequest', async (request: FastifyRequest): Promise<void> => {
      if (request.routeOptions.config.auth === 'mcp') request.auth = caller;
    });
    await instance.register(ErrorHandlerPlugin);
    await instance.register(StatusServicePlugin);
    await instance.register(McpPlugin);
    await instance.ready();
    return instance;
  }

  /** Sends a JSON-RPC-ish POST to the MCP endpoint. */
  async function post(headers: Record<string, string> = {}, url = '/mcp'): Promise<LightMyRequestResponse> {
    return app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', ...headers },
      body: '{}',
    });
  }

  /** Waits for real time to pass, so the eviction sweep can run. */
  async function sleep(ms: number): Promise<void> {
    await new Promise((resolve): NodeJS.Timeout => setTimeout(resolve, ms));
  }

  beforeEach((): void => {
    jest.clearAllMocks();
    caller = JANE;
    transportSessionId = undefined;
    capturedOnclose = undefined;
    statelessRequested = false;
    Object.assign(CONFIG_MOCK, {
      enabled: true,
      endpoint: '/mcp',
      stateful: false,
      sessionIdleTimeout: 300000,
      maxSessions: 100,
      resourceUrl: 'https://api.omnipotent.test/mcp',
      scopes: ['mcp:use'],
      claudeClientId: '',
    });
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  describe('stateless mode (default)', () => {
    it('should create the transport without a session id generator', async (): Promise<void> => {
      app = await buildApp();

      const response: LightMyRequestResponse = await post();

      expect(response.statusCode).toBe(200);
      expect(statelessRequested).toBe(true);
      expect(connectMock).toHaveBeenCalledTimes(1);
    });

    it('should take a body up to 8 MB (an image in base64), and no larger', async (): Promise<void> => {
      app = await buildApp();
      const bodyOf = (bytes: number): string => JSON.stringify({ base64: 'A'.repeat(bytes) });

      const image: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { 'content-type': 'application/json' },
        body: bodyOf(7 * 1024 * 1024),
      });
      const tooLarge: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { 'content-type': 'application/json' },
        body: bodyOf(MCP_BODY_LIMIT),
      });

      expect(image.statusCode).toBe(200);
      expect(tooLarge.statusCode).toBe(413);
      expect(JSON.parse(tooLarge.body).code).toBe('payload_too_large');
    });

    it('should build a fresh server per request, keeping nothing between them', async (): Promise<void> => {
      app = await buildApp();

      await post();
      await post();

      expect(connectMock).toHaveBeenCalledTimes(2);
      expect(TransportMock).toHaveBeenCalledTimes(2);
    });

    it('should tear the server and transport down when the response closes', async (): Promise<void> => {
      app = await buildApp();

      await post();

      expect(transportCloseMock).toHaveBeenCalled();
      expect(serverCloseMock).toHaveBeenCalled();
    });

    it('should build the server for the authenticated caller', async (): Promise<void> => {
      app = await buildApp();

      await post();

      expect(createMcpServerSpy).toHaveBeenCalledWith(expect.anything(), { auth: JANE, organizationId: undefined });
    });

    it('should hand a well-formed X-Organization-Id header to the tools as the default Organization', async (): Promise<void> => {
      app = await buildApp();

      await post({ 'x-organization-id': ORGANIZATION_ID });

      expect(createMcpServerSpy).toHaveBeenCalledWith(expect.anything(), {
        auth: JANE,
        organizationId: ORGANIZATION_ID,
      });
    });

    it('should take the Organization named in the address of a connector that sends no header', async (): Promise<void> => {
      app = await buildApp();

      await post({}, `/mcp?organization=${ORGANIZATION_ID}`);
      await post({ 'x-organization-id': OTHER_ORGANIZATION_ID }, `/mcp?organization=${ORGANIZATION_ID}`);
      await post({}, '/mcp?organization=not-a-uuid');

      expect(createMcpServerSpy.mock.calls.map(([, context]) => context)).toEqual([
        { auth: JANE, organizationId: ORGANIZATION_ID },
        // The header wins over the address.
        { auth: JANE, organizationId: OTHER_ORGANIZATION_ID },
        { auth: JANE, organizationId: undefined },
      ]);
    });

    it('should ignore a malformed X-Organization-Id header', async (): Promise<void> => {
      app = await buildApp();

      await post({ 'x-organization-id': 'not-a-uuid' });

      expect(createMcpServerSpy).toHaveBeenCalledWith(expect.anything(), { auth: JANE, organizationId: undefined });
    });

    it('should ignore a session header instead of trusting it', async (): Promise<void> => {
      app = await buildApp();

      const response: LightMyRequestResponse = await post({ 'mcp-session-id': 'from-another-replica' });

      expect(response.statusCode).toBe(200);
      expect(statelessRequested).toBe(true);
    });

    it.each(['GET', 'DELETE'] as const)('should answer 405 on %s', async (method): Promise<void> => {
      app = await buildApp();

      const response: LightMyRequestResponse = await app.inject({ method, url: '/mcp' });

      expect(response.statusCode).toBe(405);
      expect(JSON.parse(response.body)).toMatchObject({
        statusCode: 405,
        error: 'Method Not Allowed',
        code: 'mcp_sessions_disabled',
        params: { method },
        message: expect.stringContaining('stateful MCP sessions'),
      });
    });
  });

  describe('stateful mode', () => {
    it('should warn about session affinity at registration', async (): Promise<void> => {
      app = await buildApp({ stateful: true });

      expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining('session affinity'));
    });

    it('should create a session and reuse it for the next request', async (): Promise<void> => {
      transportSessionId = 'session-1';
      app = await buildApp({ stateful: true });

      await post();
      expect(connectMock).toHaveBeenCalledTimes(1);

      await post({ 'mcp-session-id': 'session-1' });
      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(handleRequestMock).toHaveBeenCalledTimes(2);
    });

    it("should hand the session's tools the caller of each request, authenticated again, not its opener", async (): Promise<void> => {
      transportSessionId = 'session-1';
      app = await buildApp({ stateful: true });
      const seen: McpContext[] = [];
      const answer = async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
        // What a tool reads while the request is being handled.
        const context: McpContext = createMcpServerSpy.mock.calls[0][1] as McpContext;
        seen.push({ auth: context.auth, organizationId: context.organizationId });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      };
      handleRequestMock.mockImplementationOnce(answer).mockImplementationOnce(answer);

      await post();
      // The same user, whose rights changed since the session was opened, now with a default Organization.
      caller = { ...JANE, isSuperAdmin: true };
      await post({ 'mcp-session-id': 'session-1', 'x-organization-id': ORGANIZATION_ID });

      expect(createMcpServerSpy).toHaveBeenCalledTimes(1);
      expect(seen).toEqual([
        { auth: JANE, organizationId: undefined },
        { auth: { ...JANE, isSuperAdmin: true }, organizationId: ORGANIZATION_ID },
      ]);
      // Outside a request, the tools have no caller at all.
      const context: McpContext = createMcpServerSpy.mock.calls[0][1] as McpContext;
      expect(() => context.auth).toThrow('An MCP tool ran outside of a request: it has no caller');
      expect(() => context.organizationId).toThrow('An MCP tool ran outside of a request: it has no caller');
    });

    it('should refuse a session presented by another user', async (): Promise<void> => {
      transportSessionId = 'session-1';
      app = await buildApp({ stateful: true });
      await post();

      caller = JOHN;
      const response: LightMyRequestResponse = await post({ 'mcp-session-id': 'session-1' });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body)).toMatchObject({
        code: 'mcp_session_of_another_user',
        message: 'This MCP session belongs to another user',
      });
    });

    it('should answer 400 for an unknown session id', async (): Promise<void> => {
      app = await buildApp({ stateful: true });

      const response: LightMyRequestResponse = await post({ 'mcp-session-id': 'nope' });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
        code: 'mcp_session_invalid',
        message: 'Invalid or missing session ID',
      });
    });

    it('should refuse a new session past maxSessions', async (): Promise<void> => {
      transportSessionId = 'session-1';
      app = await buildApp({ stateful: true, maxSessions: 1 });

      await post();
      const response: LightMyRequestResponse = await post();

      expect(response.statusCode).toBe(429);
      expect(JSON.parse(response.body)).toMatchObject({
        statusCode: 429,
        code: 'mcp_sessions_limit_reached',
        params: { max: 1 },
        message: 'Too many active MCP sessions',
      });
    });

    it('should drop the session and close the server when the transport closes', async (): Promise<void> => {
      transportSessionId = 'session-1';
      app = await buildApp({ stateful: true, maxSessions: 1 });

      await post();
      capturedOnclose?.();
      expect(serverCloseMock).toHaveBeenCalled();

      // The slot is free again, so a new session is accepted.
      const response: LightMyRequestResponse = await post();
      expect(response.statusCode).toBe(200);
    });

    it('should not throw on close when the transport has no session id', async (): Promise<void> => {
      app = await buildApp({ stateful: true });

      await post();

      expect((): void => capturedOnclose?.()).not.toThrow();
    });

    it('should evict a session left idle past the timeout', async (): Promise<void> => {
      transportSessionId = 'session-1';
      // Tiny timeout so the real sweep runs inside the test: fake timers cannot
      // be used here because app.inject relies on real immediates.
      app = await buildApp({ stateful: true, sessionIdleTimeout: 20, maxSessions: 1 });

      await post();
      transportCloseMock.mockClear();

      await sleep(100);

      expect(loggerMock.info).toHaveBeenCalledWith('Evicting idle MCP session: session-1');
      expect(transportCloseMock).toHaveBeenCalledTimes(1);
    });

    it('should keep a session that is still being used', async (): Promise<void> => {
      transportSessionId = 'session-1';
      app = await buildApp({ stateful: true, sessionIdleTimeout: 200 });

      await post();
      await sleep(120);
      // Touching the session resets its idle clock before the first sweep.
      await post({ 'mcp-session-id': 'session-1' });
      transportCloseMock.mockClear();

      await sleep(140);

      expect(transportCloseMock).not.toHaveBeenCalled();
    });

    it('should serve GET and DELETE for a known session', async (): Promise<void> => {
      transportSessionId = 'session-1';
      app = await buildApp({ stateful: true });
      await post();

      for (const method of ['GET', 'DELETE'] as const) {
        handleRequestMock.mockClear();
        const response: LightMyRequestResponse = await app.inject({
          method,
          url: '/mcp',
          headers: { 'mcp-session-id': 'session-1' },
        });
        expect(response.statusCode).toBe(200);
        expect(handleRequestMock).toHaveBeenCalledTimes(1);
      }
    });

    it.each(['GET', 'DELETE'] as const)('should answer 400 on %s without a session', async (method): Promise<void> => {
      app = await buildApp({ stateful: true });

      const response: LightMyRequestResponse = await app.inject({ method, url: '/mcp' });

      expect(response.statusCode).toBe(400);
    });

    it('should close every transport when the server shuts down', async (): Promise<void> => {
      transportSessionId = 'session-1';
      app = await buildApp({ stateful: true });
      await post();
      transportCloseMock.mockClear();

      await app.close();

      expect(loggerMock.info).toHaveBeenCalledWith('Closing MCP transport for session: session-1');
      expect(transportCloseMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('disabled', () => {
    it('should not register any route', async (): Promise<void> => {
      app = await buildApp({ enabled: false });

      const response: LightMyRequestResponse = await post();

      expect(response.statusCode).toBe(404);
    });
  });
});
