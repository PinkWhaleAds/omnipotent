import { McpToolResult, resolveOrganizationId, runTool } from '@src/mcp/tool-result';
import { BudgetCurveService } from '@services';
import { ApplyBudgetPresetBody, McpContext, TreeLevel, UpdateBudgetDaysBody } from '@src/types';

/**
 * Handler for `get-<level>-budget-days`.
 *
 * The level and the node come from the controller, which is where the tool of that level is named:
 * the five levels share **one** service, whose methods take the level as an argument, so a handler
 * per level would be the same line five times (`docs/phase-4.md` § 1).
 *
 * @param service - Budget curve service
 * @param context - MCP context of the call
 * @param level - The level of the node
 * @param nodeId - The node, as its own argument named it
 * @param organizationId - Organization the model named, if it named one
 * @returns The curve of the node, its own or the one it inherits
 */
export async function getBudgetDays(
  service: BudgetCurveService,
  context: McpContext,
  level: TreeLevel,
  nodeId: string,
  organizationId?: string
): Promise<McpToolResult> {
  return runTool(async () => service.get(context.auth, resolveOrganizationId(context, organizationId), level, nodeId));
}

/**
 * Handler for `update-<level>-budget-days`.
 *
 * @param service - Budget curve service
 * @param context - MCP context of the call
 * @param level - The level of the node
 * @param nodeId - The node, as its own argument named it
 * @param body - The days to set and to lock
 * @param organizationId - Organization the model named, if it named one
 * @returns The curve after the edit, rebalanced
 */
export async function updateBudgetDays(
  service: BudgetCurveService,
  context: McpContext,
  level: TreeLevel,
  nodeId: string,
  body: UpdateBudgetDaysBody,
  organizationId?: string
): Promise<McpToolResult> {
  return runTool(async () =>
    service.update(context.auth, resolveOrganizationId(context, organizationId), level, nodeId, body)
  );
}

/**
 * Handler for `apply-<level>-budget-preset`.
 *
 * @param service - Budget curve service
 * @param context - MCP context of the call
 * @param level - The level of the node
 * @param nodeId - The node, as its own argument named it
 * @param body - The shape to apply, and the days that must not deliver
 * @param organizationId - Organization the model named, if it named one
 * @returns The curve in its new shape
 */
export async function applyBudgetPreset(
  service: BudgetCurveService,
  context: McpContext,
  level: TreeLevel,
  nodeId: string,
  body: ApplyBudgetPresetBody,
  organizationId?: string
): Promise<McpToolResult> {
  return runTool(async () =>
    service.applyPreset(context.auth, resolveOrganizationId(context, organizationId), level, nodeId, body)
  );
}

/**
 * Handler for `reset-<level>-budget-days`.
 *
 * @param service - Budget curve service
 * @param context - MCP context of the call
 * @param level - The level of the node
 * @param nodeId - The node, as its own argument named it
 * @param organizationId - Organization the model named, if it named one
 * @returns The flat curve the node now carries
 */
export async function resetBudgetDays(
  service: BudgetCurveService,
  context: McpContext,
  level: TreeLevel,
  nodeId: string,
  organizationId?: string
): Promise<McpToolResult> {
  return runTool(async () =>
    service.reset(context.auth, resolveOrganizationId(context, organizationId), level, nodeId)
  );
}

/**
 * Handler for `get-<level>-pacing`.
 *
 * @param service - Budget curve service
 * @param context - MCP context of the call
 * @param level - The level of the node
 * @param nodeId - The node, as its own argument named it
 * @param organizationId - Organization the model named, if it named one
 * @returns What the node is to spend today against its plan
 */
export async function getPacing(
  service: BudgetCurveService,
  context: McpContext,
  level: TreeLevel,
  nodeId: string,
  organizationId?: string
): Promise<McpToolResult> {
  return runTool(async () =>
    service.pacing(context.auth, resolveOrganizationId(context, organizationId), level, nodeId)
  );
}
