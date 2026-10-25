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
  stateful: true,
  sessionIdleTimeout: 300000,
  maxSessions: 10,
  resourceUrl: 'https://api.omnipotent.test/mcp',
  scopes: ['mcp:use'],
  claudeClientId: '',
};
jest.mock('@configs', () => ({
  ...jest.requireActual('@configs'),
  mcpServerConfig: CONFIG_MOCK,
}));

// A server carrying one tool that answers the caller it was handed, so the invariant under test is
// the plugin's — a session serves the caller of each request — and not a domain tool's.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '@src/types';
jest.mock('@src/mcp', () => ({
  ...jest.requireActual('@src/mcp'),
  createMcpServer: (_fastify: unknown, context: McpContext): McpServer => {
    const server: McpServer = new McpServer({ name: 'e2e', version: '0.0.0' });
    server.registerTool(
      'who-am-i',
      {
        title: 'Who am I',
        description: 'Answers the caller the server was handed',
        outputSchema: z.object({ userId: z.string(), email: z.string(), isSuperAdmin: z.boolean() }),
      },
      async () => {
        const caller: Caller = {
          userId: context.auth.userId,
          email: context.auth.email,
          isSuperAdmin: context.auth.isSuperAdmin,
        };
        return { content: [{ type: 'text', text: JSON.stringify(caller) }], structuredContent: caller };
      }
    );
    return server;
  },
}));

import Fastify, { FastifyInstance, FastifyRequest, LightMyRequestResponse } from 'fastify';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

import ErrorHandlerPlugin from '@src/plugins/error-handler.plugin';
import McpPlugin from '@src/plugins/mcp.plugin';
import { AuthContext } from '@src/types';
import { JANE } from '@test/unit/mocks/auth.fixtures';
import { closeTestApp } from '@test/utils/fastify-test-app.utils';

/** What the probe tool answers. */
type Caller = { userId: string; email: string; isSuperAdmin: boolean };

/**
 * The stateful MCP endpoint end to end, through the real MCP SDK: a session opened by a caller serves its tools to
 * the caller of each request, authenticated again every time, never to the identity it was opened with.
 */
describe('E2E::Plugins::McpPlugin::Stateful', () => {
  let app: FastifyInstance;
  let caller: AuthContext;

  /**
   * Send a JSON-RPC message to the endpoint.
   *
   * @param message - The message
   * @param sessionId - The session, once opened
   * @returns The response
   */
  async function send(message: object, sessionId?: string): Promise<LightMyRequestResponse> {
    return app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': LATEST_PROTOCOL_VERSION } : {}),
      },
      payload: JSON.stringify(message),
    });
  }

  /**
   * The JSON-RPC answer of a response, whether sent as JSON or as a server-sent event.
   *
   * @param response - The response
   * @returns The answer
   */
  function answerOf(response: LightMyRequestResponse): { result: { structuredContent: Caller } } {
    const data: string | undefined = response.body
      .split('\n')
      .find((line: string): boolean => line.startsWith('data: '));
    return JSON.parse(data ? data.slice('data: '.length) : response.body);
  }

  beforeEach(async (): Promise<void> => {
    caller = JANE;
    app = Fastify();
    app.decorateRequest('auth', undefined);
    app.addHook('onRequest', async (request: FastifyRequest): Promise<void> => {
      if (request.routeOptions.config.auth === 'mcp') request.auth = caller;
    });
    await app.register(ErrorHandlerPlugin);
    await app.register(McpPlugin);
    await app.ready();
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  it('should run a tool as the caller of the request, their rights read again', async (): Promise<void> => {
    const opened: LightMyRequestResponse = await send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'e2e', version: '1' } },
    });
    expect(opened.statusCode).toBe(200);
    const sessionId: string = opened.headers['mcp-session-id'] as string;
    expect(sessionId).toEqual(expect.any(String));
    await send({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId);

    const before: LightMyRequestResponse = await send(
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'who-am-i', arguments: {} } },
      sessionId
    );
    // The same user, made a super-admin since the session was opened.
    caller = { ...JANE, isSuperAdmin: true };
    const after: LightMyRequestResponse = await send(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'who-am-i', arguments: {} } },
      sessionId
    );

    expect(answerOf(before).result.structuredContent).toEqual({
      userId: JANE.userId,
      email: JANE.email,
      isSuperAdmin: false,
    });
    expect(answerOf(after).result.structuredContent.isSuperAdmin).toBe(true);
  });
});
