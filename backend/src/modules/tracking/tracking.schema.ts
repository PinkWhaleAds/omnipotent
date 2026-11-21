import type { FastifySchema } from 'fastify';
import { z } from 'zod';

import {
  advertiserTrackingSchema,
  idParamSchema,
  organizationHeadersSchema,
  trackingScriptParamsSchema,
} from '@src/types';
import { errorResponses, toJsonSchema } from '@utils';

/** Tag grouping the tracking routes in Swagger. */
const TAGS: string[] = ['Conversions'];

/** Fastify schema for `GET /advertisers/:id/tracking`. */
export const getTrackingSchema: FastifySchema = {
  tags: TAGS,
  description: [
    'The tracking of an Advertiser (viewer): the one snippet to paste in the `<head>` of every page of',
    'its site, the domains its Content Security Policy must allow, when its site last loaded the script,',
    'and, per account it uses, where its tracking code and each conversion goal stand. The first call',
    'gives the Advertiser the public key of its script.',
    '',
    "Nothing is loaded nor sent before the site calls `msq('consent', { ads: 'granted' })` from its",
    "consent banner; a conversion is `msq('conversion', { goal: '<key>', value, currency, orderId })`.",
  ].join('\n'),
  headers: toJsonSchema(organizationHeadersSchema, 'input'),
  params: toJsonSchema(idParamSchema, 'input'),
  response: { 200: toJsonSchema(advertiserTrackingSchema), ...errorResponses(400, 401, 403, 404) },
};

/** Fastify schema for `GET /t/:key.js`. */
export const getTrackingScriptSchema: FastifySchema = {
  tags: TAGS,
  description: [
    'The tracking script of an Advertiser (public, no authentication), loaded by the snippet pasted on its',
    'site: it loads the tags of its platforms once the visitor consents, and fires its conversion goals on',
    'each. Served as JavaScript and cached 5 minutes; 400 for a malformed key, 404 for an unknown one.',
  ].join('\n'),
  security: [],
  params: toJsonSchema(trackingScriptParamsSchema, 'input'),
  response: {
    200: {
      description: 'The script (`application/javascript`)',
      content: { 'application/javascript': { schema: toJsonSchema(z.string()) } },
    },
    ...errorResponses(400, 404),
  },
};
