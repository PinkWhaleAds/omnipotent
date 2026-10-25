import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpContext } from '@src/types';
import { addKeywords, deleteKeyword, listKeywords, updateKeyword } from './keyword.handler';
import { addKeywordsSchema, deleteKeywordSchema, listKeywordsSchema, updateKeywordSchema } from './keyword.schema';

/**
 * Keyword tools controller: one tool per route of the keywords (D21).
 *
 * Wires tool name → schema → handler. No business logic and no inline schemas.
 *
 * @param server - The MCP server to register tools on
 * @param fastify - The Fastify instance providing decorated services
 * @param context - Caller of the MCP request
 */
export default function KeywordToolsController(server: McpServer, fastify: FastifyInstance, context: McpContext): void {
  server.registerTool('list-keywords', listKeywordsSchema, async (args) =>
    listKeywords(fastify.keywordService, context, args)
  );
  server.registerTool('add-keywords', addKeywordsSchema, async (args) =>
    addKeywords(fastify.keywordService, context, args)
  );
  server.registerTool('update-keyword', updateKeywordSchema, async (args) =>
    updateKeyword(fastify.keywordService, context, args)
  );
  server.registerTool('delete-keyword', deleteKeywordSchema, async (args) =>
    deleteKeyword(fastify.keywordService, context, args)
  );
}
