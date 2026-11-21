import { FastifyInstance } from 'fastify';
import { In } from 'typeorm';

import {
  AdAccountEntity,
  AdGroupEntity,
  AdvertiserAdAccountEntity,
  AdvertiserEntity,
  AdvertiserTrackingEntity,
  ConversionGoalEntity,
  ConversionGoalRefEntity,
  PlatformUnitEntity,
} from '@src/database/entities';
import { fingerprint } from '@src/platforms/desired-state';
import { ADAPTERS, GoalSpec, PlatformAdapter, PlatformError, TrackingSetup } from '@src/platforms/platform-adapter';
import TrackingServicePlugin, {
  CONVERSION_SETUP_JOB_NAME,
  goalSpecs,
  JobQueueTrackingScheduler,
  TrackingService,
  trackingSnippet,
} from '@src/services/tracking.service';
import { Platform } from '@src/types';
import { AccessServiceMock, buildServiceApp, createAccessMock } from '@test/unit/mocks/access.mock';
import { IDS, JANE, NOW } from '@test/unit/mocks/auth.fixtures';
import { createDataSourceMock, DataSourceMock } from '@test/unit/mocks/data-source.mock';

/** Ids the specs work with. */
const ACCOUNT_ID = 'ff000000-0000-4000-8000-000000000001';
const OTHER_ACCOUNT_ID = 'ff000000-0000-4000-8000-000000000002';
const GOAL_ID = 'f0000000-0000-4000-8000-000000000001';
const OTHER_GOAL_ID = 'f0000000-0000-4000-8000-000000000002';

/** The public key of the Advertiser's script. */
const KEY = 'k3yK3yK3yK3yK3yK3yK3yK3y';

/** Where the specs serve the scripts. */
const BASE_URL = 'https://api.omnipotent.test';

/** A conversion action's ids at Google. */
const GOAL_REFS = {
  conversionAction: 'customers/5550001111/conversionActions/1',
  sendTo: 'AW-111/abc',
  customGoal: 'customers/5550001111/customConversionGoals/2',
};

/**
 * Build an Advertiser row.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function advertiserRow(overrides: Partial<AdvertiserEntity> = {}): AdvertiserEntity {
  return {
    id: IDS.advertiser,
    organizationId: IDS.organization,
    name: 'Herbéa',
    websiteUrl: 'https://herbea.test',
    trackingKey: KEY,
    scriptSeenAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  } as AdvertiserEntity;
}

/**
 * Build an ad account row.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function accountRow(overrides: Partial<AdAccountEntity> = {}): AdAccountEntity {
  return {
    id: ACCOUNT_ID,
    organizationId: IDS.organization,
    platform: 'google_ads',
    externalId: '5550001111',
    name: 'Herbéa FR',
    currency: 'EUR',
    timezone: 'Europe/Paris',
    status: 'active',
    statusReason: null,
    scope: {},
    secretName: null,
    linkRef: '5550001111',
    deletedAt: null,
    ...overrides,
  } as AdAccountEntity;
}

/**
 * Build a link of the Advertiser to an account.
 *
 * @param adAccountId - The account
 * @param platform - Its platform
 * @returns The link
 */
function linkRow(adAccountId: string = ACCOUNT_ID, platform: Platform = 'google_ads'): AdvertiserAdAccountEntity {
  return { advertiserId: IDS.advertiser, adAccountId, platform, currency: 'EUR' } as AdvertiserAdAccountEntity;
}

/**
 * Build a goal row.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function goalRow(overrides: Partial<ConversionGoalEntity> = {}): ConversionGoalEntity {
  return {
    id: GOAL_ID,
    organizationId: IDS.organization,
    advertiserId: IDS.advertiser,
    key: 'achat',
    name: 'Achat',
    category: 'purchase',
    valueMode: 'dynamic',
    defaultValueCents: 8_900,
    currency: 'EUR',
    counting: 'every',
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as ConversionGoalEntity;
}

/**
 * Build the tracking of the Advertiser on an account.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function trackingRow(overrides: Partial<AdvertiserTrackingEntity> = {}): AdvertiserTrackingEntity {
  return {
    advertiserId: IDS.advertiser,
    adAccountId: ACCOUNT_ID,
    platform: 'google_ads',
    status: 'ready',
    refs: { tagId: 'AW-111' },
    message: null,
    messageCode: null,
    messageParams: null,
    ...overrides,
  } as AdvertiserTrackingEntity;
}

/**
 * Build a goal on an account.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function refRow(overrides: Partial<ConversionGoalRefEntity> = {}): ConversionGoalRefEntity {
  return {
    goalId: GOAL_ID,
    adAccountId: ACCOUNT_ID,
    platform: 'google_ads',
    status: 'ready',
    refs: GOAL_REFS,
    biddable: true,
    message: null,
    messageCode: null,
    messageParams: null,
    syncedHash: null,
    ...overrides,
  } as ConversionGoalRefEntity;
}

/** The spec of {@link goalRow} at the platforms. */
const SPEC: GoalSpec = {
  id: GOAL_ID,
  key: 'achat',
  name: 'Herbéa — Achat',
  category: 'purchase',
  valueMode: 'dynamic',
  defaultValueMicros: 89_000_000,
  currency: 'EUR',
  counting: 'every',
  status: 'active',
};

