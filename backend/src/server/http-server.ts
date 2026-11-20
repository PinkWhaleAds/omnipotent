import FastifyMultipart from '@fastify/multipart';
import Fastify, { FastifyInstance } from 'fastify';

import { AppMode, appConfig, httpServerConfig, storageConfig } from '@configs';
import { Controllers, ProbeControllers } from '@modules';
import AccessLogPlugin from '@src/plugins/access-log.plugin';
import AuthPlugin from '@src/plugins/auth.plugin';
import CorsPlugin from '@src/plugins/cors.plugin';
import DatabasePlugin from '@src/plugins/database.plugin';
import ErrorHandlerPlugin from '@src/plugins/error-handler.plugin';
import McpPlugin from '@src/plugins/mcp.plugin';
import MetricsPlugin from '@src/plugins/metrics.plugin';
import RateLimitPlugin from '@src/plugins/rate-limit.plugin';
import SwaggerPlugin from '@src/plugins/swagger.plugin';
import ValidationPlugin from '@src/plugins/validation.plugin';
import AccessServicePlugin from '@src/services/access.service';
import AdGroupServicePlugin from '@src/services/ad-group.service';
import AdvertiserServicePlugin from '@src/services/advertiser.service';
import AdAccountServicePlugin from '@src/services/ad-account.service';
import PreviewServicePlugin from '@src/services/preview.service';
import AssetServicePlugin from '@src/services/asset.service';
import BudgetCurveServicePlugin from '@src/services/budget-curve.service';
import CreativeServicePlugin from '@src/services/creative.service';
import CampaignServicePlugin from '@src/services/campaign.service';
import HealthServicePlugin from '@src/services/health.service';
import JobQueuePlugin from '@src/services/job-queue.service';
import KeywordServicePlugin from '@src/services/keyword.service';
import LabelServicePlugin from '@src/services/label.service';
import LeverServicePlugin from '@src/services/lever.service';
import LineServicePlugin from '@src/services/line.service';
import ListServicePlugin from '@src/services/list.service';
import SecretStorePlugin from '@src/services/secret-store.service';
import StatusServicePlugin from '@src/services/status.service';
import StorageServicePlugin from '@src/services/storage.service';
import TargetingGroupServicePlugin from '@src/services/targeting-group.service';
import PlatformAdaptersPlugin from '@src/platforms/registry';
import PlatformCallJournalPlugin from '@src/services/platform-call.service';
import SyncServicePlugin from '@src/services/sync.service';
import TargetingServicePlugin from '@src/services/targeting.service';
import TokenVerifierPlugin from '@src/services/token-verifier.service';
import { Opt, Callback } from '@src/types';
import { callCallback, LoggerBuilder, Logger, trustNearestProxies } from '@utils';
import { Server } from './server';

/**
 * HTTP server implementation using the Fastify framework.
 *
 * Registers plugins and controllers according to the process mode, then binds
 * to the configured host and port:
 * - `api` — everything: Swagger, authentication, the MCP endpoint and every route;
 * - `worker` — the database, the job queue (which runs the workers) and the
 *   probe and status routes only, so the orchestrator can health-check it.
 *
 * @example
 * ```typescript
 * const httpServer: HttpServer = new HttpServer();
 * await httpServer.listen(() => console.log('Listening'));
 * httpServer.stop((err) => { if (err) console.error(err); });
 * ```
 */
export class HttpServer extends Server {
  /** @internal Winston child logger scoped to this class */
  private logger: Logger;

  /** @internal Underlying Fastify instance */
  private fastify: FastifyInstance;

  /**
   * Creates a new HTTP server instance, initializing the Fastify app
   * and a child logger.
   *
   * @param mode - What this process runs, `appConfig.mode` by default
   *
   * @example
   * ```typescript
   * const server: HttpServer = new HttpServer();
   * ```
   */
  constructor(private readonly mode: AppMode = appConfig.mode) {
    super();
    this.logger = LoggerBuilder.getChildLogger('HttpServer');
    // `request.ip` is the address the `trustProxyHops` nearest proxies saw (the socket's with 0; see `clientIpOf`).
    this.fastify = Fastify({ logger: false, trustProxy: trustNearestProxies(httpServerConfig.trustProxyHops) });
  }

