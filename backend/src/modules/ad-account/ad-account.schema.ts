import type { FastifySchema } from 'fastify';

import {
  adAccountPageSchema,
  adAccountSchema,
  advertiserAdAccountListSchema,
  advertiserAdAccountSchema,
  connectAdAccountBodySchema,
  deletionResultSchema,
  idParamSchema,
  linkAdvertiserAccountBodySchema,
  listAdAccountsQuerySchema,
  organizationHeadersSchema,
  setAdAccountCredentialsBodySchema,
  setAdAccountStatusBodySchema,
  updateAdAccountBodySchema,
  updateAdvertiserAccountBodySchema,
} from '@src/types';
import { errorResponses, toJsonSchema } from '@utils';

/** Tag grouping the platform account routes in Swagger. */
const TAGS: string[] = ['Platform accounts'];

/** Headers of every route: they all act on one Organization. */
const headers: object = toJsonSchema(organizationHeadersSchema, 'input');

/** Params of a route naming one resource, the Advertiser of a nested route included. */
const params: object = toJsonSchema(idParamSchema, 'input');

/** Fastify schema for `GET /ad-accounts`. */
export const listAdAccountsSchema: FastifySchema = {
  tags: TAGS,
  description: 'List the platform accounts of an Organization, filtered by platform, state and name (viewer)',
  headers,
  querystring: toJsonSchema(listAdAccountsQuerySchema, 'input'),
  response: { 200: toJsonSchema(adAccountPageSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /ad-accounts`. */
export const connectAdAccountSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Connect a platform account. It arrives **pending**: most platforms ask the client to accept the ' +
    'access, and PUT /ad-accounts/:id/status records their answer. Its currency never changes (admin)',
  headers,
  body: toJsonSchema(connectAdAccountBodySchema, 'input'),
  response: { 201: toJsonSchema(adAccountSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `GET /ad-accounts/:id`. */
export const getAdAccountSchema: FastifySchema = {
  tags: TAGS,
  description: 'Get one account and whether it carries credentials; their value is never answered (viewer)',
  headers,
  params,
  response: { 200: toJsonSchema(adAccountSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PATCH /ad-accounts/:id`. */
export const updateAdAccountSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Update the name, the timezone or the scope of an account. Its platform, its identifier and its ' +
    'currency never change — another currency is another account (admin)',
  headers,
  params,
  body: toJsonSchema(updateAdAccountBodySchema, 'input'),
  response: { 200: toJsonSchema(adAccountSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PUT /ad-accounts/:id/status`. */
export const setAdAccountStatusSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Apply a transition of the lifecycle: pending → active or invalid, active → invalid, invalid → ' +
    'pending for a new request. Anything else is refused rather than silently stored (admin)',
  headers,
  params,
  body: toJsonSchema(setAdAccountStatusBodySchema, 'input'),
  response: { 200: toJsonSchema(adAccountSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PUT /ad-accounts/:id/credentials`. */
export const setAdAccountCredentialsSchema: FastifySchema = {
  tags: TAGS,
  description: [
    'Store the credentials of an account (admin).',
    '',
    'The **only** route a secret enters, and it leaves no trace: the value goes to AWS Secrets Manager,',
    'the database keeps its name alone, and the answer only says `hasCredentials`. There is no route,',
    'no field and **no MCP tool** that reads it back.',
  ].join('\n'),
  headers,
  params,
  body: toJsonSchema(setAdAccountCredentialsBodySchema, 'input'),
  response: { 200: toJsonSchema(adAccountSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `DELETE /ad-accounts/:id/credentials`. */
export const deleteAdAccountCredentialsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Erase the credentials of an account, in the store as in the database (admin)',
  headers,
  params,
  response: { 200: toJsonSchema(adAccountSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `DELETE /ad-accounts/:id`. */
export const disconnectAdAccountSchema: FastifySchema = {
  tags: TAGS,
  description: 'Disconnect an account; its secret is erased on the way out (admin)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /ad-accounts/:id/restore`. */
export const restoreAdAccountSchema: FastifySchema = {
  tags: TAGS,
  description: 'Reconnect a disconnected account; it comes back pending and without credentials (admin)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `GET /advertisers/:id/ad-accounts`. */
export const listAdvertiserAccountsSchema: FastifySchema = {
  tags: TAGS,
  description: 'The accounts a brand buys on, one per platform and per currency (viewer)',
  headers,
  params,
  response: { 200: toJsonSchema(advertiserAdAccountListSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /advertisers/:id/ad-accounts`. */
export const linkAdvertiserAccountSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Link a brand to a connected account, for the currency that account buys in, with the brand’s ' +
    'identity on the platform. Refused on an invalid account (manager)',
  headers,
  params,
  body: toJsonSchema(linkAdvertiserAccountBodySchema, 'input'),
  response: { 201: toJsonSchema(advertiserAdAccountSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `PATCH /advertiser-ad-accounts/:id`. */
export const updateAdvertiserAccountSchema: FastifySchema = {
  tags: TAGS,
  description: 'Change the identity a brand has on a platform (manager)',
  headers,
  params,
  body: toJsonSchema(updateAdvertiserAccountBodySchema, 'input'),
  response: { 200: toJsonSchema(advertiserAdAccountSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `DELETE /advertiser-ad-accounts/:id`. */
export const unlinkAdvertiserAccountSchema: FastifySchema = {
  tags: TAGS,
  description: 'Undo a link; the account itself stays connected (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404) },
};
