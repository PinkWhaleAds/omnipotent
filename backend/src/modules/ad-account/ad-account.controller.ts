import type { FastifyInstance } from 'fastify';

import {
  connectAdAccount,
  deleteAdAccountCredentials,
  disconnectAdAccount,
  getAdAccount,
  listPlatformCalls,
  linkAdvertiserAccount,
  listAdAccounts,
  listAdvertiserAccounts,
  restoreAdAccount,
  setAdAccountCredentials,
  setAdAccountStatus,
  unlinkAdvertiserAccount,
  updateAdAccount,
  updateAdvertiserAccount,
} from './ad-account.handler';
import {
  connectAdAccountSchema,
  deleteAdAccountCredentialsSchema,
  disconnectAdAccountSchema,
  getAdAccountSchema,
  listPlatformCallsSchema,
  linkAdvertiserAccountSchema,
  listAdAccountsSchema,
  listAdvertiserAccountsSchema,
  restoreAdAccountSchema,
  setAdAccountCredentialsSchema,
  setAdAccountStatusSchema,
  unlinkAdvertiserAccountSchema,
  updateAdAccountSchema,
  updateAdvertiserAccountSchema,
} from './ad-account.schema';

/**
 * Platform accounts controller: what carries the credentials, and which account a brand buys on.
 *
 * Wires URL → schema → handler. The accounts live at the Organization level, so they are flat; the
 * links hang from their Advertiser to be listed and created, and flat on themselves to be changed and
 * undone — the convention of the tree (`docs/phase-3.md` § 7).
 *
 * The two credential routes have **no MCP equivalent**, by design (`docs/phase-7.md` § 2).
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 */
export default async function AdAccountController(fastify: FastifyInstance): Promise<void> {
  fastify.route({ method: 'GET', url: '/ad-accounts', schema: listAdAccountsSchema, handler: listAdAccounts });
  fastify.route({ method: 'POST', url: '/ad-accounts', schema: connectAdAccountSchema, handler: connectAdAccount });
  fastify.route({ method: 'GET', url: '/ad-accounts/:id', schema: getAdAccountSchema, handler: getAdAccount });
  fastify.route({
    method: 'GET',
    url: '/ad-accounts/:id/platform-calls',
    schema: listPlatformCallsSchema,
    handler: listPlatformCalls,
  });
  fastify.route({
    method: 'PATCH',
    url: '/ad-accounts/:id',
    schema: updateAdAccountSchema,
    handler: updateAdAccount,
  });
  fastify.route({
    method: 'DELETE',
    url: '/ad-accounts/:id',
    schema: disconnectAdAccountSchema,
    handler: disconnectAdAccount,
  });
  fastify.route({
    method: 'POST',
    url: '/ad-accounts/:id/restore',
    schema: restoreAdAccountSchema,
    handler: restoreAdAccount,
  });
  fastify.route({
    method: 'PUT',
    url: '/ad-accounts/:id/status',
    schema: setAdAccountStatusSchema,
    handler: setAdAccountStatus,
  });
  fastify.route({
    method: 'PUT',
    url: '/ad-accounts/:id/credentials',
    schema: setAdAccountCredentialsSchema,
    handler: setAdAccountCredentials,
  });
  fastify.route({
    method: 'DELETE',
    url: '/ad-accounts/:id/credentials',
    schema: deleteAdAccountCredentialsSchema,
    handler: deleteAdAccountCredentials,
  });
  fastify.route({
    method: 'GET',
    url: '/advertisers/:id/ad-accounts',
    schema: listAdvertiserAccountsSchema,
    handler: listAdvertiserAccounts,
  });
  fastify.route({
    method: 'POST',
    url: '/advertisers/:id/ad-accounts',
    schema: linkAdvertiserAccountSchema,
    handler: linkAdvertiserAccount,
  });
  fastify.route({
    method: 'PATCH',
    url: '/advertiser-ad-accounts/:id',
    schema: updateAdvertiserAccountSchema,
    handler: updateAdvertiserAccount,
  });
  fastify.route({
    method: 'DELETE',
    url: '/advertiser-ad-accounts/:id',
    schema: unlinkAdvertiserAccountSchema,
    handler: unlinkAdvertiserAccount,
  });
}
