jest.mock('config');
import config from 'config';

describe('Unit::Configs::McpServer', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
  });

  it('should use default values when no config exists', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => false);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { mcpServerConfig } = await import('@configs/mcp-server.config');
      expect(mcpServerConfig.enabled).toBe(true);
      expect(mcpServerConfig.endpoint).toBe('/mcp');
      expect(mcpServerConfig).toEqual({
        enabled: true,
        endpoint: '/mcp',
        stateful: false,
        sessionIdleTimeout: 300000,
        maxSessions: 100,
        resourceUrl: 'http://localhost:3002/mcp',
        scopes: ['mcp:use'],
        claudeClientId: '',
      });
    });
  });

  it('should use configured values when they exist', async (): Promise<void> => {
    jest.spyOn(config, 'has').mockImplementation((): boolean => true);
    jest.spyOn(config, 'get').mockImplementation((key: string): unknown => {
      if (key === 'McpServer.enabled') return false;
      if (key === 'McpServer.endpoint') return '/custom-mcp';
      return undefined;
    });

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { mcpServerConfig } = await import('@configs/mcp-server.config');
      expect(mcpServerConfig.enabled).toBe(false);
      expect(mcpServerConfig.endpoint).toBe('/custom-mcp');
    });
  });

  it('should read every configured value, including the OAuth resource and scopes', async (): Promise<void> => {
    const values: Record<string, unknown> = {
      'McpServer.enabled': true,
      'McpServer.endpoint': '/mcp',
      'McpServer.stateful': true,
      'McpServer.sessionIdleTimeout': 60000,
      'McpServer.maxSessions': 10,
      'McpServer.resourceUrl': 'https://api.omnipotent.io/mcp',
      'McpServer.scopes': ['mcp:use', 'mcp:admin'],
      'McpServer.claudeClientId': 'claude-app-1',
    };
    jest.spyOn(config, 'has').mockImplementation((): boolean => true);
    jest.spyOn(config, 'get').mockImplementation((key: string): unknown => values[key]);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { mcpServerConfig } = await import('@configs/mcp-server.config');
      expect(mcpServerConfig).toEqual({
        enabled: true,
        endpoint: '/mcp',
        stateful: true,
        sessionIdleTimeout: 60000,
        maxSessions: 10,
        resourceUrl: 'https://api.omnipotent.io/mcp',
        scopes: ['mcp:use', 'mcp:admin'],
        claudeClientId: 'claude-app-1',
      });
    });
  });
});
