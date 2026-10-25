import { z } from 'zod';

import { targetingObjectSchema } from '@src/targeting/dimensions';
import { leverSchema, organizationArgSchema, targetingCatalogSchema, targetingDimensionSchema } from '@src/types';

/** Argument naming the TargetingGroup a targeting belongs to. */
const targetingGroupIdArg = z.uuid().describe('TargetingGroup id (from list-targeting-groups)');

/** Argument naming one dimension of the registry. */
const dimensionArg = targetingDimensionSchema.describe('Targeting dimension (from get-targeting-dimensions)');

/** What a read or a write of a targeting answers, as the model reads it. */
const targetingResponseSchema = z.object({
  targetingGroupId: z.uuid(),
  lever: leverSchema,
  permittedDimensions: z.array(targetingDimensionSchema),
  targeting: targetingObjectSchema,
});

/** Input of `get-targeting-dimensions`: the registry is the same for everyone. */
export const targetingDimensionsInputSchema = z.strictObject({});

/** Input of `get-targeting`. */
export const targetingInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  targetingGroupId: targetingGroupIdArg,
});

/** Input of `set-targeting`. */
export const setTargetingInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  targetingGroupId: targetingGroupIdArg,
  targeting: targetingObjectSchema,
});

/** Input of `set-targeting-dimension`. */
export const setTargetingDimensionInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  targetingGroupId: targetingGroupIdArg,
  dimension: dimensionArg,
  criteria: z.record(z.string(), z.unknown()).describe('The criteria of that dimension, in its own shape'),
});

/** Input of `remove-targeting-dimension`. */
export const removeTargetingDimensionInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  targetingGroupId: targetingGroupIdArg,
  dimension: dimensionArg,
});

/** MCP tool schema for `get-targeting-dimensions`. */
export const getTargetingDimensionsSchema = {
  title: 'List the targeting dimensions',
  description:
    'Every dimension a TargetingGroup can be targeted on, with the JSON schema of its criteria: read ' +
    'it before composing a targeting rather than guessing a shape. family tells what to expect — an ' +
    'include/exclude pair, opaque platform ids, a reference to lists of the Organization, a numeric ' +
    'range, serving windows, or a shape of its own; listKind tells which kind of list a dimension expects',
  inputSchema: targetingDimensionsInputSchema,
  outputSchema: targetingCatalogSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `get-targeting`. */
export const getTargetingSchema = {
  title: 'Get the targeting of a TargetingGroup',
  description:
    'What a TargetingGroup targets today, and the dimensions its lever permits. All the targeting of a ' +
    'campaign lives on its TargetingGroups: an AdGroup and a Line carry none. Requires the viewer role',
  inputSchema: targetingInputSchema,
  outputSchema: targetingResponseSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `set-targeting`. */
export const setTargetingSchema = {
  title: 'Replace the targeting of a TargetingGroup',
  description:
    'Replace the whole targeting: what is sent is what it targets afterwards, so dropping a dimension ' +
    'is leaving it out, and an empty object restricts nothing. A dimension the lever has nothing to do ' +
    'with is refused. Requires the manager role',
  inputSchema: setTargetingInputSchema,
  outputSchema: targetingResponseSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `set-targeting-dimension`. */
export const setTargetingDimensionSchema = {
  title: 'Target one dimension',
  description:
    'Post the criteria of one dimension, leaving the others alone. Their shape is the one ' +
    'get-targeting-dimensions gives for that dimension; a key it does not declare is refused rather ' +
    'than dropped. Requires the manager role',
  inputSchema: setTargetingDimensionInputSchema,
  outputSchema: targetingResponseSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `remove-targeting-dimension`. */
export const removeTargetingDimensionSchema = {
  title: 'Stop targeting one dimension',
  description:
    'Drop one dimension from the targeting, so it no longer restricts anything. Dropping one the node ' +
    'does not carry changes nothing. Requires the manager role',
  inputSchema: removeTargetingDimensionInputSchema,
  outputSchema: targetingResponseSchema,
  annotations: { idempotentHint: true, destructiveHint: true },
};
