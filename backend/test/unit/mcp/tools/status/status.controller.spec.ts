type ToolHandler = () => Promise<{ content: { type: string; text: string }[] }>;

const registerToolMock: jest.Mock = jest.fn();
jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  const McpServerMock: jest.Mock = jest.fn().mockImplementation(() => ({
    registerTool: registerToolMock,
  }));
  return { McpServer: McpServerMock };
});

import type { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import StatusToolsController from '@src/mcp/tools/status/status.controller';
import { StatusService } from '@services';

describe('Unit::Mcp::Tools::StatusToolsController', () => {
  let fastify: FastifyInstance;

  beforeEach((): void => {
    jest.clearAllMocks();
    fastify = { statusService: new StatusService() } as unknown as FastifyInstance;
  });

  it('should register the get-status tool', (): void => {
    const server: McpServer = new McpServer({ name: 'test', version: '0.0.0' });
    StatusToolsController(server, fastify);

    expect(registerToolMock).toHaveBeenCalledTimes(1);
    expect(registerToolMock).toHaveBeenCalledWith(
      'get-status',
      expect.objectContaining({
        title: expect.any(String),
        description: expect.any(String),
      }),
      expect.any(Function)
    );
  });

  it('should return status data when the tool handler is invoked', async (): Promise<void> => {
    const server: McpServer = new McpServer({ name: 'test', version: '0.0.0' });
    StatusToolsController(server, fastify);

    const handler: ToolHandler = registerToolMock.mock.calls[0][2] as ToolHandler;
    const result: { content: { type: string; text: string }[] } = await handler();

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const parsed: { app_name: string; app_version: string; timestamp: number } = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty('app_name');
    expect(parsed).toHaveProperty('app_version');
    expect(parsed).toHaveProperty('timestamp');
    expect(typeof parsed.timestamp).toBe('number');
  });
});
