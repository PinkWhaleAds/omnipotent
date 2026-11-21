import { McpToolResult, resolveOrganizationId, runTool } from '@src/mcp/tool-result';
import type { ConversionGoalService } from '@src/services/conversion-goal.service';
import { McpContext } from '@src/types';
import {
  ConversionGoalInput,
  CreateConversionGoalInput,
  ListConversionGoalsInput,
  UpdateConversionGoalInput,
} from './conversion-goal.schema';

/**
 * Handler for `list-conversion-goals`.
 *
 * @param service - Conversion goal service
 * @param context - MCP context of the call
 * @param args - Organization, Advertiser, page and status
 * @returns A page of goals
 */
export async function listConversionGoals(
  service: ConversionGoalService,
  context: McpContext,
  args: ListConversionGoalsInput
): Promise<McpToolResult> {
  const { organizationId, advertiserId, ...query } = args;
  return runTool(async () =>
    service.list(context.auth, resolveOrganizationId(context, organizationId), advertiserId, query)
  );
}

/**
 * Handler for `get-conversion-goal`.
 *
 * @param service - Conversion goal service
 * @param context - MCP context of the call
 * @param args - Organization and goal
 * @returns The goal
 */
export async function getConversionGoal(
  service: ConversionGoalService,
  context: McpContext,
  args: ConversionGoalInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.get(context.auth, resolveOrganizationId(context, args.organizationId), args.goalId)
  );
}

/**
 * Handler for `create-conversion-goal`.
 *
 * @param service - Conversion goal service
 * @param context - MCP context of the call
 * @param args - Organization, Advertiser and the goal
 * @returns The goal
 */
export async function createConversionGoal(
  service: ConversionGoalService,
  context: McpContext,
  args: CreateConversionGoalInput
): Promise<McpToolResult> {
  const { organizationId, advertiserId, ...body } = args;
  return runTool(async () =>
    service.create(context.auth, resolveOrganizationId(context, organizationId), advertiserId, body)
  );
}

/**
 * Handler for `update-conversion-goal`.
 *
 * @param service - Conversion goal service
 * @param context - MCP context of the call
 * @param args - Organization, goal and the fields to change
 * @returns The goal
 */
export async function updateConversionGoal(
  service: ConversionGoalService,
  context: McpContext,
  args: UpdateConversionGoalInput
): Promise<McpToolResult> {
  const { organizationId, goalId, ...body } = args;
  return runTool(async () =>
    service.update(context.auth, resolveOrganizationId(context, organizationId), goalId, body)
  );
}
