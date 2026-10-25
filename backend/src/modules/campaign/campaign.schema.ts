import type { FastifySchema } from 'fastify';

import {
  bulkCampaignResultSchema,
  bulkCreateCampaignsBodySchema,
  bulkDeletionResultSchema,
  bulkIdsBodySchema,
  bulkUpdateCampaignsBodySchema,
  campaignPageSchema,
  campaignSchema,
  createCampaignBodySchema,
  deletionResultSchema,
  idParamSchema,
  listCampaignsQuerySchema,
  organizationHeadersSchema,
  setLabelsBodySchema,
  updateCampaignBodySchema,
} from '@src/types';
import { errorResponses, toJsonSchema } from '@utils';

/** Tag grouping the Campaign routes in Swagger. */
const TAGS: string[] = ['Campaigns'];

/** Headers of every Campaign route: they all act on one Organization. */
const headers: object = toJsonSchema(organizationHeadersSchema, 'input');

/** Params of a route naming one resource, the Advertiser of a nested route included. */
const params: object = toJsonSchema(idParamSchema, 'input');

/** Fastify schema for `GET /advertisers/:id/campaigns`. */
export const listCampaignsSchema: FastifySchema = {
  tags: TAGS,
  description: 'List the Campaigns of an Advertiser, filtered by name and by Labels (viewer)',
  headers,
  params,
  querystring: toJsonSchema(listCampaignsQuerySchema, 'input'),
  response: { 200: toJsonSchema(campaignPageSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /advertisers/:id/campaigns`. */
export const createCampaignSchema: FastifySchema = {
  tags: TAGS,
  description: 'Create a Campaign under an Advertiser; its budget, its window and its currency are required (manager)',
  headers,
  params,
  body: toJsonSchema(createCampaignBodySchema, 'input'),
  response: { 201: toJsonSchema(campaignSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `GET /campaigns/:id`. */
export const getCampaignSchema: FastifySchema = {
  tags: TAGS,
  description: 'Get a Campaign, deleted or not, with its budget resolved (viewer)',
  headers,
  params,
  response: { 200: toJsonSchema(campaignSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PATCH /campaigns/:id`. */
export const updateCampaignSchema: FastifySchema = {
  tags: TAGS,
  description: 'Update a Campaign (manager); its status moves through preview and launch, not here',
  headers,
  params,
  body: toJsonSchema(updateCampaignBodySchema, 'input'),
  response: { 200: toJsonSchema(campaignSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `DELETE /campaigns/:id`. */
export const deleteCampaignSchema: FastifySchema = {
  tags: TAGS,
  description: 'Delete a Campaign and its whole subtree (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /campaigns/:id/restore`. */
export const restoreCampaignSchema: FastifySchema = {
  tags: TAGS,
  description: 'Restore a Campaign and the subtree its deletion took with it (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(deletionResultSchema), ...errorResponses(400, 401, 403, 404, 409) },
};

/** Fastify schema for `PUT /campaigns/:id/labels`. */
export const setCampaignLabelsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Post the complete set of Labels a Campaign carries, replacing what it had (manager)',
  headers,
  params,
  body: toJsonSchema(setLabelsBodySchema, 'input'),
  response: { 200: toJsonSchema(campaignSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /advertisers/:id/campaigns/bulk`. */
export const bulkCreateCampaignsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Create several Campaigns, all or nothing (atomic) or item by item (partial) (manager)',
  headers,
  params,
  body: toJsonSchema(bulkCreateCampaignsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkCampaignResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PATCH /campaigns/bulk`. */
export const bulkUpdateCampaignsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Update several Campaigns, all or nothing (atomic) or item by item (partial) (manager)',
  headers,
  body: toJsonSchema(bulkUpdateCampaignsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkCampaignResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `DELETE /campaigns/bulk`. */
export const bulkDeleteCampaignsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Delete several Campaigns with their subtrees, atomically or item by item (manager)',
  headers,
  body: toJsonSchema(bulkIdsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkDeletionResultSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /campaigns/bulk/restore`. */
export const bulkRestoreCampaignsSchema: FastifySchema = {
  tags: TAGS,
  description: 'Restore several Campaigns with their subtrees, atomically or item by item (manager)',
  headers,
  body: toJsonSchema(bulkIdsBodySchema, 'input'),
  response: { 200: toJsonSchema(bulkDeletionResultSchema), ...errorResponses(400, 401, 403, 404, 409) },
};
