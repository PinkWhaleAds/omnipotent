import { McpToolResult } from '@src/mcp/tool-result';
import { getStatus } from '@src/mcp/tools/status/status.handler';
import { StatusService } from '@services';

describe('Unit::Mcp::Tools::StatusHandler', () => {
  let statusService: StatusService;

  beforeEach((): void => {
    statusService = new StatusService();
  });

  describe('getStatus', () => {
    it('should return a single text content block', async (): Promise<void> => {
      const result: McpToolResult = await getStatus(statusService);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
    });

    it('should serialize the status payload as JSON', async (): Promise<void> => {
      const result: McpToolResult = await getStatus(statusService);

      const parsed: { app_name: string; app_version: string; timestamp: number } = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('app_name');
      expect(parsed).toHaveProperty('app_version');
      expect(parsed).toHaveProperty('timestamp');
      expect(typeof parsed.timestamp).toBe('number');
    });

    it('should return the payload as structured content, as its output schema requires', async (): Promise<void> => {
      const result: McpToolResult = await getStatus(statusService);

      expect(result.structuredContent).toEqual(JSON.parse(result.content[0].text));
    });
  });
});
