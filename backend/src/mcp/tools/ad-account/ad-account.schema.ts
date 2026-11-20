import { z } from 'zod';

import {
  adAccountPageSchema,
  adAccountSchema,
  advertiserAdAccountListSchema,
  advertiserAdAccountSchema,
  connectAdAccountBodySchema,
  deletionResultSchema,
  linkAdvertiserAccountBodySchema,
  listAdAccountsQuerySchema,
  listPlatformCallsQuerySchema,
  organizationArgSchema,
  platformCallPageSchema,
  setAdAccountStatusBodySchema,
  updateAdAccountBodySchema,
  updateAdvertiserAccountBodySchema,
} from '@src/types';

/** Argument naming one platform account. */
const adAccountIdArg = z.uuid().describe('Platform account id (from list-ad-accounts)');

/** Argument naming the Advertiser a link belongs to. */
const advertiserIdArg = z.uuid().describe('Advertiser id (from list-advertisers)');

/** Argument naming one link between an Advertiser and an account. */
const linkIdArg = z.uuid().describe('Link id (from list-advertiser-ad-accounts)');

/** Input of `list-ad-accounts`. */
export const listAdAccountsInputSchema = listAdAccountsQuerySchema.extend({
  organizationId: organizationArgSchema,
});

/** TypeScript type inferred from {@link listAdAccountsInputSchema}, after defaults apply. */
export type ListAdAccountsInput = z.infer<typeof listAdAccountsInputSchema>;

/** Input of `get-ad-account`, `disconnect-ad-account` and `restore-ad-account`. */
export const adAccountInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  adAccountId: adAccountIdArg,
});

/** TypeScript type inferred from {@link adAccountInputSchema}. */
export type AdAccountInput = z.infer<typeof adAccountInputSchema>;

/** Input of `connect-ad-account`. */
export const connectAdAccountInputSchema = connectAdAccountBodySchema.extend({
  organizationId: organizationArgSchema,
});

/** TypeScript type inferred from {@link connectAdAccountInputSchema}. */
export type ConnectAdAccountInput = z.infer<typeof connectAdAccountInputSchema>;

/** Input of `update-ad-account`. */
export const updateAdAccountInputSchema = updateAdAccountBodySchema.extend({
  organizationId: organizationArgSchema,
  adAccountId: adAccountIdArg,
});

/** TypeScript type inferred from {@link updateAdAccountInputSchema}. */
export type UpdateAdAccountInput = z.infer<typeof updateAdAccountInputSchema>;

/** Input of `set-ad-account-status`. */
export const setAdAccountStatusInputSchema = setAdAccountStatusBodySchema.extend({
  organizationId: organizationArgSchema,
  adAccountId: adAccountIdArg,
});

/** TypeScript type inferred from {@link setAdAccountStatusInputSchema}. */
export type SetAdAccountStatusInput = z.infer<typeof setAdAccountStatusInputSchema>;

/** Input of `list-advertiser-ad-accounts`. */
export const listAdvertiserAccountsInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  advertiserId: advertiserIdArg,
});

/** TypeScript type inferred from {@link listAdvertiserAccountsInputSchema}. */
export type ListAdvertiserAccountsInput = z.infer<typeof listAdvertiserAccountsInputSchema>;

/** Input of `link-advertiser-ad-account`. */
export const linkAdvertiserAccountInputSchema = linkAdvertiserAccountBodySchema.extend({
  organizationId: organizationArgSchema,
  advertiserId: advertiserIdArg,
});

/** TypeScript type inferred from {@link linkAdvertiserAccountInputSchema}. */
export type LinkAdvertiserAccountInput = z.infer<typeof linkAdvertiserAccountInputSchema>;

/** Input of `update-advertiser-ad-account`. */
export const updateAdvertiserAccountInputSchema = updateAdvertiserAccountBodySchema.extend({
  organizationId: organizationArgSchema,
  linkId: linkIdArg,
});

/** TypeScript type inferred from {@link updateAdvertiserAccountInputSchema}. */
export type UpdateAdvertiserAccountInput = z.infer<typeof updateAdvertiserAccountInputSchema>;

/** Input of `unlink-advertiser-ad-account`. */
export const advertiserAccountInputSchema = z.strictObject({
  organizationId: organizationArgSchema,
  linkId: linkIdArg,
});

/** TypeScript type inferred from {@link advertiserAccountInputSchema}. */
export type AdvertiserAccountInput = z.infer<typeof advertiserAccountInputSchema>;

