import type { FastifySchema } from 'fastify';

import {
  campaignSchema,
  idParamSchema,
  NodeLevel,
  nodeStatusChangeSchema,
  organizationHeadersSchema,
  previewSchema,
  setCampaignStatusBodySchema,
  setNodeStatusBodySchema,
} from '@src/types';
import { errorResponses, toJsonSchema } from '@utils';

/** Tag grouping the lifecycle routes in Swagger. */
const TAGS: string[] = ['Preview and lifecycle'];

/** Headers of every route: they all act on one Organization. */
const headers: object = toJsonSchema(organizationHeadersSchema, 'input');

/** Params of a route naming one campaign. */
const params: object = toJsonSchema(idParamSchema, 'input');

/** Fastify schema for `GET /campaigns/:id/preview`. */
export const getPreviewSchema: FastifySchema = {
  tags: TAGS,
  description: [
    'What will be created on each platform, and what is wrong (viewer).',
    '',
    'Read-only and callable at any time, on a draft as on a live campaign. `errors` block the launch;',
    '`warnings` say something will be delivered short — a platform that cannot apply a targeting',
    'dimension still spends its share without it, and the warning names that amount.',
    '',
    'Each finding carries a stable code, its values, and the node it concerns.',
  ].join('\n'),
  headers,
  params,
  response: { 200: toJsonSchema(previewSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `POST /campaigns/:id/launch`. */
export const launchCampaignSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Launch a campaign: refused while the preview reports an error, and the only way out of draft — ' +
    'a campaign is not launched by writing a field (manager)',
  headers,
  params,
  response: { 200: toJsonSchema(campaignSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `PUT /campaigns/:id/status`. */
export const setCampaignStatusSchema: FastifySchema = {
  tags: TAGS,
  description:
    'Pause, resume, end or archive a campaign. The transitions are a table: active ↔ paused, both to ' +
    'ended, ended to archived. Anything else is refused (manager)',
  headers,
  params,
  body: toJsonSchema(setCampaignStatusBodySchema, 'input'),
  response: { 200: toJsonSchema(campaignSchema), ...errorResponses(400, 401, 403, 404) },
};

/**
 * Fastify schema for `PUT /<level>/:id/status`, one per level below the campaign.
 *
 * @param level - The level, as a sentence names it
 * @returns The schema
 */
function setNodeStatusSchemaOf(level: string): FastifySchema {
  return {
    tags: TAGS,
    description: [
      `Pause or activate one ${level} (manager).`,
      '',
      `A ${level} created in a launched campaign is born paused and reaches no platform until it is`,
      'activated here. Activating one is refused when its window has ended, and when the preview finds',
      'an error on it or under it: the refusal names the codes to fix. A node of an ended or archived',
      'campaign keeps its status.',
    ].join('\n'),
    headers,
    params,
    body: toJsonSchema(setNodeStatusBodySchema, 'input'),
    response: { 200: toJsonSchema(nodeStatusChangeSchema), ...errorResponses(400, 401, 403, 404) },
  };
}

/** Fastify schemas of the four `PUT /<level>/:id/status`. */
export const setNodeStatusSchemas: Readonly<Record<NodeLevel, FastifySchema>> = {
  lever: setNodeStatusSchemaOf('lever'),
  ad_group: setNodeStatusSchemaOf('AdGroup'),
  targeting_group: setNodeStatusSchemaOf('TargetingGroup'),
  line: setNodeStatusSchemaOf('Line'),
};
