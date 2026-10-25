import { toolResult, McpToolResult } from '@src/mcp/tool-result';
import { StatusService } from '@services';
import { StatusResult } from '@src/types';

/**
 * Handler for the `get-status` MCP tool.
 *
 * Returns the same status payload as the HTTP route, as structured content
 * (required by its `outputSchema`) and as JSON text.
 *
 * @param statusService - The status service used to compute the payload
 * @returns The MCP tool result containing the status
 */
export async function getStatus(statusService: StatusService): Promise<McpToolResult> {
  const status: StatusResult = statusService.getStatus();
  return toolResult(status);
}
