import { z } from 'zod';

import {
  campaignLeverPageSchema,
  campaignLeverSchema,
  createLeverBodySchema,
  deletionResultSchema,
  listLeversQuerySchema,
  organizationArgSchema,
  setLabelsBodySchema,
  updateLeverBodySchema,
} from '@src/types';

/** Argument naming the Campaign a Lever belongs to. */
const campaignIdArg = z.uuid().describe('Campaign id (from list-campaigns)');

/** Argument naming a Lever. */
const leverIdArg = z.uuid().describe('Lever id (from list-levers)');

/** Input of `list-levers`. */
export const listLeversInputSchema = listLeversQuerySchema.extend({
  organizationId: organizationArgSchema,
  campaignId: campaignIdArg,
});

/** TypeScript type inferred from {@link listLeversInputSchema}, after defaults apply. */
export type ListLeversInput = z.infer<typeof listLeversInputSchema>;

/** Input of `get-lever`, `delete-lever` and `restore-lever`. */
export const leverInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  leverId: leverIdArg,
});

/** TypeScript type inferred from {@link leverInputSchema}. */
export type LeverInput = z.infer<typeof leverInputSchema>;

/** Input of `create-lever`. */
export const createLeverInputSchema = createLeverBodySchema.extend({
  organizationId: organizationArgSchema,
  campaignId: campaignIdArg,
});

/** TypeScript type inferred from {@link createLeverInputSchema}. */
export type CreateLeverInput = z.infer<typeof createLeverInputSchema>;

/** Input of `update-lever`. */
export const updateLeverInputSchema = updateLeverBodySchema.extend({
  organizationId: organizationArgSchema,
  leverId: leverIdArg,
});

/** TypeScript type inferred from {@link updateLeverInputSchema}. */
export type UpdateLeverInput = z.infer<typeof updateLeverInputSchema>;

/** Input of `set-lever-labels`. */
export const setLeverLabelsInputSchema = setLabelsBodySchema.extend({
  organizationId: organizationArgSchema,
  leverId: leverIdArg,
});

/** TypeScript type inferred from {@link setLeverLabelsInputSchema}. */
export type SetLeverLabelsInput = z.infer<typeof setLeverLabelsInputSchema>;

/** MCP tool schema for `list-levers`. */
export const listLeversSchema = {
  title: 'List levers',
  description:
    'List the levers of a lever, filtered by name (search) or by labels (labelIds); includeDeleted also lists the deleted ones',
  inputSchema: listLeversInputSchema,
  outputSchema: campaignLeverPageSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `get-lever`. */
export const getLeverSchema = {
  title: 'Get a lever',
  description:
    'Get one lever, deleted or not, with its budget: what it carries, what it may spend, and the split per platform',
  inputSchema: leverInputSchema,
  outputSchema: campaignLeverSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `create-lever`. */
export const createLeverSchema = {
  title: 'Create a lever',
  description:
    'Create a lever under a lever. Its budget (in integer cents), its window and its currency are required: the whole tree below divides that amount and runs in that window. It is born a draft, so nothing reaches a platform. Requires the manager role',
  inputSchema: createLeverInputSchema,
  outputSchema: campaignLeverSchema,
};

/** MCP tool schema for `update-lever`. */
export const updateLeverSchema = {
  title: 'Update a lever',
  description:
    'Change a lever; a field left out is left alone. Its status moves with the lifecycle, not here. Requires the manager role',
  inputSchema: updateLeverInputSchema,
  outputSchema: campaignLeverSchema,
};

/** MCP tool schema for `delete-lever`. */
export const deleteLeverSchema = {
  title: 'Delete a lever',
  description:
    'Delete a lever **and its whole subtree** — levers, ad groups, targeting groups and lines. restore-lever brings back exactly what this deletion took. Requires the manager role',
  inputSchema: leverInputSchema,
  outputSchema: deletionResultSchema,
  annotations: { destructiveHint: true },
};

/** MCP tool schema for `restore-lever`. */
export const restoreLeverSchema = {
  title: 'Restore a lever',
  description:
    'Restore a deleted lever and the subtree its deletion took with it; anything deleted before stays deleted. Requires the manager role',
  inputSchema: leverInputSchema,
  outputSchema: deletionResultSchema,
};

/** MCP tool schema for `set-lever-labels`. */
export const setLeverLabelsSchema = {
  title: 'Set the labels of a lever',
  description:
    'Post the complete set of labels a lever carries, replacing what it had (an empty list clears them). Requires the manager role',
  inputSchema: setLeverLabelsInputSchema,
  outputSchema: campaignLeverSchema,
  annotations: { idempotentHint: true },
};
