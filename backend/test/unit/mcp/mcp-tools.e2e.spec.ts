import type { FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { createMcpServer, MCP_INSTRUCTIONS } from '@src/mcp';
import { McpContext, StatusResult, statusResultSchema } from '@src/types';
import { JANE, NOW } from '@test/unit/mocks/auth.fixtures';

/** Result of `client.callTool(...)`. */
type ToolCallResult = Awaited<ReturnType<Client['callTool']>>;

/**
 * Services the MCP tools reach through the Fastify instance.
 *
 * Each phase adds the services of its tools here.
 */
type ServiceName = 'statusService';

/** A fake Fastify instance: every service method is a jest mock. */
type FakeServices = Record<ServiceName, Record<string, jest.Mock>>;

/** A client connected to a real MCP server through an in-memory transport. */
type Connection = { client: Client; close: () => Promise<void> };

/** What `get-status` answers. */
const STATUS: StatusResult = { app_name: 'omnipotent', app_version: '1.0.0', timestamp: NOW.getTime() };

/**
 * Every tool the server registers, in the order it registers them.
 *
 * Each phase adds the tools of its resource here, so a tool registered twice — or renamed without
 * the list following — fails this suite.
 */
const EXPECTED_TOOLS: string[] = ['get-status'];

/**
 * Build the fake services the tools reach.
 *
 * @returns The fakes, with their answers set
 */
function fakeServices(): FakeServices {
  return {
    statusService: { getStatus: jest.fn().mockReturnValue(STATUS) },
  };
}

/**
 * Connect a real MCP client to a real MCP server through an in-memory transport, so a tool call goes
 * through the protocol — argument validation, `structuredContent` against the advertised output
 * schema, and tool errors — exactly as an assistant's would.
 *
 * @param services - The fake services the tools reach
 * @param context - The caller of the MCP connection
 * @returns The connected client and a function closing both ends
 */
async function connect(services: FakeServices, context: McpContext): Promise<Connection> {
  const server: McpServer = createMcpServer(services as unknown as FastifyInstance, context);
  const [clientTransport, serverTransport]: [InMemoryTransport, InMemoryTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client: Client = new Client({ name: 'e2e-test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  await client.listTools();

  return {
    client,
    close: async (): Promise<void> => {
      await client.close();
      await server.close();
    },
  };
}

/**
 * The text of the single content block of a tool result.
 *
 * @param result - A tool result
 * @returns Its text
 */
function textOf(result: ToolCallResult): string {
  return (result.content as { type: string; text: string }[])[0].text;
}

describe('Unit::Mcp::McpToolsE2E', () => {
  const context: McpContext = { auth: JANE };
  let services: FakeServices;
  let connection: Connection;

  beforeEach(async (): Promise<void> => {
    services = fakeServices();
    connection = await connect(services, context);
  });

  afterEach(async (): Promise<void> => {
    await connection.close();
  });

  describe('fixtures', () => {
    it('should answer what the schema of the resource describes', (): void => {
      expect(statusResultSchema.safeParse(STATUS).success).toBe(true);
    });
  });

  describe('initialize', () => {
    it('should hand the client the instructions of the server', (): void => {
      expect(connection.client.getInstructions()).toBe(MCP_INSTRUCTIONS);
    });
  });

  describe('tools/list', () => {
    it('should list every tool exactly once', async (): Promise<void> => {
      const { tools }: { tools: Tool[] } = await connection.client.listTools();

      expect(tools.map((tool: Tool): string => tool.name)).toEqual(EXPECTED_TOOLS);
    });

    it('should give every tool a title, a description and an output JSON schema', async (): Promise<void> => {
      const { tools }: { tools: Tool[] } = await connection.client.listTools();

      for (const tool of tools) {
        expect(tool).toEqual(
          expect.objectContaining({
            title: expect.any(String),
            description: expect.any(String),
            outputSchema: expect.objectContaining({ type: 'object', properties: expect.any(Object) }),
          })
        );
      }
    });
  });

  describe('tools/call', () => {
    it('should reach the service and answer its payload twice: structured and as JSON text', async (): Promise<void> => {
      const result: ToolCallResult = await connection.client.callTool({ name: 'get-status', arguments: {} });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual(STATUS);
      expect(JSON.parse(textOf(result))).toEqual(STATUS);
      expect(services.statusService.getStatus).toHaveBeenCalledTimes(1);
    });

    it('should refuse a tool it does not know', async (): Promise<void> => {
      const result: ToolCallResult = await connection.client.callTool({ name: 'get-campaign', arguments: {} });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('get-campaign');
    });
  });
});
