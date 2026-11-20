import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  ConnectAdAccountBody,
  IdParam,
  LinkAdvertiserAccountBody,
  ListAdAccountsQuery,
  ListPlatformCallsQuery,
  SetAdAccountCredentialsBody,
  SetAdAccountStatusBody,
  UpdateAdAccountBody,
  UpdateAdvertiserAccountBody,
} from '@src/types';
import { actorOf, organizationIdOf } from '@utils';

/**
 * Handler for `GET /ad-accounts`.
 *
 * @param request - The request, with the page, the platform and the state
 * @param reply - The reply, sent with a page of accounts
 * @returns A promise that resolves once the response has been sent
 */
export async function listAdAccounts(
  this: FastifyInstance,
  request: FastifyRequest<{ Querystring: ListAdAccountsQuery }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.adAccountService.list(actorOf(request), organizationIdOf(request), request.query));
}

/**
 * Handler for `POST /ad-accounts`.
 *
 * @param request - The request, with the account to connect
 * @param reply - The reply, sent with the connected account (201)
 * @returns A promise that resolves once the response has been sent
 */
export async function connectAdAccount(
  this: FastifyInstance,
  request: FastifyRequest<{ Body: ConnectAdAccountBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.code(201).send(await this.adAccountService.connect(actorOf(request), organizationIdOf(request), request.body));
}

/**
 * Handler for `GET /ad-accounts/:id`.
 *
 * @param request - The request, with the account id
 * @param reply - The reply, sent with the account
 * @returns A promise that resolves once the response has been sent
 */
export async function getAdAccount(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.adAccountService.get(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `GET /ad-accounts/:id/platform-calls`.
 *
 * @param this - The Fastify instance
 * @param request - The request
 * @param reply - The reply
 * @returns A promise that resolves once sent
 */
export async function listPlatformCalls(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Querystring: ListPlatformCallsQuery }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.adAccountService.calls(actorOf(request), organizationIdOf(request), request.params.id, request.query)
  );
}

/**
 * Handler for `PATCH /ad-accounts/:id`.
 *
 * @param request - The request, with the account id and the fields to change
 * @param reply - The reply, sent with the updated account
 * @returns A promise that resolves once the response has been sent
 */
export async function updateAdAccount(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: UpdateAdAccountBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.adAccountService.update(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `PUT /ad-accounts/:id/status`.
 *
 * @param request - The request, with the account id, where it goes and why
 * @param reply - The reply, sent with the account in its new state
 * @returns A promise that resolves once the response has been sent
 */
export async function setAdAccountStatus(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: SetAdAccountStatusBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.adAccountService.setStatus(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `PUT /ad-accounts/:id/credentials`.
 *
 * The secret is read from the body and handed to the service, which puts it in the store: it is
 * never logged, never answered and never stored in the database (`docs/phase-7.md` § 2).
 *
 * @param request - The request, with the account id and the secret
 * @param reply - The reply, sent with the account, now carrying credentials
 * @returns A promise that resolves once the response has been sent
 */
export async function setAdAccountCredentials(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: SetAdAccountCredentialsBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.adAccountService.setCredentials(
      actorOf(request),
      organizationIdOf(request),
      request.params.id,
      request.body
    )
  );
}

/**
 * Handler for `DELETE /ad-accounts/:id/credentials`.
 *
 * @param request - The request, with the account id
 * @param reply - The reply, sent with the account, carrying none
 * @returns A promise that resolves once the response has been sent
 */
export async function deleteAdAccountCredentials(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.adAccountService.deleteCredentials(actorOf(request), organizationIdOf(request), request.params.id)
  );
}

/**
 * Handler for `DELETE /ad-accounts/:id`.
 *
 * @param request - The request, with the account id
 * @param reply - The reply, sent with its id and when it was disconnected
 * @returns A promise that resolves once the response has been sent
 */
export async function disconnectAdAccount(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.adAccountService.disconnect(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `POST /ad-accounts/:id/restore`.
 *
 * @param request - The request, with the account id
 * @param reply - The reply, sent with its id and `deletedAt` back to `null`
 * @returns A promise that resolves once the response has been sent
 */
export async function restoreAdAccount(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.adAccountService.restore(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `GET /advertisers/:id/ad-accounts`.
 *
 * @param request - The request, with the Advertiser id
 * @param reply - The reply, sent with its links
 * @returns A promise that resolves once the response has been sent
 */
export async function listAdvertiserAccounts(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send({
    items: await this.adAccountService.listForAdvertiser(
      actorOf(request),
      organizationIdOf(request),
      request.params.id
    ),
  });
}

/**
 * Handler for `POST /advertisers/:id/ad-accounts`.
 *
 * @param request - The request, with the Advertiser id, the account and the identity on the platform
 * @param reply - The reply, sent with the link (201)
 * @returns A promise that resolves once the response has been sent
 */
export async function linkAdvertiserAccount(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: LinkAdvertiserAccountBody }>,
  reply: FastifyReply
): Promise<void> {
  reply
    .code(201)
    .send(
      await this.adAccountService.link(actorOf(request), organizationIdOf(request), request.params.id, request.body)
    );
}

/**
 * Handler for `PATCH /advertiser-ad-accounts/:id`.
 *
 * @param request - The request, with the link id and the new identity
 * @param reply - The reply, sent with the link
 * @returns A promise that resolves once the response has been sent
 */
export async function updateAdvertiserAccount(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam; Body: UpdateAdvertiserAccountBody }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(
    await this.adAccountService.updateLink(actorOf(request), organizationIdOf(request), request.params.id, request.body)
  );
}

/**
 * Handler for `DELETE /advertiser-ad-accounts/:id`.
 *
 * @param request - The request, with the link id
 * @param reply - The reply, sent with its id and when it was undone
 * @returns A promise that resolves once the response has been sent
 */
export async function unlinkAdvertiserAccount(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.adAccountService.unlink(actorOf(request), organizationIdOf(request), request.params.id));
}
