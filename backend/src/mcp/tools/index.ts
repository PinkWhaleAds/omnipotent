/**
 * @module mcp/tools
 *
 * Registers all MCP tool controllers on a given MCP server.
 * Mirrors `src/modules/index.ts` for HTTP controllers.
 */
import type { FastifyInstance } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { McpContext } from '@src/types';
import AdGroupToolsController from './ad-group/ad-group.controller';
import AdvertiserToolsController from './advertiser/advertiser.controller';
import AdAccountToolsController from './ad-account/ad-account.controller';
import AssetToolsController from './asset/asset.controller';
import BudgetDayToolsController from './budget-day/budget-day.controller';
import CreativeToolsController from './creative/creative.controller';
import CampaignToolsController from './campaign/campaign.controller';
import ConversionGoalToolsController from './conversion-goal/conversion-goal.controller';
import GeoToolsController from './geo/geo.controller';
import KeywordToolsController from './keyword/keyword.controller';
import LabelToolsController from './label/label.controller';
import LeverToolsController from './lever/lever.controller';
import LineToolsController from './line/line.controller';
import PreviewToolsController from './preview/preview.controller';
import SyncToolsController from './sync/sync.controller';
import ListToolsController from './list/list.controller';
import MeToolsController from './me/me.controller';
import StatusToolsController from './status/status.controller';
import TargetingGroupToolsController from './targeting-group/targeting-group.controller';
import TargetingToolsController from './targeting/targeting.controller';
import TrackingToolsController from './tracking/tracking.controller';

/**
 * Register every MCP tool controller on the given MCP server.
 *
 * Every operation of the API is exposed as a tool (D21): each phase registers its resource here,
 * next to its HTTP controller.
 *
 * @param server - The MCP server to attach tool controllers to
 * @param fastify - The Fastify instance providing decorated services
 * @param context - Caller of the MCP request, handed to every org-scoped tool
 */
export function registerToolControllers(server: McpServer, fastify: FastifyInstance, context: McpContext): void {
  StatusToolsController(server, fastify);
  MeToolsController(server, context);
  LabelToolsController(server, fastify, context);
  AdvertiserToolsController(server, fastify, context);
  // The campaign tree, from its root down to its leaf.
  CampaignToolsController(server, fastify, context);
  LeverToolsController(server, fastify, context);
  AdGroupToolsController(server, fastify, context);
  TargetingGroupToolsController(server, fastify, context);
  LineToolsController(server, fastify, context);
  // The daily curve and the pacing of every level, over one table and one service.
  BudgetDayToolsController(server, fastify, context);
  // The targeting of the TargetingGroups, the lists it references and the keywords it buys.
  TargetingToolsController(server, fastify, context);
  // The referential of places its location dimension takes, and the geocoding of its circles.
  GeoToolsController(server, fastify, context);
  ListToolsController(server, fastify, context);
  KeywordToolsController(server, fastify, context);
  // The library of an Advertiser: the bytes, then what is assembled from them.
  AssetToolsController(server, fastify, context);
  CreativeToolsController(server, fastify, context);
  // The platform accounts and the sub-advertisers; the credentials have no tool, by design.
  AdAccountToolsController(server, fastify, context);
  // The conversion goals of the Advertisers, and the one code their sites install.
  ConversionGoalToolsController(server, fastify, context);
  TrackingToolsController(server, fastify, context);
  // The preview and the lifecycle, which read everything above, and the synchronization that
  // answers « has my change reached the platforms ».
  PreviewToolsController(server, fastify, context);
  SyncToolsController(server, fastify, context);
}