/** A tracking ready on Google. */
const READY_TRACKING: TrackingSetup = { status: 'ready', refs: { tagId: 'AW-111' }, message: null, biddable: false };

/** A goal ready on Google. */
const READY_GOAL: TrackingSetup = { status: 'ready', refs: GOAL_REFS, message: null, biddable: true };

describe('Unit::Services::TrackingService', () => {
  /** The registry of adapters, writable, so a spec declares one as a phase would. */
  const adapters: Partial<Record<Platform, PlatformAdapter>> = ADAPTERS as Partial<Record<Platform, PlatformAdapter>>;

  let db: DataSourceMock;
  let access: AccessServiceMock;
  let secrets: { get: jest.Mock };
  let scheduler: { request: jest.Mock };
  let setupTracking: jest.Mock;
  let setupGoal: jest.Mock;
  let service: TrackingService;

  /**
   * What the database holds for the Advertiser.
   *
   * @param state - Its rows
   * @param state.advertiser - The Advertiser, `null` when gone
   * @param state.links - Its links to accounts
   * @param state.accounts - The accounts
   * @param state.goals - Its goals
   * @param state.trackings - Its tracking on each account
   * @param state.refs - Its goals on each account
   * @returns Nothing
   */
  function seed(
    state: {
      advertiser?: AdvertiserEntity | null;
      links?: AdvertiserAdAccountEntity[];
      accounts?: AdAccountEntity[];
      goals?: ConversionGoalEntity[];
      trackings?: AdvertiserTrackingEntity[];
      refs?: ConversionGoalRefEntity[];
    } = {}
  ): void {
    db.repository(AdvertiserEntity).findOneBy.mockResolvedValue(
      state.advertiser === undefined ? advertiserRow() : state.advertiser
    );
    db.repository(AdvertiserAdAccountEntity).find.mockResolvedValue(state.links ?? [linkRow()]);
    db.repository(AdAccountEntity).findBy.mockResolvedValue(state.accounts ?? [accountRow()]);
    db.repository(ConversionGoalEntity).find.mockResolvedValue(state.goals ?? [goalRow()]);
    db.repository(AdvertiserTrackingEntity).findBy.mockResolvedValue(state.trackings ?? []);
    db.repository(ConversionGoalRefEntity).findBy.mockResolvedValue(state.refs ?? []);
  }

  /**
   * Declare the adapter of Google, setting the tracking and the goals up.
   *
   * @param overrides - What it does differently
   * @returns Nothing
   */
  function declareGoogle(overrides: Partial<PlatformAdapter> = {}): void {
    adapters.google_ads = {
      platform: 'google_ads',
      connection: 'manager_link',
      apply: jest.fn(),
      setupTracking,
      setupGoal,
      ...overrides,
    };
  }

  beforeEach((): void => {
    db = createDataSourceMock();
    access = createAccessMock();
    secrets = { get: jest.fn().mockResolvedValue('the-key') };
    scheduler = { request: jest.fn().mockResolvedValue(undefined) };
    setupTracking = jest.fn().mockResolvedValue(READY_TRACKING);
    setupGoal = jest.fn().mockResolvedValue(READY_GOAL);
    service = new TrackingService(db.dataSource, access as never, secrets as never, scheduler, BASE_URL);
    db.repository(AdvertiserTrackingEntity).save.mockImplementation(async (row: object): Promise<object> => row);
  });

  afterEach((): void => {
    for (const platform of Object.keys(adapters)) Reflect.deleteProperty(adapters, platform);
  });

  describe('goalSpecs', () => {
    it('should name each goal after its Advertiser, its value in micros', (): void => {
      expect(goalSpecs('Herbéa', [goalRow(), goalRow({ id: OTHER_GOAL_ID, defaultValueCents: null })])).toEqual([
        SPEC,
        { ...SPEC, id: OTHER_GOAL_ID, defaultValueMicros: null },
      ]);
    });
  });

  describe('trackingSnippet', () => {
    it('should queue the calls made before the script loads, load it, and say how to relay the consent', (): void => {
      const snippet: string = trackingSnippet(`${BASE_URL}/t/${KEY}.js`);

      expect(snippet).toContain('w.msq = w.msq || function () { (w.msq.q = w.msq.q || []).push(arguments); };');
      expect(snippet).toContain(`})(window, document, 'script', '${BASE_URL}/t/${KEY}.js');`);
      expect(snippet).toContain("msq('consent', { ads: 'granted' })");
    });
  });

  describe('get', () => {
    it('should give the code, the domains and where everything stands on each account', async (): Promise<void> => {
      seed({
        advertiser: advertiserRow({ scriptSeenAt: NOW }),
        links: [linkRow(), linkRow(OTHER_ACCOUNT_ID, 'microsoft'), linkRow('ff000000-0000-4000-8000-00000000dead')],
        accounts: [accountRow({ id: OTHER_ACCOUNT_ID, platform: 'microsoft', name: 'Herbéa Bing' }), accountRow()],
        goals: [goalRow(), goalRow({ id: OTHER_GOAL_ID, key: 'devis', status: 'archived' })],
        trackings: [
          trackingRow(),
          trackingRow({
            adAccountId: OTHER_ACCOUNT_ID,
            platform: 'microsoft',
            status: 'manual_required',
            refs: {},
            message: 'Conversion tracking is not supported yet on this platform',
            messageCode: 'tracking_not_supported',
            messageParams: { platform: 'microsoft' },
          }),
        ],
        refs: [
          refRow(),
          refRow({
            goalId: OTHER_GOAL_ID,
            status: 'failed',
            message: 'Google refused',
            messageCode: 'google_conversion_snippet_missing',
            messageParams: { conversionAction: 'x' },
            biddable: false,
          }),
        ],
      });

      await expect(service.get(JANE, IDS.organization, IDS.advertiser)).resolves.toEqual({
        advertiserId: IDS.advertiser,
        snippet: trackingSnippet(`${BASE_URL}/t/${KEY}.js`),
        scriptUrl: `${BASE_URL}/t/${KEY}.js`,
        cspDomains: [
          'api.omnipotent.test',
          'www.googletagmanager.com',
          'www.google.com',
          'googleads.g.doubleclick.net',
        ],
        lastSeenAt: NOW.toISOString(),
        platforms: [
          {
            platform: 'google_ads',
            adAccountId: ACCOUNT_ID,
            adAccountName: 'Herbéa FR',
            status: 'ready',
            message: null,
            messageCode: null,
            messageParams: null,
            goals: [
              {
                goalId: GOAL_ID,
                key: 'achat',
                status: 'ready',
                message: null,
                messageCode: null,
                messageParams: null,
                biddable: true,
              },
              {
                goalId: OTHER_GOAL_ID,
                key: 'devis',
                status: 'failed',
                message: 'Google refused',
                messageCode: 'google_conversion_snippet_missing',
                messageParams: { conversionAction: 'x' },
                biddable: false,
              },
            ],
          },
          {
            platform: 'microsoft',
            adAccountId: OTHER_ACCOUNT_ID,
            adAccountName: 'Herbéa Bing',
            status: 'manual_required',
            message: 'Conversion tracking is not supported yet on this platform',
            messageCode: 'tracking_not_supported',
            messageParams: { platform: 'microsoft' },
            goals: [
              expect.objectContaining({ goalId: GOAL_ID, status: 'pending', biddable: false }),
              expect.objectContaining({ goalId: OTHER_GOAL_ID, status: 'pending', message: null }),
            ],
          },
        ],
      });
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
      expect(db.repository(AdvertiserAdAccountEntity).find).toHaveBeenCalledWith({
        where: { advertiserId: IDS.advertiser },
        order: { platform: 'ASC', currency: 'ASC' },
      });
    });

    it('should answer an Advertiser without account nor goal, never seen', async (): Promise<void> => {
      seed({ links: [], goals: [] });

      await expect(service.get(JANE, IDS.organization, IDS.advertiser)).resolves.toMatchObject({
        cspDomains: ['api.omnipotent.test'],
        lastSeenAt: null,
        platforms: [],
      });
      expect(db.repository(AdAccountEntity).findBy).not.toHaveBeenCalled();
      expect(db.repository(ConversionGoalRefEntity).findBy).not.toHaveBeenCalled();
    });

    it('should give an Advertiser its key on the first read', async (): Promise<void> => {
      seed({ advertiser: advertiserRow({ trackingKey: null }), links: [], goals: [] });

      const { scriptUrl } = await service.get(JANE, IDS.organization, IDS.advertiser);

      expect(scriptUrl).toMatch(/^https:\/\/api\.omnipotent\.test\/t\/[A-Za-z0-9_-]{24}\.js$/);
      expect(db.repository(AdvertiserEntity).update).toHaveBeenCalledWith(
        { id: IDS.advertiser, trackingKey: expect.anything() },
        { trackingKey: expect.stringMatching(/^[A-Za-z0-9_-]{24}$/) }
      );
    });

    it('should keep the key another request gave in the meantime', async (): Promise<void> => {
      seed({ advertiser: advertiserRow({ trackingKey: null }), links: [], goals: [] });
      db.repository(AdvertiserEntity).update.mockResolvedValue({ affected: 0 });
      db.repository(AdvertiserEntity)
        .findOneBy.mockResolvedValueOnce(advertiserRow({ trackingKey: null }))
        .mockResolvedValueOnce(advertiserRow({ trackingKey: 'theirs-theirs-theirs-the' }));

      await expect(service.get(JANE, IDS.organization, IDS.advertiser)).resolves.toMatchObject({
        scriptUrl: `${BASE_URL}/t/theirs-theirs-theirs-the.js`,
      });
    });

    it('should answer 404 for an Advertiser the Organization does not have', async (): Promise<void> => {
      seed({ advertiser: null });

      await expect(service.get(JANE, IDS.organization, IDS.advertiser)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'advertiser_not_found',
      });
    });
  });

  describe('loaderConfig', () => {
    it('should load the tags of the ready trackings, and fire each active goal where it is ready', async (): Promise<void> => {
      seed({
        links: [linkRow(), linkRow(OTHER_ACCOUNT_ID)],
        accounts: [accountRow(), accountRow({ id: OTHER_ACCOUNT_ID, externalId: '5550002222' })],
        goals: [goalRow(), goalRow({ id: OTHER_GOAL_ID, key: 'devis', valueMode: 'none', defaultValueCents: null })],
        trackings: [
          trackingRow(),
          // Never tracked before its first action: its tag comes from the label of its goals.
          trackingRow({ adAccountId: OTHER_ACCOUNT_ID, refs: { tagId: null } }),
          // An account no longer linked loads nothing.
          trackingRow({ adAccountId: 'ff000000-0000-4000-8000-00000000dead', refs: { tagId: 'AW-999' } }),
        ],
        refs: [
          refRow(),
          refRow({ adAccountId: OTHER_ACCOUNT_ID, refs: { ...GOAL_REFS, sendTo: 'AW-222/def' } }),
          refRow({ goalId: OTHER_GOAL_ID, refs: { conversionAction: 'x', sendTo: null, customGoal: null } }),
          refRow({ goalId: OTHER_GOAL_ID, adAccountId: 'ff000000-0000-4000-8000-00000000dead' }),
          refRow({ goalId: OTHER_GOAL_ID, adAccountId: OTHER_ACCOUNT_ID, platform: 'microsoft' }),
        ],
      });

      await expect(service.loaderConfig(KEY)).resolves.toEqual({
        googleTagIds: ['AW-111', 'AW-222'],
        goals: {
          achat: {
            category: 'purchase',
            valueMode: 'dynamic',
            defaultValue: 89,
            currency: 'EUR',
            google: [{ sendTo: 'AW-111/abc' }, { sendTo: 'AW-222/def' }],
          },
          devis: { category: 'purchase', valueMode: 'none', defaultValue: null, currency: 'EUR', google: [] },
        },
      });
      expect(db.repository(AdvertiserEntity).findOneBy).toHaveBeenCalledWith({ trackingKey: KEY });
      expect(db.repository(AdvertiserTrackingEntity).findBy).toHaveBeenCalledWith({
        advertiserId: IDS.advertiser,
        status: 'ready',
      });
      expect(db.repository(ConversionGoalEntity).find).toHaveBeenCalledWith({
        where: { advertiserId: IDS.advertiser, status: 'active' },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
      expect(db.repository(ConversionGoalRefEntity).findBy).toHaveBeenCalledWith({
        goalId: In([GOAL_ID, OTHER_GOAL_ID]),
        status: 'ready',
      });
    });

    it('should load a tracking of a platform the script has no part for, but fire nothing there', async (): Promise<void> => {
      seed({
        links: [linkRow(ACCOUNT_ID, 'microsoft')],
        accounts: [accountRow({ platform: 'microsoft' })],
        trackings: [trackingRow({ platform: 'microsoft', refs: { uetTagId: '5000001' } })],
        refs: [refRow({ platform: 'microsoft', refs: { action: 'achat' } })],
      });

      await expect(service.loaderConfig(KEY)).resolves.toMatchObject({
        googleTagIds: [],
        goals: { achat: { google: [] } },
      });
    });

    it('should read no goal on an account when the Advertiser has none active', async (): Promise<void> => {
      seed({ goals: [] });

      await expect(service.loaderConfig(KEY)).resolves.toEqual({ googleTagIds: [], goals: {} });
      expect(db.repository(ConversionGoalRefEntity).findBy).not.toHaveBeenCalled();
    });

    it.each([
      ['a malformed key', 'short'],
      ['an unknown key', KEY],
    ])('should answer null for %s', async (_label: string, key: string): Promise<void> => {
      seed({ advertiser: null });

      await expect(service.loaderConfig(key)).resolves.toBeNull();
    });

    describe('the record that the site loaded its script', () => {
      it.each([
        ['never recorded', null],
        ['recorded more than an hour ago', new Date(Date.now() - 2 * 3_600_000)],
      ])('should record it when %s', async (_label: string, seenAt: Date | null): Promise<void> => {
        seed({ advertiser: advertiserRow({ scriptSeenAt: seenAt }), goals: [] });

        await service.loaderConfig(KEY);

        expect(db.mocks.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE advertisers SET script_seen_at'), [
          IDS.advertiser,
          3_600,
        ]);
      });

      it('should not record it again within the hour', async (): Promise<void> => {
        seed({ advertiser: advertiserRow({ scriptSeenAt: new Date(Date.now() - 60_000) }), goals: [] });

        await service.loaderConfig(KEY);

        expect(db.mocks.query).not.toHaveBeenCalled();
      });

      it('should serve the script all the same when recording it fails', async (): Promise<void> => {
        seed({ goals: [] });
        db.mocks.query.mockRejectedValue(new Error('connection lost'));

        await expect(service.loaderConfig(KEY)).resolves.toEqual({ googleTagIds: [], goals: {} });
        await new Promise((resolve: (value: unknown) => void): void => {
          setImmediate(resolve);
        });
      });
    });
  });

  describe('setup', () => {
    it('should set the tracking up, then every goal, and keep where each stands', async (): Promise<void> => {
      declareGoogle();
      seed({ trackings: [trackingRow({ status: 'pending', refs: {} })] });

      await service.setup(IDS.advertiser);

      expect(setupTracking).toHaveBeenCalledWith(
        { platform: 'google_ads', adAccountId: ACCOUNT_ID, externalId: '5550001111', scope: {}, credentials: null },
        { id: IDS.advertiser, name: 'Herbéa', websiteUrl: 'https://herbea.test' },
        {}
      );
      expect(setupGoal).toHaveBeenCalledWith(
        expect.objectContaining({ adAccountId: ACCOUNT_ID }),
        SPEC,
        READY_TRACKING.refs,
        null
      );
      expect(db.repository(AdvertiserTrackingEntity).save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'ready', refs: { tagId: 'AW-111' }, message: null, messageCode: null })
      );
      expect(db.repository(ConversionGoalRefEntity).create).toHaveBeenCalledWith({
        goalId: GOAL_ID,
        adAccountId: ACCOUNT_ID,
        platform: 'google_ads',
      });
      expect(db.repository(ConversionGoalRefEntity).save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ready',
          refs: GOAL_REFS,
          biddable: true,
          messageCode: null,
          messageParams: null,
          syncedHash: fingerprint({ spec: SPEC, tracking: READY_TRACKING.refs }),
        })
      );
      // A goal that became ready marks the units of the AdGroups that optimize it there.
      expect(db.manager.find).toHaveBeenCalledWith(AdGroupEntity, {
        where: { conversionGoalId: GOAL_ID },
        select: { id: true },
      });
      expect(db.runner.query).toHaveBeenCalledWith('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [
        `conversion:${IDS.advertiser}`,
      ]);
    });

    it('should leave a row behind on a first setup, so that the sweep finds an account the platform failed on', async (): Promise<void> => {
      declareGoogle({
        setupTracking: jest.fn().mockRejectedValue(
          new PlatformError('google_ads', 'Too many requests', {
            statusCode: 429,
            retryable: true,
            invalidCredentials: false,
            requestId: null,
          })
        ),
      });
      seed();

      await service.setup(IDS.advertiser);

      expect(db.repository(AdvertiserTrackingEntity).create).toHaveBeenCalledWith({
        advertiserId: IDS.advertiser,
        adAccountId: ACCOUNT_ID,
        platform: 'google_ads',
      });
      expect(db.repository(AdvertiserTrackingEntity).save).toHaveBeenCalledTimes(1);
      expect(db.repository(AdvertiserTrackingEntity).save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending', refs: {} })
      );
      expect(db.manager.update).not.toHaveBeenCalled();
    });

    it('should make an account whose key the platform refused invalid', async (): Promise<void> => {
      declareGoogle({
        setupTracking: jest.fn().mockRejectedValue(
          new PlatformError('google_ads', 'Unauthorized', {
            statusCode: 401,
            retryable: false,
            invalidCredentials: true,
            requestId: null,
          })
        ),
      });
      seed({ trackings: [trackingRow()] });

      await service.setup(IDS.advertiser);

      expect(db.manager.update).toHaveBeenCalledWith(
        AdAccountEntity,
        { id: ACCOUNT_ID },
        { status: 'invalid', statusReason: 'credentials_rejected' }
      );
    });

    it('should leave the account alone when our own credentials failed', async (): Promise<void> => {
      declareGoogle({
        setupTracking: jest.fn().mockRejectedValue(
          new PlatformError('google_ads', 'Our service account is refused', {
            statusCode: 401,
            retryable: false,
            invalidCredentials: true,
            ownCredentials: true,
            requestId: null,
          })
        ),
      });
      seed({ trackings: [trackingRow()] });

      await service.setup(IDS.advertiser);

      expect(db.manager.update).not.toHaveBeenCalled();
    });

    it('should keep a refusal of the platform as a failure, with its code, and go on with the next account', async (): Promise<void> => {
      declareGoogle({
        setupGoal: jest
          .fn()
          .mockRejectedValueOnce(
            new PlatformError('google_ads', 'Google Ads gave no event snippet', {
              statusCode: null,
              retryable: false,
              invalidCredentials: false,
              requestId: null,
              messageCode: 'google_conversion_snippet_missing',
              messageParams: { conversionAction: 'x' },
            })
          )
          .mockRejectedValueOnce(
            new PlatformError('google_ads', 'DUPLICATE_NAME', {
              statusCode: 400,
              retryable: false,
              invalidCredentials: false,
              requestId: null,
            })
          ),
      });
      seed({
        links: [linkRow(), linkRow(OTHER_ACCOUNT_ID)],
        accounts: [accountRow(), accountRow({ id: OTHER_ACCOUNT_ID })],
        trackings: [trackingRow(), trackingRow({ adAccountId: OTHER_ACCOUNT_ID })],
        refs: [refRow({ status: 'failed', refs: { conversionAction: 'x' } })],
      });

      await service.setup(IDS.advertiser);

      const saved = db.repository(ConversionGoalRefEntity).save.mock.calls.map(([row]: [object]): object => row);
      expect(saved).toEqual([
        expect.objectContaining({
          adAccountId: ACCOUNT_ID,
          status: 'failed',
          refs: { conversionAction: 'x' },
          message: 'Google Ads gave no event snippet',
          messageCode: 'google_conversion_snippet_missing',
          messageParams: { conversionAction: 'x' },
          biddable: false,
        }),
        expect.objectContaining({
          adAccountId: OTHER_ACCOUNT_ID,
          status: 'failed',
          refs: {},
          message: 'DUPLICATE_NAME',
          messageCode: null,
          messageParams: null,
        }),
      ]);
    });

    it('should leave a goal settled since its last setup alone, and set up one changed or failed', async (): Promise<void> => {
      declareGoogle();
      const hash: string = fingerprint({ spec: SPEC, tracking: READY_TRACKING.refs });
      seed({
        goals: [goalRow(), goalRow({ id: OTHER_GOAL_ID, key: 'devis', status: 'archived' })],
        trackings: [trackingRow()],
        refs: [
          refRow({ syncedHash: hash }),
          refRow({ goalId: OTHER_GOAL_ID, status: 'failed', syncedHash: 'whatever' }),
        ],
      });

      await service.setup(IDS.advertiser);

      expect(setupGoal).toHaveBeenCalledTimes(1);
      expect(setupGoal).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: OTHER_GOAL_ID, status: 'archived' }),
        READY_TRACKING.refs,
        GOAL_REFS
      );
    });

    it('should mark no unit when a goal stands where it stood, whatever the order of its ids', async (): Promise<void> => {
      declareGoogle({
        setupGoal: jest.fn().mockResolvedValue({
          ...READY_GOAL,
          refs: {
            customGoal: GOAL_REFS.customGoal,
            sendTo: GOAL_REFS.sendTo,
            conversionAction: GOAL_REFS.conversionAction,
          },
        }),
      });
      seed({ trackings: [trackingRow()], refs: [refRow({ syncedHash: 'older' })] });

      await service.setup(IDS.advertiser);

      expect(db.repository(ConversionGoalRefEntity).save).toHaveBeenCalled();
      expect(db.manager.find).not.toHaveBeenCalled();
    });

    it('should mark the units of the AdGroups optimizing a goal whose ids changed', async (): Promise<void> => {
      declareGoogle();
      db.manager.find.mockResolvedValue([{ id: 'a0000000-0000-4000-8000-000000000001' }]);
      seed({ trackings: [trackingRow()], refs: [refRow({ refs: { ...GOAL_REFS, sendTo: 'AW-111/old' } })] });

      await service.setup(IDS.advertiser);

      expect(db.manager.update).toHaveBeenCalledWith(
        PlatformUnitEntity,
        expect.objectContaining({ adAccountId: ACCOUNT_ID }),
        { syncState: 'pending', attempts: 0, nextAttemptAt: null }
      );
    });

    it('should set up no goal while the tracking is not ready', async (): Promise<void> => {
      declareGoogle({
        setupTracking: jest.fn().mockResolvedValue({
          status: 'manual_required',
          refs: { tagId: null },
          message: 'Tracked by another manager',
          messageCode: 'google_conversion_tracking_by_other_manager',
          messageParams: { account: '555-000-1111' },
          biddable: false,
        }),
      });
      seed({ trackings: [trackingRow()] });

      await service.setup(IDS.advertiser);

      expect(setupGoal).not.toHaveBeenCalled();
      expect(db.repository(AdvertiserTrackingEntity).save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'manual_required',
          messageCode: 'google_conversion_tracking_by_other_manager',
          messageParams: { account: '555-000-1111' },
        })
      );
    });

    it('should keep the message of a platform without a code, and give a code its values or none', async (): Promise<void> => {
      declareGoogle({
        setupTracking: jest
          .fn()
          .mockResolvedValue({ status: 'failed', refs: {}, message: 'Google says no', biddable: false }),
      });
      seed({ trackings: [trackingRow()] });
      await service.setup(IDS.advertiser);
      expect(db.repository(AdvertiserTrackingEntity).save).toHaveBeenLastCalledWith(
        expect.objectContaining({ message: 'Google says no', messageCode: null, messageParams: null })
      );

      declareGoogle({
        setupTracking: jest.fn().mockResolvedValue({
          status: 'manual_required',
          refs: {},
          message: 'Someone must act',
          messageCode: 'tracking_not_supported',
          biddable: false,
        }),
      });
      await service.setup(IDS.advertiser);
      expect(db.repository(AdvertiserTrackingEntity).save).toHaveBeenLastCalledWith(
        expect.objectContaining({ messageCode: 'tracking_not_supported', messageParams: {} })
      );
    });

    it('should say a platform that sets a tracking up but no goal waits, without a call', async (): Promise<void> => {
      declareGoogle({ setupGoal: undefined });
      seed();

      await service.setup(IDS.advertiser);

      expect(setupTracking).not.toHaveBeenCalled();
      expect(db.repository(AdvertiserTrackingEntity).save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'manual_required', messageCode: 'tracking_not_supported' })
      );
    });

    it("should log a failure that is not the platform's, and leave the account alone", async (): Promise<void> => {
      declareGoogle({ setupTracking: jest.fn().mockRejectedValue(new Error('socket hang up')) });
      seed({ trackings: [trackingRow()] });

      await expect(service.setup(IDS.advertiser)).resolves.toBeUndefined();

      expect(db.manager.update).not.toHaveBeenCalled();
    });

    it('should take an id one side leaves out for none', async (): Promise<void> => {
      declareGoogle();
      seed({
        trackings: [trackingRow()],
        refs: [refRow({ refs: { ...GOAL_REFS, extra: null }, syncedHash: 'older' })],
      });

      await service.setup(IDS.advertiser);

      expect(db.manager.find).not.toHaveBeenCalled();
    });

    it('should say a platform without tracking support waits, without a call', async (): Promise<void> => {
      adapters.microsoft = { platform: 'microsoft', connection: 'manager_link', apply: jest.fn() };
      seed({
        links: [linkRow(ACCOUNT_ID, 'microsoft'), linkRow(OTHER_ACCOUNT_ID, 'meta')],
        accounts: [accountRow({ platform: 'microsoft' }), accountRow({ id: OTHER_ACCOUNT_ID, platform: 'meta' })],
      });

      await service.setup(IDS.advertiser);

      expect(db.repository(AdvertiserTrackingEntity).save).toHaveBeenCalledWith(
        expect.objectContaining({
          adAccountId: ACCOUNT_ID,
          status: 'manual_required',
          messageCode: 'tracking_not_supported',
          messageParams: { platform: 'microsoft' },
        })
      );
      expect(db.repository(AdvertiserTrackingEntity).save).toHaveBeenCalledWith(
        expect.objectContaining({ adAccountId: OTHER_ACCOUNT_ID, messageParams: { platform: 'meta' } })
      );
    });

    it('should read the key of an account bringing its own, and skip one that has none yet', async (): Promise<void> => {
      declareGoogle({ connection: 'account_secret' });
      seed({
        links: [linkRow(), linkRow(OTHER_ACCOUNT_ID)],
        accounts: [
          accountRow({ secretName: 'omnipotent/accounts/1' }),
          accountRow({ id: OTHER_ACCOUNT_ID, secretName: null }),
        ],
        trackings: [trackingRow()],
      });

      await service.setup(IDS.advertiser);

      expect(secrets.get).toHaveBeenCalledWith('omnipotent/accounts/1');
      expect(setupTracking).toHaveBeenCalledTimes(1);
      expect(setupTracking).toHaveBeenCalledWith(
        expect.objectContaining({ credentials: 'the-key' }),
        expect.anything(),
        { tagId: 'AW-111' }
      );
    });

    it('should set nothing up on an account that is not active', async (): Promise<void> => {
      declareGoogle();
      seed({ accounts: [accountRow({ status: 'pending' })] });

      await service.setup(IDS.advertiser);

      expect(setupTracking).not.toHaveBeenCalled();
      expect(db.repository(ConversionGoalEntity).find).not.toHaveBeenCalled();
    });

    it('should do nothing for an Advertiser that is gone', async (): Promise<void> => {
      declareGoogle();
      seed({ advertiser: null });

      await service.setup(IDS.advertiser);

      expect(db.repository(AdvertiserAdAccountEntity).find).not.toHaveBeenCalled();
    });

    it('should do nothing while another worker sets the same Advertiser up', async (): Promise<void> => {
      declareGoogle();
      seed();
      db.runner.query.mockResolvedValue([{ locked: false }]);

      await service.setup(IDS.advertiser);

      expect(db.repository(AdvertiserEntity).findOneBy).not.toHaveBeenCalled();
      expect(db.runner.release).toHaveBeenCalled();
    });
  });

  describe('sweep', () => {
    it('should queue a setup of every Advertiser whose tracking waits for one', async (): Promise<void> => {
      db.mocks.query.mockResolvedValue([
        { advertiserId: IDS.advertiser },
        { advertiserId: 'd0000000-0000-4000-8000-000000000002' },
      ]);

      await service.sweep();

      expect(db.mocks.query).toHaveBeenCalledWith(expect.stringContaining('FROM "conversion_goals" g'), [
        ['pending', 'failed', 'manual_required'],
        'tracking_not_supported',
      ]);
      expect(scheduler.request.mock.calls).toEqual([[IDS.advertiser], ['d0000000-0000-4000-8000-000000000002']]);
    });
  });

  describe('JobQueueTrackingScheduler', () => {
    it('should queue a conversion setup of the Advertiser', async (): Promise<void> => {
      const send: jest.Mock = jest.fn().mockResolvedValue('job-id');

      await new JobQueueTrackingScheduler(send).request(IDS.advertiser);

      expect(send).toHaveBeenCalledWith(CONVERSION_SETUP_JOB_NAME, { advertiserId: IDS.advertiser });
    });
  });

  describe('plugin', () => {
    it('should decorate the instance with the service and its scheduler, on the job queue', async (): Promise<void> => {
      const jobQueue = { send: jest.fn().mockResolvedValue('job-id') };
      const app: FastifyInstance = await buildServiceApp([TrackingServicePlugin], {
        db,
        access,
        secrets,
        jobQueue,
      });

      expect(app.trackingService).toBeInstanceOf(TrackingService);
      await app.trackingScheduler.request(IDS.advertiser);
      expect(jobQueue.send).toHaveBeenCalledWith(CONVERSION_SETUP_JOB_NAME, { advertiserId: IDS.advertiser });

      await app.close();
    });
  });
});
