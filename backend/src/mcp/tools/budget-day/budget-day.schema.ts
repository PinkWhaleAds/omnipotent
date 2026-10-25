import { z } from 'zod';

import {
  applyBudgetPresetBodySchema,
  budgetCurveSchema,
  organizationArgSchema,
  pacingSchema,
  updateBudgetDaysBodySchema,
} from '@src/types';

/** Argument naming the node a curve belongs to, one per level, as the tools of phase 3 name it. */
const campaignIdArg = z.uuid().describe('Campaign id (from list-campaigns)');
const leverIdArg = z.uuid().describe('Lever id (from list-levers)');
const adGroupIdArg = z.uuid().describe('AdGroup id (from list-ad-groups)');
const targetingGroupIdArg = z.uuid().describe('TargetingGroup id (from list-targeting-groups)');
const lineIdArg = z.uuid().describe('Line id (from list-lines)');

/** Input of the three tools of a Campaign that only name it. */
export const campaignCurveInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  campaignId: campaignIdArg,
});

/** Input of `update-campaign-budget-days`. */
export const updateCampaignBudgetDaysInputSchema = updateBudgetDaysBodySchema.extend({
  organizationId: organizationArgSchema,
  campaignId: campaignIdArg,
});

/** Input of `apply-campaign-budget-preset`. */
export const applyCampaignBudgetPresetInputSchema = applyBudgetPresetBodySchema.extend({
  organizationId: organizationArgSchema,
  campaignId: campaignIdArg,
});

/** Input of the three tools of a lever that only name it. */
export const leverCurveInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  leverId: leverIdArg,
});

/** Input of `update-lever-budget-days`. */
export const updateLeverBudgetDaysInputSchema = updateBudgetDaysBodySchema.extend({
  organizationId: organizationArgSchema,
  leverId: leverIdArg,
});

/** Input of `apply-lever-budget-preset`. */
export const applyLeverBudgetPresetInputSchema = applyBudgetPresetBodySchema.extend({
  organizationId: organizationArgSchema,
  leverId: leverIdArg,
});

/** Input of the three tools of an AdGroup that only name it. */
export const adGroupCurveInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  adGroupId: adGroupIdArg,
});

/** Input of `update-ad-group-budget-days`. */
export const updateAdGroupBudgetDaysInputSchema = updateBudgetDaysBodySchema.extend({
  organizationId: organizationArgSchema,
  adGroupId: adGroupIdArg,
});

/** Input of `apply-ad-group-budget-preset`. */
export const applyAdGroupBudgetPresetInputSchema = applyBudgetPresetBodySchema.extend({
  organizationId: organizationArgSchema,
  adGroupId: adGroupIdArg,
});

/** Input of the three tools of a TargetingGroup that only name it. */
export const targetingGroupCurveInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  targetingGroupId: targetingGroupIdArg,
});

/** Input of `update-targeting-group-budget-days`. */
export const updateTargetingGroupBudgetDaysInputSchema = updateBudgetDaysBodySchema.extend({
  organizationId: organizationArgSchema,
  targetingGroupId: targetingGroupIdArg,
});

/** Input of `apply-targeting-group-budget-preset`. */
export const applyTargetingGroupBudgetPresetInputSchema = applyBudgetPresetBodySchema.extend({
  organizationId: organizationArgSchema,
  targetingGroupId: targetingGroupIdArg,
});

/** Input of the three tools of a Line that only name it. */
export const lineCurveInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  lineId: lineIdArg,
});

/** Input of `update-line-budget-days`. */
export const updateLineBudgetDaysInputSchema = updateBudgetDaysBodySchema.extend({
  organizationId: organizationArgSchema,
  lineId: lineIdArg,
});

/** Input of `apply-line-budget-preset`. */
export const applyLineBudgetPresetInputSchema = applyBudgetPresetBodySchema.extend({
  organizationId: organizationArgSchema,
  lineId: lineIdArg,
});

/** What a tool schema says, with the Zod types of its input and of its answer kept. */
type ToolSchema<Input extends z.ZodObject<z.ZodRawShape>, Output extends z.ZodType> = {
  /** Its title, as a client lists it. */
  title: string;
  /** What it does, and what role it needs. */
  description: string;
  /** What the model sends. */
  inputSchema: Input;
  /** What it answers, structured. */
  outputSchema: Output;
  /** What a client may assume of it. */
  annotations: { readOnlyHint?: boolean; idempotentHint?: boolean; destructiveHint?: boolean };
};

/** The inputs of the five tools one level serves on its curve. */
type CurveInputs<
  Node extends z.ZodObject<z.ZodRawShape>,
  Update extends z.ZodObject<z.ZodRawShape>,
  Preset extends z.ZodObject<z.ZodRawShape>,
> = {
  /** Input of `get-…-budget-days`, `reset-…-budget-days` and `get-…-pacing`. */
  node: Node;
  /** Input of `update-…-budget-days`. */
  update: Update;
  /** Input of `apply-…-budget-preset`. */
  preset: Preset;
};

/** The five tool schemas one level serves on its curve, each keeping the type of its input. */
type BudgetDayToolSchemas<
  Node extends z.ZodObject<z.ZodRawShape>,
  Update extends z.ZodObject<z.ZodRawShape>,
  Preset extends z.ZodObject<z.ZodRawShape>,
