import type { FastifyInstance } from 'fastify';

import { getPreview, launchCampaign, setCampaignStatus, setNodeStatusOf } from './preview.handler';
import {
  getPreviewSchema,
  launchCampaignSchema,
  setCampaignStatusSchema,
  setNodeStatusSchemas,
} from './preview.schema';

/**
 * Preview and lifecycle controller: what will be created, and the passage from draft to live.
 *
 * Wires URL → schema → handler. The three routes hang from the campaign, which is the only level
 * that has a lifecycle (`../../CADRAGE.md` § 13).
 *
 * @param fastify - The Fastify instance to attach routes to
 * @returns A promise that resolves once routes are registered
 */
export default async function PreviewController(fastify: FastifyInstance): Promise<void> {
  fastify.route({ method: 'GET', url: '/campaigns/:id/preview', schema: getPreviewSchema, handler: getPreview });
  fastify.route({
    method: 'POST',
    url: '/campaigns/:id/launch',
    schema: launchCampaignSchema,
    handler: launchCampaign,
  });
  fastify.route({
    method: 'PUT',
    url: '/campaigns/:id/status',
    schema: setCampaignStatusSchema,
    handler: setCampaignStatus,
  });
  for (const [level, path] of [
    ['lever', 'levers'],
    ['ad_group', 'ad-groups'],
    ['targeting_group', 'targeting-groups'],
    ['line', 'lines'],
  ] as const) {
    fastify.route({
      method: 'PUT',
      url: `/${path}/:id/status`,
      schema: setNodeStatusSchemas[level],
      handler: setNodeStatusOf(level),
    });
  }
}
