import { mcpToolRateLimiter } from '@src/mcp/tool-rate-limit';
import { McpToolResult, resolveOrganizationId, runTool } from '@src/mcp/tool-result';
import { KeywordService } from '@services';
import { McpContext } from '@src/types';
import { AddKeywordsInput, KeywordInput, ListKeywordsInput, UpdateKeywordInput } from './keyword.schema';

/**
 * Handler for `list-keywords`.
 *
 * @param service - Keyword service
 * @param context - MCP context of the call
 * @param args - Organization, TargetingGroup, page and polarity
 * @returns A page of keywords
 */
export async function listKeywords(
  service: KeywordService,
  context: McpContext,
  args: ListKeywordsInput
): Promise<McpToolResult> {
  const { organizationId, targetingGroupId, ...query } = args;
  return runTool(async () =>
    service.list(context.auth, resolveOrganizationId(context, organizationId), targetingGroupId, query)
  );
}

/**
 * Handler for `add-keywords`.
 *
 * Counted against the rate limit of the route it mirrors: five hundred keywords in one call is a bulk
 * by any other name.
 *
 * @param service - Keyword service
 * @param context - MCP context of the call
 * @param args - Organization, TargetingGroup, mode and keywords
 * @returns What the node now carries for each line sent, and what was refused
 */
export async function addKeywords(
  service: KeywordService,
  context: McpContext,
  args: AddKeywordsInput
): Promise<McpToolResult> {
  const { organizationId, targetingGroupId, ...body } = args;
  await mcpToolRateLimiter.consume(context, 'POST /targeting-groups/:id/keywords');
  return runTool(async () =>
    service.add(context.auth, resolveOrganizationId(context, organizationId), targetingGroupId, body)
  );
}

/**
 * Handler for `update-keyword`.
 *
 * @param service - Keyword service
 * @param context - MCP context of the call
 * @param args - Organization, keyword and what to change
 * @returns The keyword as it now stands
 */
export async function updateKeyword(
  service: KeywordService,
  context: McpContext,
  args: UpdateKeywordInput
): Promise<McpToolResult> {
  const { organizationId, keywordId, ...body } = args;
  return runTool(async () =>
    service.update(context.auth, resolveOrganizationId(context, organizationId), keywordId, body)
  );
}

/**
 * Handler for `delete-keyword`.
 *
 * @param service - Keyword service
 * @param context - MCP context of the call
 * @param args - Organization and keyword
 * @returns Its id, and that it is gone
 */
export async function deleteKeyword(
  service: KeywordService,
  context: McpContext,
  args: KeywordInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.remove(context.auth, resolveOrganizationId(context, args.organizationId), args.keywordId)
  );
}
