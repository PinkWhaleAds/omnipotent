import { statusResultSchema } from '@src/types';

/**
 * MCP tool schema for `get-status`.
 *
 * Mirrors the shape used by `server.registerTool(name, schema, handler)`
 * in the MCP SDK — the `outputSchema` reuses {@link statusResultSchema}
 * so the HTTP route, the inferred TypeScript type, and the MCP tool all
 * share a single source of truth.
 */
export const getStatusSchema = {
  title: 'Get Application Status',
  description: 'Returns the application name, version, and current timestamp',
  outputSchema: statusResultSchema,
};
