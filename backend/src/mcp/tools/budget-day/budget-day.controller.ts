import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpContext } from '@src/types';
import { applyBudgetPreset, getBudgetDays, getPacing, resetBudgetDays, updateBudgetDays } from './budget-day.handler';
import {
  adGroupBudgetDaySchemas,
  campaignBudgetDaySchemas,
  leverBudgetDaySchemas,
  lineBudgetDaySchemas,
  targetingGroupBudgetDaySchemas,
} from './budget-day.schema';

/**
 * Budget day tools controller: one tool per route of the curves and of the pacing (D21).
 *
 * Wires tool name → schema → handler, level by level: the tools are spelled out one by one because
 * each names its node with its own argument — `adGroupId` for an AdGroup, as the tools of phase 3
 * taught the model — while the five share one service.
 *
 * @param server - The MCP server to register tools on
 * @param fastify - The Fastify instance providing decorated services
 * @param context - Caller of the MCP request
 */
export default function BudgetDayToolsController(
  server: McpServer,
  fastify: FastifyInstance,
  context: McpContext
): void {
  server.registerTool(
    'get-campaign-budget-days',
    campaignBudgetDaySchemas.get,
    async ({ organizationId, campaignId }) =>
      getBudgetDays(fastify.budgetCurveService, context, 'campaign', campaignId, organizationId)
  );
  server.registerTool(
    'update-campaign-budget-days',
    campaignBudgetDaySchemas.update,
    async ({ organizationId, campaignId, ...body }) =>
      updateBudgetDays(fastify.budgetCurveService, context, 'campaign', campaignId, body, organizationId)
  );
  server.registerTool(
    'apply-campaign-budget-preset',
    campaignBudgetDaySchemas.preset,
    async ({ organizationId, campaignId, ...body }) =>
      applyBudgetPreset(fastify.budgetCurveService, context, 'campaign', campaignId, body, organizationId)
  );
  server.registerTool(
    'reset-campaign-budget-days',
    campaignBudgetDaySchemas.reset,
    async ({ organizationId, campaignId }) =>
      resetBudgetDays(fastify.budgetCurveService, context, 'campaign', campaignId, organizationId)
  );
  server.registerTool('get-campaign-pacing', campaignBudgetDaySchemas.pacing, async ({ organizationId, campaignId }) =>
    getPacing(fastify.budgetCurveService, context, 'campaign', campaignId, organizationId)
  );

  server.registerTool('get-lever-budget-days', leverBudgetDaySchemas.get, async ({ organizationId, leverId }) =>
    getBudgetDays(fastify.budgetCurveService, context, 'lever', leverId, organizationId)
  );
  server.registerTool(
    'update-lever-budget-days',
    leverBudgetDaySchemas.update,
    async ({ organizationId, leverId, ...body }) =>
      updateBudgetDays(fastify.budgetCurveService, context, 'lever', leverId, body, organizationId)
  );
  server.registerTool(
    'apply-lever-budget-preset',
    leverBudgetDaySchemas.preset,
    async ({ organizationId, leverId, ...body }) =>
      applyBudgetPreset(fastify.budgetCurveService, context, 'lever', leverId, body, organizationId)
  );
  server.registerTool('reset-lever-budget-days', leverBudgetDaySchemas.reset, async ({ organizationId, leverId }) =>
    resetBudgetDays(fastify.budgetCurveService, context, 'lever', leverId, organizationId)
  );
  server.registerTool('get-lever-pacing', leverBudgetDaySchemas.pacing, async ({ organizationId, leverId }) =>
    getPacing(fastify.budgetCurveService, context, 'lever', leverId, organizationId)
  );

  server.registerTool('get-ad-group-budget-days', adGroupBudgetDaySchemas.get, async ({ organizationId, adGroupId }) =>
    getBudgetDays(fastify.budgetCurveService, context, 'ad_group', adGroupId, organizationId)
  );
  server.registerTool(
    'update-ad-group-budget-days',
    adGroupBudgetDaySchemas.update,
    async ({ organizationId, adGroupId, ...body }) =>
      updateBudgetDays(fastify.budgetCurveService, context, 'ad_group', adGroupId, body, organizationId)
  );
  server.registerTool(
    'apply-ad-group-budget-preset',
    adGroupBudgetDaySchemas.preset,
    async ({ organizationId, adGroupId, ...body }) =>
      applyBudgetPreset(fastify.budgetCurveService, context, 'ad_group', adGroupId, body, organizationId)
  );
  server.registerTool(
    'reset-ad-group-budget-days',
    adGroupBudgetDaySchemas.reset,
    async ({ organizationId, adGroupId }) =>
      resetBudgetDays(fastify.budgetCurveService, context, 'ad_group', adGroupId, organizationId)
  );
  server.registerTool('get-ad-group-pacing', adGroupBudgetDaySchemas.pacing, async ({ organizationId, adGroupId }) =>
    getPacing(fastify.budgetCurveService, context, 'ad_group', adGroupId, organizationId)
  );

  server.registerTool(
    'get-targeting-group-budget-days',
    targetingGroupBudgetDaySchemas.get,
    async ({ organizationId, targetingGroupId }) =>
      getBudgetDays(fastify.budgetCurveService, context, 'targeting_group', targetingGroupId, organizationId)
  );
  server.registerTool(
    'update-targeting-group-budget-days',
    targetingGroupBudgetDaySchemas.update,
    async ({ organizationId, targetingGroupId, ...body }) =>
      updateBudgetDays(fastify.budgetCurveService, context, 'targeting_group', targetingGroupId, body, organizationId)
  );
  server.registerTool(
    'apply-targeting-group-budget-preset',
    targetingGroupBudgetDaySchemas.preset,
    async ({ organizationId, targetingGroupId, ...body }) =>
      applyBudgetPreset(fastify.budgetCurveService, context, 'targeting_group', targetingGroupId, body, organizationId)
  );
  server.registerTool(
    'reset-targeting-group-budget-days',
    targetingGroupBudgetDaySchemas.reset,
    async ({ organizationId, targetingGroupId }) =>
      resetBudgetDays(fastify.budgetCurveService, context, 'targeting_group', targetingGroupId, organizationId)
  );
  server.registerTool(
    'get-targeting-group-pacing',
    targetingGroupBudgetDaySchemas.pacing,
    async ({ organizationId, targetingGroupId }) =>
      getPacing(fastify.budgetCurveService, context, 'targeting_group', targetingGroupId, organizationId)
  );

  server.registerTool('get-line-budget-days', lineBudgetDaySchemas.get, async ({ organizationId, lineId }) =>
    getBudgetDays(fastify.budgetCurveService, context, 'line', lineId, organizationId)
  );
  server.registerTool(
    'update-line-budget-days',
    lineBudgetDaySchemas.update,
    async ({ organizationId, lineId, ...body }) =>
      updateBudgetDays(fastify.budgetCurveService, context, 'line', lineId, body, organizationId)
  );
  server.registerTool(
    'apply-line-budget-preset',
    lineBudgetDaySchemas.preset,
    async ({ organizationId, lineId, ...body }) =>
      applyBudgetPreset(fastify.budgetCurveService, context, 'line', lineId, body, organizationId)
  );
  server.registerTool('reset-line-budget-days', lineBudgetDaySchemas.reset, async ({ organizationId, lineId }) =>
    resetBudgetDays(fastify.budgetCurveService, context, 'line', lineId, organizationId)
  );
  server.registerTool('get-line-pacing', lineBudgetDaySchemas.pacing, async ({ organizationId, lineId }) =>
    getPacing(fastify.budgetCurveService, context, 'line', lineId, organizationId)
  );
}
