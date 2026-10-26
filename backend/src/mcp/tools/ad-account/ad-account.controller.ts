import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpContext } from '@src/types';
import {
  connectAdAccount,
  disconnectAdAccount,
  getAdAccount,
  linkAdvertiserAccount,
  listAdAccounts,
  listAdvertiserAccounts,
  restoreAdAccount,
  setAdAccountStatus,
  unlinkAdvertiserAccount,
  updateAdAccount,
  updateAdvertiserAccount,
} from './ad-account.handler';
import {
  connectAdAccountSchema,
  disconnectAdAccountSchema,
  getAdAccountSchema,
  linkAdvertiserAccountSchema,
  listAdAccountsSchema,
  listAdvertiserAccountsSchema,
  restoreAdAccountSchema,
  setAdAccountStatusSchema,
  unlinkAdvertiserAccountSchema,
  updateAdAccountSchema,
  updateAdvertiserAccountSchema,
} from './ad-account.schema';

/**
 * Platform account tools controller: one tool per route — **except the credentials**.
 *
 * The two credential routes have no tool and never will: a secret must not pass through an assistant's
 * conversation (`../../CADRAGE.md` § 12, `docs/phase-7.md` § 2). A model that needs one tells the user
 * to post it from the web interface.
 *
 * @param server - The MCP server to register tools on
 * @param fastify - The Fastify instance providing decorated services
 * @param context - Caller of the MCP request
 */
export default function AdAccountToolsController(
  server: McpServer,
  fastify: FastifyInstance,
  context: McpContext
): void {
  server.registerTool('list-ad-accounts', listAdAccountsSchema, async (args) =>
    listAdAccounts(fastify.adAccountService, context, args)
  );
  server.registerTool('get-ad-account', getAdAccountSchema, async (args) =>
    getAdAccount(fastify.adAccountService, context, args)
  );
  server.registerTool('connect-ad-account', connectAdAccountSchema, async (args) =>
    connectAdAccount(fastify.adAccountService, context, args)
  );
  server.registerTool('update-ad-account', updateAdAccountSchema, async (args) =>
    updateAdAccount(fastify.adAccountService, context, args)
  );
  server.registerTool('set-ad-account-status', setAdAccountStatusSchema, async (args) =>
    setAdAccountStatus(fastify.adAccountService, context, args)
  );
  server.registerTool('disconnect-ad-account', disconnectAdAccountSchema, async (args) =>
    disconnectAdAccount(fastify.adAccountService, context, args)
  );
  server.registerTool('restore-ad-account', restoreAdAccountSchema, async (args) =>
    restoreAdAccount(fastify.adAccountService, context, args)
  );
  server.registerTool('list-advertiser-ad-accounts', listAdvertiserAccountsSchema, async (args) =>
    listAdvertiserAccounts(fastify.adAccountService, context, args)
  );
  server.registerTool('link-advertiser-ad-account', linkAdvertiserAccountSchema, async (args) =>
    linkAdvertiserAccount(fastify.adAccountService, context, args)
  );
  server.registerTool('update-advertiser-ad-account', updateAdvertiserAccountSchema, async (args) =>
    updateAdvertiserAccount(fastify.adAccountService, context, args)
  );
  server.registerTool('unlink-advertiser-ad-account', unlinkAdvertiserAccountSchema, async (args) =>
    unlinkAdvertiserAccount(fastify.adAccountService, context, args)
  );
}
