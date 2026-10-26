import { McpToolResult, resolveOrganizationId, runTool } from '@src/mcp/tool-result';
import { AdAccountService } from '@services';
import { McpContext } from '@src/types';
import {
  AdAccountInput,
  AdvertiserAccountInput,
  ConnectAdAccountInput,
  LinkAdvertiserAccountInput,
  ListAdAccountsInput,
  ListAdvertiserAccountsInput,
  SetAdAccountStatusInput,
  UpdateAdAccountInput,
  UpdateAdvertiserAccountInput,
} from './ad-account.schema';

/**
 * Handler for `list-ad-accounts`.
 *
 * @param service - Platform account service
 * @param context - MCP context of the call
 * @param args - Organization, page, platform and state
 * @returns A page of accounts
 */
export async function listAdAccounts(
  service: AdAccountService,
  context: McpContext,
  args: ListAdAccountsInput
): Promise<McpToolResult> {
  const { organizationId, ...query } = args;
  return runTool(async () => service.list(context.auth, resolveOrganizationId(context, organizationId), query));
}

/**
 * Handler for `get-ad-account`.
 *
 * @param service - Platform account service
 * @param context - MCP context of the call
 * @param args - Organization and account
 * @returns The account
 */
export async function getAdAccount(
  service: AdAccountService,
  context: McpContext,
  args: AdAccountInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.get(context.auth, resolveOrganizationId(context, args.organizationId), args.adAccountId)
  );
}

/**
 * Handler for `connect-ad-account`.
 *
 * @param service - Platform account service
 * @param context - MCP context of the call
 * @param args - Organization, and what the platform needs to name the account
 * @returns The connected account, pending
 */
export async function connectAdAccount(
  service: AdAccountService,
  context: McpContext,
  args: ConnectAdAccountInput
): Promise<McpToolResult> {
  const { organizationId, ...body } = args;
  return runTool(async () => service.connect(context.auth, resolveOrganizationId(context, organizationId), body));
}

/**
 * Handler for `update-ad-account`.
 *
 * @param service - Platform account service
 * @param context - MCP context of the call
 * @param args - Organization, account and what to change
 * @returns The updated account
 */
export async function updateAdAccount(
  service: AdAccountService,
  context: McpContext,
  args: UpdateAdAccountInput
): Promise<McpToolResult> {
  const { organizationId, adAccountId, ...body } = args;
  return runTool(async () =>
    service.update(context.auth, resolveOrganizationId(context, organizationId), adAccountId, body)
  );
}

/**
 * Handler for `set-ad-account-status`.
 *
 * @param service - Platform account service
 * @param context - MCP context of the call
 * @param args - Organization, account, where it goes and why
 * @returns The account in its new state
 */
export async function setAdAccountStatus(
  service: AdAccountService,
  context: McpContext,
  args: SetAdAccountStatusInput
): Promise<McpToolResult> {
  const { organizationId, adAccountId, ...body } = args;
  return runTool(async () =>
    service.setStatus(context.auth, resolveOrganizationId(context, organizationId), adAccountId, body)
  );
}

/**
 * Handler for `disconnect-ad-account`.
 *
 * @param service - Platform account service
 * @param context - MCP context of the call
 * @param args - Organization and account
 * @returns Its id and when it was disconnected
 */
export async function disconnectAdAccount(
  service: AdAccountService,
  context: McpContext,
  args: AdAccountInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.disconnect(context.auth, resolveOrganizationId(context, args.organizationId), args.adAccountId)
  );
}

/**
 * Handler for `restore-ad-account`.
 *
 * @param service - Platform account service
 * @param context - MCP context of the call
 * @param args - Organization and account
 * @returns Its id, with `deletedAt` back to `null`
 */
export async function restoreAdAccount(
  service: AdAccountService,
  context: McpContext,
  args: AdAccountInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.restore(context.auth, resolveOrganizationId(context, args.organizationId), args.adAccountId)
  );
}

/**
 * Handler for `list-advertiser-ad-accounts`.
 *
 * @param service - Platform account service
 * @param context - MCP context of the call
 * @param args - Organization and Advertiser
 * @returns Its links
 */
export async function listAdvertiserAccounts(
  service: AdAccountService,
  context: McpContext,
  args: ListAdvertiserAccountsInput
): Promise<McpToolResult> {
  return runTool(async () => ({
    items: await service.listForAdvertiser(
      context.auth,
      resolveOrganizationId(context, args.organizationId),
      args.advertiserId
    ),
  }));
}

/**
 * Handler for `link-advertiser-ad-account`.
 *
 * @param service - Platform account service
 * @param context - MCP context of the call
 * @param args - Organization, Advertiser, the account and the identity on the platform
 * @returns The link
 */
export async function linkAdvertiserAccount(
  service: AdAccountService,
  context: McpContext,
  args: LinkAdvertiserAccountInput
): Promise<McpToolResult> {
  const { organizationId, advertiserId, ...body } = args;
  return runTool(async () =>
    service.link(context.auth, resolveOrganizationId(context, organizationId), advertiserId, body)
  );
}

/**
 * Handler for `update-advertiser-ad-account`.
 *
 * @param service - Platform account service
 * @param context - MCP context of the call
 * @param args - Organization, link and the new identity
 * @returns The link
 */
export async function updateAdvertiserAccount(
  service: AdAccountService,
  context: McpContext,
  args: UpdateAdvertiserAccountInput
): Promise<McpToolResult> {
  const { organizationId, linkId, ...body } = args;
  return runTool(async () =>
    service.updateLink(context.auth, resolveOrganizationId(context, organizationId), linkId, body)
  );
}

/**
 * Handler for `unlink-advertiser-ad-account`.
 *
 * @param service - Platform account service
 * @param context - MCP context of the call
 * @param args - Organization and link
 * @returns Its id and when it was undone
 */
export async function unlinkAdvertiserAccount(
  service: AdAccountService,
  context: McpContext,
  args: AdvertiserAccountInput
): Promise<McpToolResult> {
  return runTool(async () =>
    service.unlink(context.auth, resolveOrganizationId(context, args.organizationId), args.linkId)
  );
}
