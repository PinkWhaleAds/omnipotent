import { z } from 'zod';

import {
  conversionGoalPageSchema,
  conversionGoalSchema,
  createConversionGoalBodySchema,
  listConversionGoalsQuerySchema,
  organizationArgSchema,
  updateConversionGoalBodySchema,
} from '@src/types';

/** Argument naming the Advertiser whose goals are read or written. */
const advertiserIdArg = z.uuid().describe('Advertiser id (from list-advertisers)');

/** Argument naming one goal. */
const goalIdArg = z.uuid().describe('Conversion goal id (from list-conversion-goals)');

/** Input of `list-conversion-goals`. */
export const listConversionGoalsInputSchema = listConversionGoalsQuerySchema.extend({
  organizationId: organizationArgSchema,
  advertiserId: advertiserIdArg,
});

/** TypeScript type inferred from {@link listConversionGoalsInputSchema}, after defaults apply. */
export type ListConversionGoalsInput = z.infer<typeof listConversionGoalsInputSchema>;

/** Input of `get-conversion-goal`. */
export const conversionGoalInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  goalId: goalIdArg,
});

/** TypeScript type inferred from {@link conversionGoalInputSchema}. */
export type ConversionGoalInput = z.infer<typeof conversionGoalInputSchema>;

/** Input of `create-conversion-goal`. */
export const createConversionGoalInputSchema = createConversionGoalBodySchema.extend({
  organizationId: organizationArgSchema,
  advertiserId: advertiserIdArg,
});

/** TypeScript type inferred from {@link createConversionGoalInputSchema}, after defaults apply. */
export type CreateConversionGoalInput = z.infer<typeof createConversionGoalInputSchema>;

/** Input of `update-conversion-goal`. */
export const updateConversionGoalInputSchema = updateConversionGoalBodySchema.extend({
  organizationId: organizationArgSchema,
  goalId: goalIdArg,
});

/** TypeScript type inferred from {@link updateConversionGoalInputSchema}. */
export type UpdateConversionGoalInput = z.infer<typeof updateConversionGoalInputSchema>;

/** MCP tool schema for `list-conversion-goals`. */
export const listConversionGoalsSchema = {
  title: 'List the conversion goals of an Advertiser',
  description:
    'The conversion goals of an Advertiser, oldest first: what its site sends with ' +
    "msq('conversion', { goal: '<key>' }), with their value and counting. Archived ones are listed too, " +
    'unless status filters them. Requires the viewer role',
  inputSchema: listConversionGoalsInputSchema,
  outputSchema: conversionGoalPageSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `get-conversion-goal`. */
export const getConversionGoalSchema = {
  title: 'Get a conversion goal',
  description: 'One conversion goal. Requires the viewer role',
  inputSchema: conversionGoalInputSchema,
  outputSchema: conversionGoalSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `create-conversion-goal`. */
export const createConversionGoalSchema = {
  title: 'Create a conversion goal',
  description:
    "Give an Advertiser a conversion goal: what its site sends with msq('conversion', { goal: '<key>' }). " +
    'The key is lower case letters, digits, dashes and underscores, starting with a letter, 40 at most, ' +
    'and it never changes, nor does the category. A value (fixed, or dynamic with a fallback) needs a ' +
    'currency, and a fixed one an amount in cents (defaultValueCents). The goal is then set up on every ' +
    'account of the Advertiser: get-tracking says where it stands on each, and gives the one code to ' +
    'install on the site. An AdGroup bidding maximize_conversions names the goal it optimizes ' +
    '(conversionGoalId, update-ad-group). Requires the manager role',
  inputSchema: createConversionGoalInputSchema,
  outputSchema: conversionGoalSchema,
};

/** MCP tool schema for `update-conversion-goal`. */
export const updateConversionGoalSchema = {
  title: 'Change a conversion goal',
  description:
    'Change the name, the value, the counting or the status of a conversion goal; its key and its category ' +
    'never change. status archived stops measuring it — nothing is deleted at the platforms — and is ' +
    'refused while an AdGroup of a launched campaign optimizes it; active measures it again. Requires the ' +
    'manager role',
  inputSchema: updateConversionGoalInputSchema,
  outputSchema: conversionGoalSchema,
  annotations: { idempotentHint: true },
};
