import Fastify, { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { AccessService } from '@src/services/access.service';
import { IDS, JANE } from './auth.fixtures';
import { DataSourceMock } from './data-source.mock';

/**
 * Jest mocks of the {@link AccessService}, one per signature of the contract with omnipass
 * (`~/OmniAd/omnipass/docs/message-socle-omnipotent.md` § 2). Every domain service of every phase
 * checks a role through it, so the mock lives here rather than in each spec.
 */
export type AccessServiceMock = {
  assertSuperAdmin: jest.Mock;
  getSeatRole: jest.Mock;
  assertSeatRole: jest.Mock;
  getOrganizationAccess: jest.Mock;
  assertOrganizationRole: jest.Mock;
  invalidateUser: jest.Mock;
  invalidateAll: jest.Mock;
  resolve: jest.Mock;
};

/**
 * Build an access mock that lets every check pass, as an `admin` of `IDS.organization`.
 *
 * A spec that exercises a refusal makes the relevant method reject: the services never decide a
 * right themselves.
 *
 * @returns The mock
 *
 * @example
 * ```typescript
 * const access: AccessServiceMock = createAccessMock();
 * access.assertOrganizationRole.mockRejectedValue(httpError(403, 'Requires the manager role'));
 * ```
 */
export function createAccessMock(): AccessServiceMock {
  const organizationAccess = { organizationId: IDS.organization, seatId: IDS.seat, role: 'admin' };
  return {
    assertSuperAdmin: jest.fn(),
    getSeatRole: jest.fn().mockResolvedValue('member'),
    assertSeatRole: jest.fn().mockResolvedValue('member'),
    getOrganizationAccess: jest.fn().mockResolvedValue(organizationAccess),
    assertOrganizationRole: jest.fn().mockResolvedValue(organizationAccess),
    invalidateUser: jest.fn(),
    invalidateAll: jest.fn(),
    resolve: jest.fn().mockResolvedValue(JANE.tenancy),
  };
}

/**
 * Register the fake `DatabasePlugin` and `AccessServicePlugin` a domain service plugin depends on,
 * then the plugins under test, in order.
 *
 * @param plugins - The service plugins to register, dependencies first
 * @param dependencies - What the fakes decorate the instance with
 * @param dependencies.db - Fake data source, decorated as `db`
 * @param dependencies.access - Access mock, decorated as `accessService`
 * @returns The ready instance; close it when the test ends
 *
 * @example
 * ```typescript
 * const app: FastifyInstance = await buildServiceApp([LabelServicePlugin], { db, access });
 * ```
 */
export async function buildServiceApp(
  plugins: FastifyPluginAsync[],
  dependencies: {
    db: DataSourceMock;
    access: AccessServiceMock;
    /** The label service, for a plugin that depends on `LabelServicePlugin`. */
    labels?: unknown;
    /** The object storage, for a plugin that depends on `StorageServicePlugin`. */
    storage?: unknown;
    /** The secret store, for a plugin that depends on `SecretStorePlugin`. */
    secrets?: unknown;
    /** The campaign service, for a plugin that depends on `CampaignServicePlugin`. */
    campaigns?: unknown;
    /** The daily curves, for a plugin that depends on `BudgetCurveServicePlugin`. */
    curves?: unknown;
    /** The job queue, for a plugin that depends on `JobQueuePlugin`. */
    jobQueue?: unknown;
    /** The engine and its scheduler, for a plugin that depends on `SyncServicePlugin`. */
    sync?: { service: unknown; scheduler: unknown };
    /** The referential of places, for a plugin that depends on `GeoServicePlugin`. */
    geo?: unknown;
  }
): Promise<FastifyInstance> {
  const app: FastifyInstance = Fastify();
  await app.register(
    fastifyPlugin(
      async (instance: FastifyInstance): Promise<void> => {
        instance.decorate('db', dependencies.db.dataSource);
      },
      { name: 'DatabasePlugin' }
    )
  );
  await app.register(
    fastifyPlugin(
      async (instance: FastifyInstance): Promise<void> => {
        instance.decorate('accessService', dependencies.access as unknown as AccessService);
      },
      { name: 'AccessServicePlugin' }
    )
  );
  // A service that reads labels or bytes declares those plugins as dependencies: a spec hands their
  // doubles here, and Fastify is satisfied the same way the real server satisfies it.
  if (dependencies.labels !== undefined) {
    await app.register(
      fastifyPlugin(
        async (instance: FastifyInstance): Promise<void> => {
          instance.decorate('labelService', dependencies.labels as never);
        },
        { name: 'LabelServicePlugin' }
      )
    );
  }
  if (dependencies.storage !== undefined) {
    await app.register(
      fastifyPlugin(
        async (instance: FastifyInstance): Promise<void> => {
          instance.decorate('storageService', dependencies.storage as never);
        },
        { name: 'StorageServicePlugin' }
      )
    );
  }
  if (dependencies.secrets !== undefined) {
    await app.register(
      fastifyPlugin(
        async (instance: FastifyInstance): Promise<void> => {
          instance.decorate('secretStore', dependencies.secrets as never);
        },
        { name: 'SecretStorePlugin' }
      )
    );
  }
  if (dependencies.campaigns !== undefined) {
    await app.register(
      fastifyPlugin(
        async (instance: FastifyInstance): Promise<void> => {
          instance.decorate('campaignService', dependencies.campaigns as never);
        },
        { name: 'CampaignServicePlugin' }
      )
    );
  }
  if (dependencies.curves !== undefined) {
    await app.register(
      fastifyPlugin(
        async (instance: FastifyInstance): Promise<void> => {
          instance.decorate('budgetCurveService', dependencies.curves as never);
        },
        { name: 'BudgetCurveServicePlugin' }
      )
    );
  }
  if (dependencies.jobQueue !== undefined) {
    await app.register(
      fastifyPlugin(
        async (instance: FastifyInstance): Promise<void> => {
          instance.decorate('jobQueue', dependencies.jobQueue as never);
        },
        { name: 'JobQueuePlugin' }
      )
    );
  }
  if (dependencies.sync !== undefined) {
    await app.register(
      fastifyPlugin(
        async (instance: FastifyInstance): Promise<void> => {
          instance.decorate('syncService', dependencies.sync?.service as never);
          instance.decorate('syncScheduler', dependencies.sync?.scheduler as never);
        },
        { name: 'SyncServicePlugin' }
      )
    );
  }
  if (dependencies.geo !== undefined) {
    await app.register(
      fastifyPlugin(
        async (instance: FastifyInstance): Promise<void> => {
          instance.decorate('geoService', dependencies.geo as never);
        },
        { name: 'GeoServicePlugin' }
      )
    );
  }
  for (const plugin of plugins) await app.register(plugin);
  await app.ready();
  return app;
}
