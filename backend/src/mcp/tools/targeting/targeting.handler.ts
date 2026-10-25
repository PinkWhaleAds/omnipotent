import { dimensionCatalog } from '@src/targeting/dimensions';
import { McpToolResult, resolveOrganizationId, runTool } from '@src/mcp/tool-result';
import { TargetingService } from '@services';
import { McpContext, Targeting, TargetingDimension } from '@src/types';

/**
 * Handler for `get-targeting-dimensions`.
 *
 * @param _context - MCP context of the call, which the registry does not need
 * @returns The registry, with the JSON schema of each dimension
 */
export async function getTargetingDimensions(_context: McpContext): Promise<McpToolResult> {
  return runTool(async () => Promise.resolve({ dimensions: dimensionCatalog() }));
}

/**
 * Handler for `get-targeting`.
 *
 * @param service - Targeting service
 * @param context - MCP context of the call
 * @param args - Organization and TargetingGroup
 * @returns Its targeting
 */
export async function getTargeting(
  service: TargetingService,
  context: McpContext,
  args: { organizationId?: string; targetingGroupId: string }
): Promise<McpToolResult> {
  return runTool(async () =>
    service.get(context.auth, resolveOrganizationId(context, args.organizationId), args.targetingGroupId)
  );
}

/**
 * Handler for `set-targeting`.
 *
 * @param service - Targeting service
 * @param context - MCP context of the call
 * @param args - Organization, TargetingGroup and the complete targeting
 * @returns Its targeting after the write
 */
export async function setTargeting(
  service: TargetingService,
  context: McpContext,
  args: { organizationId?: string; targetingGroupId: string; targeting: Targeting }
): Promise<McpToolResult> {
  return runTool(async () =>
    service.replace(
      context.auth,
      resolveOrganizationId(context, args.organizationId),
      args.targetingGroupId,
      args.targeting
    )
  );
}

/**
 * Handler for `set-targeting-dimension`.
 *
 * @param service - Targeting service
 * @param context - MCP context of the call
 * @param args - Organization, TargetingGroup, the dimension and its criteria
 * @returns Its targeting after the write
 */
export async function setTargetingDimension(
  service: TargetingService,
  context: McpContext,
  args: {
    organizationId?: string;
    targetingGroupId: string;
    dimension: TargetingDimension;
    criteria: Record<string, unknown>;
  }
): Promise<McpToolResult> {
  return runTool(async () =>
    service.setDimension(
      context.auth,
      resolveOrganizationId(context, args.organizationId),
      args.targetingGroupId,
      args.dimension,
      args.criteria
    )
  );
}

/**
 * Handler for `remove-targeting-dimension`.
 *
 * @param service - Targeting service
 * @param context - MCP context of the call
 * @param args - Organization, TargetingGroup and the dimension to drop
 * @returns Its targeting after the write
 */
export async function removeTargetingDimension(
  service: TargetingService,
  context: McpContext,
  args: { organizationId?: string; targetingGroupId: string; dimension: TargetingDimension }
): Promise<McpToolResult> {
  return runTool(async () =>
    service.removeDimension(
      context.auth,
      resolveOrganizationId(context, args.organizationId),
      args.targetingGroupId,
      args.dimension
    )
  );
}
