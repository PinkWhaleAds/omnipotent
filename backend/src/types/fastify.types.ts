import type { FastifyRequest } from 'fastify';
import type { DataSource } from 'typeorm';

import type {
  AccessService,
  AdAccountService,
  AdGroupService,
  AdvertiserService,
  AssetService,
  BudgetCurveService,
  CreativeService,
  CampaignService,
  HealthService,
  JobQueueService,
  KeywordService,
  LabelService,
  LeverService,
  LineService,
  ListService,
  PreviewService,
  TargetingGroupService,
  TargetingService,
  SecretStore,
  StatusService,
  StorageService,
  TokenVerifier,
} from '@services';
import type { AuthContext, AuthMode } from './auth.types';
import type { GeoImportService } from '@src/services/geo-import.service';
import type { GeoService } from '@src/services/geo.service';
import type { ReviewService } from '@src/services/review.service';
import type { SyncScheduler, SyncService } from '@src/services/sync.service';
import type { CallJournal } from '@src/services/platform-call.service';

/**
 * Function type for recording metrics on incoming HTTP requests.
 *
 * @param request - The incoming Fastify request object
 * @param data - The metric data associated with the request
 * @param data.method - The HTTP method of the request (e.g. 'GET', 'POST')
 * @param data.route - The matched route pattern (e.g. '/api/users/:id') — never the raw URL, to keep the label bounded
 * @param data.res - The HTTP response status code
 *
 * @example
 * ```typescript
 * const recordMetric: MetricFunction = (request, data) => {
 *   statsd.increment(`http.${data.method}.${data.route}`, { status: String(data.res) });
 * };
 * ```
 */
export type MetricFunction = (
  request: FastifyRequest,
  data: {
    method: string;
    route: string;
    res: number;
  }
) => void;

/**
 * Augments the Fastify module with the application's decorators and route options.
 *
 * Each phase adds the services it introduces here, next to the one it decorates the instance with.
 */
declare module 'fastify' {
  interface FastifyInstance {
    /** Records a metric for an HTTP request. */
    metric: MetricFunction;
    /** Kubernetes probe / health check service. */
    healthService: HealthService;
    /** Application status service. */
    statusService: StatusService;
    /** TypeORM data source of the application database. */
    db: DataSource;
    /** Job queue (pg-boss). */
    jobQueue: JobQueueService;
    /** Verifies Auth0 access tokens. */
    tokenVerifier: TokenVerifier;
    /** Permission checks, and the only door to omnipass. */
    accessService: AccessService;
    /** Labels, and the posting of Labels on any resource. */
    labelService: LabelService;
    /** Advertisers: the brands campaigns are run for. */
    advertiserService: AdvertiserService;
    /** Campaigns: the root of the tree. */
    campaignService: CampaignService;
    /** Levers: one channel of a campaign, and the platforms it buys on. */
    leverService: LeverService;
    /** AdGroups: the level the platforms carry a budget on. */
    adGroupService: AdGroupService;
    /** TargetingGroups: all the targeting, and the real bidding object. */
    targetingGroupService: TargetingGroupService;
    /** Lines: the leaf, which a creative will hang from. */
    lineService: LineService;
    /** The daily curve of any node of the tree, and its pacing. */
    budgetCurveService: BudgetCurveService;
    adAccountService: AdAccountService;
    previewService: PreviewService;
    /** The engine that makes the platforms match the tree, and leaves them alone otherwise. */
    syncService: SyncService;
    /** How a synchronization is asked for, without waiting for it. */
    syncScheduler: SyncScheduler;
    /** What the platforms make of our ads, read every ten minutes. */
    reviewService: ReviewService;
    /** The referential of places, Google's catalog, the same for every Organization. */
    geoService: GeoService;
    /** What loads that referential, every month and on an empty database. */
    geoImportService: GeoImportService;
    /** One line per call to a platform: what a failed sync is debugged with. */
    platformCallJournal: CallJournal;
    assetService: AssetService;
    creativeService: CreativeService;
    targetingService: TargetingService;
    listService: ListService;
    keywordService: KeywordService;
    /** Object storage (S3). */
    storageService: StorageService;
    /** Credentials the application needs (AWS Secrets Manager). */
    secretStore: SecretStore;
  }

  interface FastifyRequest {
    /** The authenticated caller; set on every route whose `auth` mode is not `none`. */
    auth?: AuthContext;
  }

  interface FastifyContextConfig {
    /** How the route authenticates its caller (default `api`). */
    auth?: AuthMode;
  }
}
