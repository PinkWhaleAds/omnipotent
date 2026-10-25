import type { McpContext } from '@src/types/mcp.types';
import { httpError, LoggerBuilder, Logger, statusCodeOf } from '@utils';

/**
 * Result returned by every MCP tool handler of this codebase.
 *
 * A success carries the payload twice, as the MCP specification recommends:
 * as `structuredContent` (validated against the tool's `outputSchema`) and as
 * JSON text for clients that only read `content`. A failure sets `isError` so
 * the model sees the message and can react, instead of a protocol error.
 */
export type McpToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/** Message returned for an unexpected failure; the details only go to the logs. */
const INTERNAL_ERROR_MESSAGE = 'Internal error, please retry later';

/** @internal Logger for unexpected tool failures. */
const logger: Logger = LoggerBuilder.getChildLogger('McpTools');

/**
 * Wrap a payload into a successful tool result.
 *
 * @param data - The payload; it must match the tool's `outputSchema`
 * @returns The tool result
 *
 * @example
 * ```typescript
 * return toolResult(await service.get(context.auth, id));
 * ```
 */
export function toolResult(data: object): McpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

/**
 * Run a tool body and turn its outcome into a tool result.
 *
 * Business errors (4xx, e.g. "Organization not found", "requires the manager
 * role") reach the model as they are; anything else is logged and reported as
 * an opaque internal error, like a 5xx on the HTTP side.
 *
 * @param body - The tool logic, resolving with the payload
 * @returns The tool result
 *
 * @example
 * ```typescript
 * export async function getSeat(service: SeatService, context: McpContext, args: { seatId: string }) {
 *   return runTool(() => service.get(context.auth, args.seatId));
 * }
 * ```
 */
export async function runTool(body: () => Promise<object>): Promise<McpToolResult> {
  try {
    return toolResult(await body());
  } catch (error: unknown) {
    const statusCode: number | undefined = statusCodeOf(error);
    if (statusCode !== undefined && statusCode < 500) {
      return { content: [{ type: 'text', text: (error as Error).message }], isError: true };
    }
    logger.error('An MCP tool failed unexpectedly', { code: 'MCP::TOOL_FAILED', error });
    return { content: [{ type: 'text', text: INTERNAL_ERROR_MESSAGE }], isError: true };
  }
}

/**
 * The Organization an org-scoped tool acts on.
 *
 * @param context - The MCP context of the call
 * @param organizationId - The `organizationId` argument, if given
 * @returns The argument, else the connection's `X-Organization-Id`
 * @throws Error with status 400 when neither is set
 */
export function resolveOrganizationId(context: McpContext, organizationId?: string): string {
  const resolved: string | undefined = organizationId ?? context.organizationId;
  if (!resolved) {
    throw httpError(400, 'organizationId is required: call list-organizations and pass one of their ids', {
      code: 'organization_id_required',
    });
  }
  return resolved;
}
