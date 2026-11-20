import type { FastifySchema } from 'fastify';

import { snapshotSchema } from '@src/types';
import { errorResponses, toJsonSchema } from '@utils';

/** Fastify schema for `GET /me`. */
export const getMeSchema: FastifySchema = {
  tags: ['Me'],
  description: [
    'Who you are, as omnipass resolved it for this request: your user, your Seats, your Organizations',
    'with your role and their timezone, and the invitations waiting for your answer.',
    '',
    'Nothing here is stored by Omnipotent: omnipass owns the identity and the tenancy (T5). No',
    '`x-organization-id` header: this is how you find the Organization ids the other routes take.',
  ].join('\n'),
  response: { 200: toJsonSchema(snapshotSchema), ...errorResponses(401) },
};
