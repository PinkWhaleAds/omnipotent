/**
 * @module modules
 *
 * Barrel file that registers the application controllers as Fastify plugins.
 * Register {@link Controllers} on an API process to mount every route, and
 * {@link ProbeControllers} on a worker process, which only answers probes.
 */
import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import AdGroupController from './ad-group/ad-group.controller';
import AdvertiserController from './advertiser/advertiser.controller';
import AssetController from './asset/asset.controller';
import BudgetDayController from './budget-day/budget-day.controller';
import CreativeController from './creative/creative.controller';
import CampaignController from './campaign/campaign.controller';
import HealthController from './health/health.controller';
import KeywordController from './keyword/keyword.controller';
import LabelController from './label/label.controller';
import LeverController from './lever/lever.controller';
import LineController from './line/line.controller';
import ListController from './list/list.controller';
import TargetingGroupController from './targeting-group/targeting-group.controller';
import TargetingController from './targeting/targeting.controller';
import OAuthController from './oauth/oauth.controller';
import StatusController from './status/status.controller';

/**
 * Register the probe and status controllers, the only routes a worker serves.
 *
 * @param fastify - The Fastify instance to attach controllers to
 * @returns A promise that resolves once the controllers are registered
 */
async function registerProbeControllers(fastify: FastifyInstance): Promise<void> {
  await fastify.register(HealthController);
  await fastify.register(StatusController);
}

/**
 * Register all application controllers on the given Fastify instance.
 *
 * Each phase adds its resource here, in the order the API reads best; the socle only carries the
 * probes and the status.
 *
 * @param fastify - The Fastify instance to attach controllers to
 * @returns A promise that resolves once all controllers are registered
 *
 * @example
 * ```typescript
 * await fastify.register(Controllers);
 * ```
 */
async function registerControllers(fastify: FastifyInstance): Promise<void> {
  await registerProbeControllers(fastify);
  // The discovery document MCP clients read before signing in; the 401 of the MCP endpoint points at it.
  await fastify.register(OAuthController);
  // The organizing tools first, then what they organize: the order the API documentation reads best.
  await fastify.register(LabelController);
  await fastify.register(AdvertiserController);
  // The campaign tree, from its root down to its leaf.
  await fastify.register(CampaignController);
  await fastify.register(LeverController);
  await fastify.register(AdGroupController);
  await fastify.register(TargetingGroupController);
  await fastify.register(LineController);
  // The daily curve and the pacing of every level, over one table and one service.
  await fastify.register(BudgetDayController);
  // The targeting of the TargetingGroups, the lists it references and the keywords it buys.
  await fastify.register(TargetingController);
  await fastify.register(ListController);
  await fastify.register(KeywordController);
  // The library of an Advertiser: the bytes, then what is assembled from them.
  await fastify.register(AssetController);
  await fastify.register(CreativeController);
}

/**
 * Fastify plugin that encapsulates all application controllers.
 *
 * Wraps {@link registerControllers} with `fastify-plugin` so that
 * decorators and hooks are shared with the parent context.
 */
export const Controllers = fastifyPlugin(registerControllers);

/**
 * Fastify plugin that encapsulates the probe and status controllers only.
 */
export const ProbeControllers = fastifyPlugin(registerProbeControllers);
