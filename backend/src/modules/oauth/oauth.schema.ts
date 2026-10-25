import type { FastifySchema } from 'fastify';

import { protectedResourceMetadataSchema } from '@src/types';
import { toJsonSchema } from '@utils';

/** Fastify schema for the protected resource metadata routes. */
export const getProtectedResourceMetadataSchema: FastifySchema = {
  tags: ['OAuth'],
  description:
    'OAuth 2.0 Protected Resource Metadata (RFC 9728) of the MCP endpoint: tells MCP clients ' +
    'which authorization server issues its tokens',
  security: [],
  response: { 200: toJsonSchema(protectedResourceMetadataSchema) },
};