> = {
  /** MCP tool schema for `get-…-budget-days`. */
  get: ToolSchema<Node, typeof budgetCurveSchema>;
  /** MCP tool schema for `update-…-budget-days`. */
  update: ToolSchema<Update, typeof budgetCurveSchema>;
  /** MCP tool schema for `apply-…-budget-preset`. */
  preset: ToolSchema<Preset, typeof budgetCurveSchema>;
  /** MCP tool schema for `reset-…-budget-days`. */
  reset: ToolSchema<Node, typeof budgetCurveSchema>;
  /** MCP tool schema for `get-…-pacing`. */
  pacing: ToolSchema<Node, typeof pacingSchema>;
};

/**
 * The tool schemas of the five curve tools of one level.
 *
 * Built for each level rather than written five times: the curve is **one** resource over the five
 * levels — one table, one service — and only the name the model reads changes
 * (`docs/phase-4.md` § 1). The inputs stay level by level, so the model names an AdGroup with
 * `adGroupId`, exactly as the tools of phase 3 taught it, and the generics keep their types all the
 * way to the registration.
 *
 * @param name - The level as the model reads it, `campaign`, `AdGroup`…
 * @param inputs - The inputs of that level
 * @returns Its five tool schemas
 */
export function budgetDayToolSchemas<
  Node extends z.ZodObject<z.ZodRawShape>,
  Update extends z.ZodObject<z.ZodRawShape>,
  Preset extends z.ZodObject<z.ZodRawShape>,
>(name: string, inputs: CurveInputs<Node, Update, Preset>): BudgetDayToolSchemas<Node, Update, Preset> {
  return {
    get: {
      title: `Get the budget curve of a ${name}`,
      description:
        `Get the daily budget curve of a ${name}: its own, or the shape of its parent at its scale ` +
        '(source tells which). A day at 0 does not deliver, and the days add up exactly to the budget. ' +
        'Requires the viewer role',
      inputSchema: inputs.node,
      outputSchema: budgetCurveSchema,
      annotations: { readOnlyHint: true },
    },
    update: {
      title: `Edit the budget curve of a ${name}`,
      description:
        `Set the amount of some days of the curve of a ${name}, and lock the days that must not move. ` +
        'The days left free rebalance in the shape they had so the total stays the budget; a locked day ' +
        'and a day already past keep their amount. Requires the manager role',
      inputSchema: inputs.update,
      outputSchema: budgetCurveSchema,
      annotations: { idempotentHint: true },
    },
    preset: {
      title: `Shape the budget curve of a ${name}`,
      description:
        `Shape the curve of a ${name}: flat, weekend_boost (a weekend day weighs factor times a weekday), ` +
        'ramp_up (a climb over the first quarter of the period, then flat), or selected_days (only the ' +
        'weekdays named deliver). excludedDays names the days that must not deliver whatever the shape, ' +
        'as a holiday. Locked and past days keep their amount. Requires the manager role',
      inputSchema: inputs.preset,
      outputSchema: budgetCurveSchema,
      annotations: { idempotentHint: true },
    },
    reset: {
      title: `Reset the budget curve of a ${name}`,
      description:
        `Forget the curve of a ${name} and answer the flat one it now carries, clearing every lock. ` +
        'Requires the manager role',
      inputSchema: inputs.node,
      outputSchema: budgetCurveSchema,
      annotations: { idempotentHint: true, destructiveHint: true },
    },
    pacing: {
      title: `Get the pacing of a ${name}`,
      description:
        `What a ${name} is to spend today against what its curve planned: plannedCents on the whole ` +
        'period, plannedToDateCents before today, remainingCents left to spend, todayCents to spend ' +
        'today in the shape of the curve, and status (on_track, underspending, overspending, ' +
        'budget_reached). The spend is 0 until the reporting phase feeds it, so the answer is a plan. ' +
        'Requires the viewer role',
      inputSchema: inputs.node,
      outputSchema: pacingSchema,
      annotations: { readOnlyHint: true },
    },
  };
}

/** The tool schemas of the Campaign curve. */
export const campaignBudgetDaySchemas = budgetDayToolSchemas('campaign', {
  node: campaignCurveInputSchema,
  update: updateCampaignBudgetDaysInputSchema,
  preset: applyCampaignBudgetPresetInputSchema,
});

/** The tool schemas of the lever curve. */
export const leverBudgetDaySchemas = budgetDayToolSchemas('lever', {
  node: leverCurveInputSchema,
  update: updateLeverBudgetDaysInputSchema,
  preset: applyLeverBudgetPresetInputSchema,
});

/** The tool schemas of the AdGroup curve. */
export const adGroupBudgetDaySchemas = budgetDayToolSchemas('AdGroup', {
  node: adGroupCurveInputSchema,
  update: updateAdGroupBudgetDaysInputSchema,
  preset: applyAdGroupBudgetPresetInputSchema,
});

/** The tool schemas of the TargetingGroup curve. */
export const targetingGroupBudgetDaySchemas = budgetDayToolSchemas('TargetingGroup', {
  node: targetingGroupCurveInputSchema,
  update: updateTargetingGroupBudgetDaysInputSchema,
  preset: applyTargetingGroupBudgetPresetInputSchema,
});

/** The tool schemas of the Line curve. */
export const lineBudgetDaySchemas = budgetDayToolSchemas('Line', {
  node: lineCurveInputSchema,
  update: updateLineBudgetDaysInputSchema,
  preset: applyLineBudgetPresetInputSchema,
});
