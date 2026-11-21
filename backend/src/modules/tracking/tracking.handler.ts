import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { renderLoader } from '@src/tracking/loader';
import type { LoaderConfig } from '@src/tracking/loader-config';
import { IdParam, TrackingScriptParams } from '@src/types';
import { actorOf, httpError, organizationIdOf } from '@utils';

/** How long browsers keep the script: a change of its configuration shows within 5 minutes. */
const CACHE_CONTROL = 'public, max-age=300';

/**
 * Handler for `GET /advertisers/:id/tracking`.
 *
 * @param request - The request, with the Advertiser id
 * @param reply - The reply, sent with the tracking of the Advertiser
 * @returns A promise that resolves once the response has been sent
 */
export async function getTracking(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply
): Promise<void> {
  reply.send(await this.trackingService.get(actorOf(request), organizationIdOf(request), request.params.id));
}

/**
 * Handler for `GET /t/:key.js` — the tracking script of the Advertiser owning the key.
 *
 * Public: the script only holds public identifiers (Google's `AW-…` tags and labels). It is loaded
 * cross-origin by the sites, hence the permissive CORS and resource policy headers. Serving it records,
 * in the background, that the site loaded it.
 *
 * @param request - The request, with the tracking key in its path
 * @param reply - The reply used to send the script
 * @returns A promise that resolves once the script has been sent
 * @throws Error with status 404 coded `tracking_key_unknown` when no Advertiser has this key
 */
export async function getTrackingScript(
  this: FastifyInstance,
  request: FastifyRequest<{ Params: TrackingScriptParams }>,
  reply: FastifyReply
): Promise<void> {
  const config: LoaderConfig | null = await this.trackingService.loaderConfig(request.params.key);
  if (!config) throw httpError(404, 'Unknown tracking key', { code: 'tracking_key_unknown' });

  reply
    .header('Cache-Control', CACHE_CONTROL)
    .header('Access-Control-Allow-Origin', '*')
    .header('Cross-Origin-Resource-Policy', 'cross-origin')
    .header('X-Content-Type-Options', 'nosniff')
    .type('application/javascript; charset=utf-8')
    .send(renderLoader(config));
}
