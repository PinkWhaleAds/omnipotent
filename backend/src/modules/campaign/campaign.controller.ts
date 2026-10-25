import type { FastifyInstance } from 'fastify';

import {
  bulkCreateCampaigns,
  bulkDeleteCampaigns,
  bulkRestoreCampaigns,
  bulkUpdateCampaigns,
  createCampaign,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  restoreCampaign,
  setCampaignLabels,
  updateCampaign,
} from './campaign.handler';
import {
  bulkCreateCampaignsSchema,
  bulkDeleteCampaignsSchema,
  bulkRestoreCampaignsSchema,
  bulkUpdateCampaignsSchema,
  createCampaignSchema,
  deleteCampaignSchema,
  getCampaignSchema,
  listCampaignsSchema,
  restoreCampaignSchema,
  setCampaignLabelsSchema,
  updateCampaignSchema,
} from './campaign.schema';

/**
 * Campaigns controller: the root of the tree, under the Advertiser it runs for.
 *
 * Wires URL → schema → handler. Listing and creating live **under the parent**, reading, changing
 * and deleting live **flat** on the resource, since an id carries its own parents
 * (`docs/phase-3.md` § 7).
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 */
export default async function CampaignController(fastify: FastifyInstance): Promise<void> {
  fastify.route({
    method: 'GET',
    url: '/advertisers/:id/campaigns',
    schema: listCampaignsSchema,
    handler: listCampaigns,
  });
  fastify.route({
    method: 'POST',
    url: '/advertisers/:id/campaigns',
    schema: createCampaignSchema,
    handler: createCampaign,
  });
  fastify.route({
    method: 'POST',
    url: '/advertisers/:id/campaigns/bulk',
    schema: bulkCreateCampaignsSchema,
    handler: bulkCreateCampaigns,
  });
  fastify.route({
    method: 'PATCH',
    url: '/campaigns/bulk',
    schema: bulkUpdateCampaignsSchema,
    handler: bulkUpdateCampaigns,
  });
  fastify.route({
    method: 'DELETE',
    url: '/campaigns/bulk',
    schema: bulkDeleteCampaignsSchema,
    handler: bulkDeleteCampaigns,
  });
  fastify.route({
    method: 'POST',
    url: '/campaigns/bulk/restore',
    schema: bulkRestoreCampaignsSchema,
    handler: bulkRestoreCampaigns,
  });
  fastify.route({ method: 'GET', url: '/campaigns/:id', schema: getCampaignSchema, handler: getCampaign });
  fastify.route({ method: 'PATCH', url: '/campaigns/:id', schema: updateCampaignSchema, handler: updateCampaign });
  fastify.route({ method: 'DELETE', url: '/campaigns/:id', schema: deleteCampaignSchema, handler: deleteCampaign });
  fastify.route({
    method: 'POST',
    url: '/campaigns/:id/restore',
    schema: restoreCampaignSchema,
    handler: restoreCampaign,
  });
  fastify.route({
    method: 'PUT',
    url: '/campaigns/:id/labels',
    schema: setCampaignLabelsSchema,
    handler: setCampaignLabels,
  });
}
