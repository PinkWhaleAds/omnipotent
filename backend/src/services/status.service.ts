import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { APP_NAME, APP_VERSION } from '@constants';
import { StatusResult } from '@src/types';

/**
 * Service responsible for providing application status information.
 *
 * Shared between the HTTP controller (`GET /status`) and the MCP tool (`get-status`).
 */
export class StatusService {
  /**
   * Returns the current application status including name, version, and timestamp.
   *
   * @returns The application status
   */
  public getStatus(): StatusResult {
    return {
      app_name: APP_NAME,
      app_version: APP_VERSION,
      timestamp: Date.now(),
    };
  }
}

/**
 * Fastify plugin that decorates the instance with a {@link StatusService}.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function statusServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('statusService', new StatusService());
}

export default fastifyPlugin(statusServicePlugin, {
  name: 'StatusServicePlugin',
});
