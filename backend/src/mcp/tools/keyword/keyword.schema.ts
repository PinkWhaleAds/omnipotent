import { z } from 'zod';

import {
  addKeywordsBodySchema,
  addKeywordsResultSchema,
  keywordPageSchema,
  keywordRemovalSchema,
  keywordSchema,
  listKeywordsQuerySchema,
  organizationArgSchema,
  updateKeywordBodySchema,
} from '@src/types';

/** Argument naming the TargetingGroup the keywords hang from. */
const targetingGroupIdArg = z.uuid().describe('TargetingGroup id (from list-targeting-groups)');

/** Argument naming one keyword. */
const keywordIdArg = z.uuid().describe('Keyword id (from list-keywords)');

/** Input of `list-keywords`. */
export const listKeywordsInputSchema = listKeywordsQuerySchema.extend({
  organizationId: organizationArgSchema,
  targetingGroupId: targetingGroupIdArg,
});

/** TypeScript type inferred from {@link listKeywordsInputSchema}, after defaults apply. */
export type ListKeywordsInput = z.infer<typeof listKeywordsInputSchema>;

/** Input of `add-keywords`. */
export const addKeywordsInputSchema = addKeywordsBodySchema.extend({
  organizationId: organizationArgSchema,
  targetingGroupId: targetingGroupIdArg,
});

/** TypeScript type inferred from {@link addKeywordsInputSchema}, after defaults apply. */
export type AddKeywordsInput = z.infer<typeof addKeywordsInputSchema>;

/** Input of `update-keyword`. */
export const updateKeywordInputSchema = updateKeywordBodySchema.extend({
  organizationId: organizationArgSchema,
  keywordId: keywordIdArg,
});

/** TypeScript type inferred from {@link updateKeywordInputSchema}. */
export type UpdateKeywordInput = z.infer<typeof updateKeywordInputSchema>;

/** Input of `delete-keyword`. */
export const keywordInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  keywordId: keywordIdArg,
});

/** TypeScript type inferred from {@link keywordInputSchema}. */
export type KeywordInput = z.infer<typeof keywordInputSchema>;

/** MCP tool schema for `list-keywords`. */
export const listKeywordsSchema = {
  title: 'List the keywords of a TargetingGroup',
  description:
    'The keywords a TargetingGroup buys, and those it refuses: set negative to true for the negative ' +
    'ones only, false for the positive ones only. Requires the viewer role',
  inputSchema: listKeywordsInputSchema,
  outputSchema: keywordPageSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `add-keywords`. */
export const addKeywordsSchema = {
  title: 'Add keywords to a TargetingGroup',
  description:
    'Post keywords on a TargetingGroup: a text, a match type (broad, phrase or exact) and whether it is ' +
    'negative. Texts are lower-cased with single spaces, so the same word is never bought twice, and a ' +
    'keyword the node already carries is answered as it stands rather than refused. mode partial ' +
    'reports a refused text and keeps the others, atomic refuses the whole request. Only the search ' +
    'lever buys keywords. Requires the manager role',
  inputSchema: addKeywordsInputSchema,
  outputSchema: addKeywordsResultSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `update-keyword`. */
export const updateKeywordSchema = {
  title: 'Change a keyword',
  description:
    'Change the match type or the polarity of one keyword; its text does not change — remove it and ' +
    'post the other one. Requires the manager role',
  inputSchema: updateKeywordInputSchema,
  outputSchema: keywordSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `delete-keyword`. */
export const deleteKeywordSchema = {
  title: 'Remove a keyword',
  description:
    'Remove one keyword, for good: a keyword carries no history, so there is nothing to restore. ' +
    'Requires the manager role',
  inputSchema: keywordInputSchema,
  outputSchema: keywordRemovalSchema,
  annotations: { idempotentHint: true, destructiveHint: true },
};