  /**
   * Register Fastify plugins and application controllers for the process mode.
   *
   * Order matters: the validator compiler before any route, Swagger before
   * controllers (so route schemas are documented), the health service before
   * the database and the queue (they register readiness checks), services
   * before the auth plugin that uses them.
   *
   * @returns A promise that resolves once all plugins and controllers are registered
   *
   * @example
   * ```typescript
   * // Called internally by listenApp
   * await server['initFastifyInstance']();
   * ```
   */
  private async initFastifyInstance(): Promise<void> {
    const isApi: boolean = this.mode === 'api';

    // Core plugins
    await this.fastify.register(ErrorHandlerPlugin);
    // Before any route: the validator compiler only applies to the routes registered after it.
    await this.fastify.register(ValidationPlugin);
    await this.fastify.register(AccessLogPlugin);
    if (isApi) await this.fastify.register(CorsPlugin);
    // Before any route it limits, Swagger's included; it runs after the authentication on each route.
    if (isApi) await this.fastify.register(RateLimitPlugin);
    if (isApi) await this.fastify.register(SwaggerPlugin);
    await this.fastify.register(MetricsPlugin);
    await this.fastify.register(HealthServicePlugin);
    await this.fastify.register(StatusServicePlugin);

    // Infrastructure
    await this.fastify.register(DatabasePlugin);
    await this.fastify.register(JobQueuePlugin);
    await this.fastify.register(StorageServicePlugin);
    await this.fastify.register(SecretStorePlugin);

    // Permissions and the resolution of the caller, shared by HTTP routes, MCP tools and job
    // handlers; the domain services of each phase are registered after it, since every one of them
    // checks a role, and the auth plugin calls its `resolve`.
    await this.fastify.register(AccessServicePlugin);

    // The domain services, in dependency order: a worker registers them too, since its jobs call them.
    await this.fastify.register(LabelServicePlugin);
    await this.fastify.register(AdvertiserServicePlugin);
    // The five levels of the campaign tree, parents before children.
    await this.fastify.register(CampaignServicePlugin);
    await this.fastify.register(LeverServicePlugin);
    await this.fastify.register(AdGroupServicePlugin);
    await this.fastify.register(TargetingGroupServicePlugin);
    await this.fastify.register(LineServicePlugin);
    // The daily curves and the pacing, over the five levels.
    await this.fastify.register(BudgetCurveServicePlugin);
    // The targeting, the lists it references and the keywords; the lists read the targeting.
    await this.fastify.register(TargetingServicePlugin);
    await this.fastify.register(ListServicePlugin);
    await this.fastify.register(KeywordServicePlugin);
    // The library of an Advertiser: the bytes, then what is assembled from them.
    await this.fastify.register(AssetServicePlugin);
    await this.fastify.register(CreativeServicePlugin);
    // The platform accounts and the sub-advertisers; the credentials live in the secret store.
    await this.fastify.register(AdAccountServicePlugin);
    // The journal of the platform calls, and the engine that keeps the platforms in step. The
    // preview and the lifecycle read everything above and ask the engine for a campaign's units, so
    // they come last.
    await this.fastify.register(PlatformCallJournalPlugin);
    // The adapters of the platforms whose settings are there, built with what reads our credentials.
    await this.fastify.register(PlatformAdaptersPlugin);
    await this.fastify.register(SyncServicePlugin);
    await this.fastify.register(PreviewServicePlugin);

    if (!isApi) {
      await this.fastify.register(ProbeControllers);
      return;
    }

    // Authentication, uploads, MCP server and routes
    await this.fastify.register(FastifyMultipart, {
      limits: { fileSize: storageConfig.maxUploadBytes, files: 1, fields: 5 },
    });
    await this.fastify.register(TokenVerifierPlugin);
    await this.fastify.register(AuthPlugin);
    await this.fastify.register(McpPlugin);
    await this.fastify.register(Controllers);
  }

  /**
   * Starts the HTTP server and begins listening for requests.
   *
   * @param callback - Optional callback invoked after the server starts
   * @returns A promise that resolves once the server is listening
   * @throws Error if Fastify fails to initialize or bind to the port
   *
   * @example
   * ```typescript
   * await server['listenApp'](() => console.log('ready'));
   * ```
   */
  protected async listenApp(callback?: Opt<Callback>): Promise<void> {
    try {
      await this.initFastifyInstance();
      const address: string = await this.fastify.listen({
        host: httpServerConfig.host,
        port: httpServerConfig.port,
      });
      this.logger.info(`Server started and listening on ${address}`);
      callCallback(callback);
    } catch (err: unknown) {
      this.logger.error('Failed to initialize fastify', { error: err });
      throw err;
    }
  }

  /**
   * Declare the server ready to accept traffic.
   *
   * @example
   * ```typescript
   * server.markReady(); // GET /readyz -> 200
   * ```
   */
  public override markReady(): void {
    this.setReadiness(true);
  }

  /**
   * Declare the server unable to accept traffic.
   *
   * @example
   * ```typescript
   * server.markNotReady(); // GET /readyz -> 503
   * ```
   */
  public override markNotReady(): void {
    this.setReadiness(false);
  }

  /**
   * Forward a readiness change to the decorated health service.
   *
   * The decorator only exists once {@link initFastifyInstance} has run, so a
   * signal received during startup finds nothing to flip — which is correct,
   * since nothing is listening yet either.
   *
   * @param ready - The new readiness state
   * @returns Nothing; mutates the health service state
   *
   * @example
   * ```typescript
   * // Called internally by markReady / markNotReady:
   * // this.setReadiness(true);
   * ```
   */
  private setReadiness(ready: boolean): void {
    if (!this.fastify.hasDecorator('healthService')) return;
    this.fastify.healthService.setReady(ready);
    this.logger.info(`Readiness set to ${ready}`);
  }

  /**
   * Gracefully shuts down the HTTP server.
   *
   * @param callback - Callback invoked after the server closes
   *
   * @example
   * ```typescript
   * server['closeApp']((err) => { if (err) console.error(err); });
   * ```
   */
  protected closeApp(callback: Callback): void {
    this.logger.info('Closing HttpServer');
    this.fastify.close(callback);
  }
}
