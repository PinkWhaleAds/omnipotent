jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  const registerToolMock: jest.Mock = jest.fn();
  const McpServerMock: jest.Mock = jest.fn().mockImplementation(() => ({
    registerTool: registerToolMock,
  }));
  return { McpServer: McpServerMock, __registerToolMock: registerToolMock };
});

import { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpServer, MCP_INSTRUCTIONS } from '@src/mcp';
import { StatusService } from '@services';
import { McpContext } from '@src/types';
import { actor } from '@test/unit/mocks/auth.fixtures';
import { EXPECTED_TOOLS } from '@test/unit/mocks/mcp-tools.fixtures';

describe('Unit::Mcp::McpServerFactory', () => {
  const context: McpContext = {
    auth: actor({ id: '6f1c2c1e-6d43-4c84-9a8e-0f5e3c1b9d10', email: 'jane@brand.com', isSuperAdmin: false }),
  };
  let mockFastify: FastifyInstance;

  /** The registerTool mock shared by every server the factory builds. */
  function registerToolMock(): jest.Mock {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@modelcontextprotocol/sdk/server/mcp.js') as { __registerToolMock: jest.Mock }).__registerToolMock;
  }

  beforeEach((): void => {
    jest.clearAllMocks();
    mockFastify = { statusService: new StatusService() } as unknown as FastifyInstance;
  });

  describe('createMcpServer', () => {
    it('should create an McpServer with app name, version and instructions', (): void => {
      createMcpServer(mockFastify, context);

      expect(McpServer).toHaveBeenCalledTimes(1);
      expect(McpServer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.any(String),
          version: expect.any(String),
        }),
        { instructions: MCP_INSTRUCTIONS }
      );
    });

    it('should register the get-status tool', (): void => {
      createMcpServer(mockFastify, context);

      expect(registerToolMock()).toHaveBeenCalledWith(
        'get-status',
        expect.objectContaining({
          title: expect.any(String),
          description: expect.any(String),
        }),
        expect.any(Function)
      );
    });

    it('should register every tool exactly once', (): void => {
      createMcpServer(mockFastify, context);

      const names: string[] = registerToolMock().mock.calls.map((call: unknown[]): string => call[0] as string);
      // Each phase registers its resource in `src/mcp/tools/index.ts` and adds its tools to
      // `EXPECTED_TOOLS`, which the end-to-end spec exercises one by one.
      expect(names).toEqual(EXPECTED_TOOLS);
      expect(new Set(names).size).toBe(names.length);
    });

    it('should tell the model the hierarchy and the roles it works with', (): void => {
      expect(MCP_INSTRUCTIONS).toContain('Seat (client company) > Organization (workspace) > Advertiser (brand)');
      expect(MCP_INSTRUCTIONS).toContain('organizationId');
      expect(MCP_INSTRUCTIONS).toContain('viewer reads, manager edits, admin also manages members');
    });

    it('should only name tools it registers in its instructions', (): void => {
      createMcpServer(mockFastify, context);

      const names: string[] = registerToolMock().mock.calls.map((call: unknown[]): string => call[0] as string);
      const toolPattern =
        /\b(?:get|list|create|update|delete|add|upload|preview|generate|apply|reset|invite|remove|link|unlink|set|launch|pause|resume|archive|connect|disconnect)-[a-z-]*[a-z]\b/g;
      const mentioned: string[] = MCP_INSTRUCTIONS.match(toolPattern) ?? [];
      // Nothing to name yet; the point is that the instructions never mention a tool a client cannot call.
      expect(names).toEqual(expect.arrayContaining(mentioned));
    });

    it('should return an McpServer instance', (): void => {
      const server: ReturnType<typeof createMcpServer> = createMcpServer(mockFastify, context);

      expect(server).toBeDefined();
      expect(server.registerTool).toBeDefined();
    });
  });
});