/** MCP tool schema for `list-ad-accounts`. */
export const listAdAccountsSchema = {
  title: 'List the platform accounts',
  description:
    'The platform accounts of an Organization, each with its platform, its identifier there, its ' +
    'currency, its timezone and where its access stands: pending while the client has not accepted, ' +
    'active once usable, invalid when it ended. hasCredentials says whether a secret is stored — its ' +
    'value is never readable, here or anywhere else. Requires the viewer role',
  inputSchema: listAdAccountsInputSchema,
  outputSchema: adAccountPageSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `get-ad-account`. */
export const getAdAccountSchema = {
  title: 'Get a platform account',
  description: 'One account, connected or disconnected, and whether it carries credentials. Requires the viewer role',
  inputSchema: adAccountInputSchema,
  outputSchema: adAccountSchema,
  annotations: { readOnlyHint: true },
};

/** Arguments of `list-platform-calls`. */
export const listPlatformCallsInputSchema = listPlatformCallsQuerySchema.extend({
  organizationId: organizationArgSchema,
  adAccountId: adAccountIdArg,
});

/** TypeScript type inferred from {@link listPlatformCallsInputSchema}. */
export type ListPlatformCallsInput = z.infer<typeof listPlatformCallsInputSchema>;

/** MCP tool schema for `list-platform-calls`. */
export const listPlatformCallsSchema = {
  title: 'List the calls made to a platform for an account',
  description:
    'The calls made to its platform for one account, oldest first: status, duration, the platform request id ' +
    'and what each cost against the quota — Google counts every operation of a change, which tells a change ' +
    'of one object from a change of the whole campaign. since reads from an instant (ISO 8601): what one ' +
    'synchronization sent. Requires the viewer role',
  inputSchema: listPlatformCallsInputSchema,
  outputSchema: platformCallPageSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `connect-ad-account`. */
export const connectAdAccountSchema = {
  title: 'Connect a platform account',
  description:
    'Connect an account of a platform to an Organization. On a platform whose accounts link to our ' +
    'manager account (Google Ads), give its reference alone — the Google customer id, dashes allowed: it ' +
    'is invited and arrives **pending** until an admin of the client accepts in Google Ads (Admin → ' +
    'Access and security → Managers), or **active** at once when our manager account already manages ' +
    'it, which only a super-admin or the Organization that held it last may take. Its name, currency ' +
    'and timezone are then read there: do not send them. On any other platform, send all three; it ' +
    'arrives pending. The currency never changes afterwards — another currency is another account — ' +
    'and the credentials are posted from the web interface or the HTTP API, never through a tool: never ' +
    'ask the user for a key or a token. Requires the admin role',
  inputSchema: connectAdAccountInputSchema,
  outputSchema: adAccountSchema,
  annotations: {},
};

/** MCP tool schema for `update-ad-account`. */
export const updateAdAccountSchema = {
  title: 'Change a platform account',
  description:
    'Change the name, the timezone or the scope of an account. Its platform, its identifier and its ' +
    'currency never change, and on an account linked to our manager account the name and the timezone ' +
    'are read from the platform: only the scope changes. Requires the admin role',
  inputSchema: updateAdAccountInputSchema,
  outputSchema: adAccountSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `set-ad-account-status`. */
export const setAdAccountStatusSchema = {
  title: 'Record where the access of an account stands',
  description:
    'Apply a transition: pending → active when the client accepted, pending → invalid on a refusal or ' +
    'an expiry, active → invalid on a revocation or rejected credentials, invalid → pending for a new ' +
    'request. Any other passage is refused. On an account linked to our manager account the status ' +
    'follows the platform, checked every fifteen minutes: only invalid → pending is asked, and it ' +
    'sends a new invitation. Requires the admin role',
  inputSchema: setAdAccountStatusInputSchema,
  outputSchema: adAccountSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `disconnect-ad-account`. */
export const disconnectAdAccountSchema = {
  title: 'Disconnect a platform account',
  description:
    'Disconnect an account; its secret is erased on the way out, and restoring it brings it back ' +
    'pending and without credentials. Requires the admin role',
  inputSchema: adAccountInputSchema,
  outputSchema: deletionResultSchema,
  annotations: { idempotentHint: true, destructiveHint: true },
};

/** MCP tool schema for `restore-ad-account`. */
export const restoreAdAccountSchema = {
  title: 'Reconnect a platform account',
  description: 'Bring a disconnected account back; it returns pending and without credentials. Requires the admin role',
  inputSchema: adAccountInputSchema,
  outputSchema: deletionResultSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `list-advertiser-ad-accounts`. */
export const listAdvertiserAccountsSchema = {
  title: 'List the accounts a brand buys on',
  description:
    'Which account each brand buys on, one per platform and per currency, with its identity on the ' +
    'platform (externalAdvertiserId). Requires the viewer role',
  inputSchema: listAdvertiserAccountsInputSchema,
  outputSchema: advertiserAdAccountListSchema,
  annotations: { readOnlyHint: true },
};

/** MCP tool schema for `link-advertiser-ad-account`. */
export const linkAdvertiserAccountSchema = {
  title: 'Link a brand to a platform account',
  description:
    'Give a brand the account it buys on, for the currency that account buys in, with its identity on ' +
    'the platform. One account per platform and per currency; an invalid account is refused. Requires ' +
    'the manager role',
  inputSchema: linkAdvertiserAccountInputSchema,
  outputSchema: advertiserAdAccountSchema,
  annotations: {},
};

/** MCP tool schema for `update-advertiser-ad-account`. */
export const updateAdvertiserAccountSchema = {
  title: 'Change the identity of a brand on a platform',
  description: 'Change the externalAdvertiserId of a link. Requires the manager role',
  inputSchema: updateAdvertiserAccountInputSchema,
  outputSchema: advertiserAdAccountSchema,
  annotations: { idempotentHint: true },
};

/** MCP tool schema for `unlink-advertiser-ad-account`. */
export const unlinkAdvertiserAccountSchema = {
  title: 'Undo the link between a brand and an account',
  description: 'Undo a link; the account itself stays connected. Requires the manager role',
  inputSchema: advertiserAccountInputSchema,
  outputSchema: deletionResultSchema,
  annotations: { idempotentHint: true, destructiveHint: true },
};
