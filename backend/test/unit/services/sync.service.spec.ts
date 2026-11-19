import { FastifyInstance } from 'fastify';

import {
  AdAccountEntity,
  AdGroupEntity,
  AdvertiserAdAccountEntity,
  CampaignEntity,
  CreativeEntity,
  CreativeVersionEntity,
  ExternalIdHistoryEntity,
  KeywordEntity,
  LeverEntity,
  LineEntity,
  PlatformUnitEntity,
  TargetingGroupEntity,
} from '@src/database/entities';
import { ADAPTERS, ApplyResult, PlatformAdapter, PlatformError } from '@src/platforms/platform-adapter';
import { DesiredUnit } from '@src/platforms/desired-state';
import { PLATFORM_RULES, PlatformRules } from '@src/platforms/platform-rules';
import SyncServicePlugin, { JobQueueSyncScheduler, SyncService } from '@src/services/sync.service';
import { CampaignPlatformStatus, Platform, PlatformUnitView } from '@src/types';
import { AccessServiceMock, buildServiceApp, createAccessMock } from '@test/unit/mocks/access.mock';
import { IDS, JANE } from '@test/unit/mocks/auth.fixtures';
import { createDataSourceMock, DataSourceMock } from '@test/unit/mocks/data-source.mock';
import { createTreeStore, TreeStore } from '@test/unit/mocks/tree-store.mock';
import { errorCodeOf, statusCodeOf } from '@utils';

/** The ids the specs work with. */
const CAMPAIGN_ID = 'f1000000-0000-4000-8000-000000000001';
const LEVER_ID = 'f2000000-0000-4000-8000-000000000001';
const AD_GROUP_ID = 'f3000000-0000-4000-8000-000000000001';
const NODE_ID = 'f4000000-0000-4000-8000-000000000001';
const LINE_ID = 'f5000000-0000-4000-8000-000000000001';
const CREATIVE_ID = 'fe000000-0000-4000-8000-000000000001';
const VERSION_ID = 'fd000000-0000-4000-8000-000000000001';
const ACCOUNT_ID = 'ff000000-0000-4000-8000-000000000001';
const UNIT_ID = 'fc000000-0000-4000-8000-000000000001';
const KEYWORD_ID = 'fb000000-0000-4000-8000-000000000001';

/** A fixed instant, so a spec owns the clock. */
const NOW = new Date('2027-01-03T10:00:00.000Z');

/**
 * The rules a platform phase would declare: Hawk on DOOH, with the Search shape of the projection.
 *
 * @param overrides - What this case declares
 * @returns The rules
 */
function hawkRules(overrides: Partial<PlatformRules> = {}): PlatformRules {
  return {
    label: 'Hawk',
    targeting: ['country'],
    creatives: ['display:image'],
    projection: {
      levels: { campaign: null, lever: null, ad_group: 'campaign', targeting_group: 'ad_group', line: 'ad' },
      budgetLevel: 'ad_group',
    },
    requiresClickThroughUrl: false,
    requiresIabCategories: false,
    minDailyBudgetCents: 0,
    ...overrides,
  };
}

describe('Unit::Services::SyncService', () => {
  /** The registries, writable, so a spec declares a couple and an adapter as a phase would. */
  const registry: Record<string, Record<string, PlatformRules>> = PLATFORM_RULES as Record<
    string,
    Record<string, PlatformRules>
  >;
  const adapters: Partial<Record<Platform, PlatformAdapter>> = ADAPTERS as Partial<Record<Platform, PlatformAdapter>>;

  let store: TreeStore;
  let access: AccessServiceMock;
  let curves: { pacedDay: jest.Mock };
  let secrets: { get: jest.Mock };
  let scheduler: { request: jest.Mock };
  let apply: jest.Mock;
  let service: SyncService;

  /**
   * Seed a launched campaign: one lever on Hawk, one AdGroup, one TargetingGroup with a keyword, one
   * Line with a creative, and an active account with credentials.
   *
   * @param overrides - Rows to change, by entity
   * @returns Nothing
   */
  function seedTree(
    overrides: {
      campaign?: object;
      lever?: object;
      adGroup?: object;
      node?: object;
      line?: object;
      account?: object;
      link?: object | null;
    } = {}
  ): void {
    store.seed(CampaignEntity, [
      {
        id: CAMPAIGN_ID,
        organizationId: IDS.organization,
        advertiserId: IDS.advertiser,
        name: 'Automne',
        status: 'active',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        startsOn: '2027-01-01',
        endsOn: '2027-01-07',
        budgetCents: 100_000,
        capping: null,
        insertionOrderNumber: null,
        nextPacingAt: null,
        deletedAt: null,
        ...overrides.campaign,
      },
    ]);
    store.seed(LeverEntity, [
      {
        id: LEVER_ID,
        organizationId: IDS.organization,
        campaignId: CAMPAIGN_ID,
        lever: 'dooh',
        status: 'active',
        platformShares: [{ platform: 'hawk', shareBasisPoints: 10_000 }],
        budgetCents: null,
        startsOn: null,
        endsOn: null,
        capping: null,
        deletedAt: null,
        ...overrides.lever,
      },
    ]);
    store.seed(AdGroupEntity, [
      {
        id: AD_GROUP_ID,
        organizationId: IDS.organization,
        campaignId: CAMPAIGN_ID,
        leverId: LEVER_ID,
        lever: 'dooh',
        name: 'Grand Paris',
        status: 'active',
        budgetCents: null,
        bidAmountCents: null,
        platformShares: null,
        startsOn: null,
        endsOn: null,
        capping: null,
        deletedAt: null,
        ...overrides.adGroup,
      },
    ]);
    store.seed(TargetingGroupEntity, [
      {
        id: NODE_ID,
        organizationId: IDS.organization,
        campaignId: CAMPAIGN_ID,
        adGroupId: AD_GROUP_ID,
        lever: 'dooh',
        name: 'Île-de-France',
        status: 'active',
        targeting: { country: { include: ['FR'] } },
        budgetCents: null,
        bidAmountCents: null,
        capping: null,
        deletedAt: null,
        ...overrides.node,
      },
    ]);
    store.seed(LineEntity, [
      {
        id: LINE_ID,
        organizationId: IDS.organization,
        campaignId: CAMPAIGN_ID,
        targetingGroupId: NODE_ID,
        lever: 'dooh',
        name: 'Bannière',
        status: 'active',
        creativeId: CREATIVE_ID,
        landingPageUrl: 'https://example.test',
        trackers: null,
        budgetCents: null,
        startsOn: null,
        endsOn: null,
        capping: null,
        deletedAt: null,
        ...overrides.line,
      },
    ]);
    store.seed(KeywordEntity, [
      {
        id: KEYWORD_ID,
        organizationId: IDS.organization,
        campaignId: CAMPAIGN_ID,
        targetingGroupId: NODE_ID,
        text: 'lit chêne',
        matchType: 'exact',
        negative: false,
      },
    ]);
    store.seed(CreativeEntity, [
      {
        id: CREATIVE_ID,
        organizationId: IDS.organization,
        advertiserId: IDS.advertiser,
        name: 'Bannière 300x250',
        format: 'display',
        subtype: 'image',
        activeVersionId: VERSION_ID,
        deletedAt: null,
      },
    ]);
    store.seed(CreativeVersionEntity, [
      { id: VERSION_ID, organizationId: IDS.organization, creativeId: CREATIVE_ID, payload: { alt: 'Lit' } },
    ]);
    store.seed(AdAccountEntity, [
      {
        id: ACCOUNT_ID,
        organizationId: IDS.organization,
        platform: 'hawk',
        externalId: 'A1',
        name: 'Hawk',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        status: 'active',
        statusReason: null,
        scope: {},
        secretName: 'omnipotent/ad-account/1',
        deletedAt: null,
        ...overrides.account,
      },
    ]);
    if (overrides.link !== null) {
      store.seed(AdvertiserAdAccountEntity, [
        {
          id: 'ff000000-0000-4000-8000-000000000002',
          organizationId: IDS.organization,
          advertiserId: IDS.advertiser,
          platform: 'hawk',
          currency: 'EUR',
          adAccountId: ACCOUNT_ID,
          externalAdvertiserId: '555',
          deletedAt: null,
          ...overrides.link,
        },
      ]);
    }
  }

  /**
   * Seed one unit of the campaign.
   *
   * @param overrides - What this case declares
   * @returns Nothing
   */
  function seedUnit(overrides: Partial<PlatformUnitEntity> = {}): void {
    store.seed(PlatformUnitEntity, [
      {
        id: UNIT_ID,
        organizationId: IDS.organization,
        campaignId: CAMPAIGN_ID,
        leverId: LEVER_ID,
        adGroupId: AD_GROUP_ID,
        lever: 'dooh',
        platform: 'hawk',
        adAccountId: ACCOUNT_ID,
        fxRate: 1,
        refs: {},
        appliedStatus: null,
        syncState: 'pending',
        syncedHash: null,
        lastError: null,
        lastErrorCode: null,
        lastErrorParams: null,
        attempts: 0,
        nextAttemptAt: null,
        lastAttemptAt: null,
        lastSyncedAt: null,
        ...overrides,
      } as PlatformUnitEntity,
    ]);
  }

  /** The units, as the table now holds them. */
  function units(): PlatformUnitEntity[] {
    return store.rows(PlatformUnitEntity) as PlatformUnitEntity[];
  }

  beforeEach((): void => {
    jest.clearAllMocks();
    for (const platform of Object.keys(registry)) Reflect.deleteProperty(registry, platform);
    for (const platform of Object.keys(adapters)) Reflect.deleteProperty(adapters, platform);
    registry.hawk = { dooh: hawkRules() };
    apply = jest.fn(async (_context, desired: DesiredUnit): Promise<ApplyResult> => ({
      refs: Object.fromEntries(desired.objects.map((object, index: number) => [object.key, `x-${index}`])),
      appliedStatus: desired.status,
    }));
    adapters.hawk = { platform: 'hawk', connection: 'account_secret', apply };

    store = createTreeStore();
    access = createAccessMock();
    curves = { pacedDay: jest.fn().mockResolvedValue({ todayCents: 1_000, averageCents: 1_400 }) };
    secrets = { get: jest.fn().mockResolvedValue('sk-hawk') };
    scheduler = { request: jest.fn().mockResolvedValue(undefined) };
    service = new SyncService(
      store.dataSource as never,
      access as never,
      curves as never,
      secrets as never,
      scheduler as never,
      { maxBackoffMinutes: 60, sweepBatchSize: 500, pacingJitterMinutes: 30 },
      (): number => NOW.getTime(),
      (): number => 0.5
    );
  });

  afterEach((): void => {
    for (const platform of Object.keys(registry)) Reflect.deleteProperty(registry, platform);
    for (const platform of Object.keys(adapters)) Reflect.deleteProperty(adapters, platform);
  });

  describe('ensureUnits', () => {
    it('should create one unit per couple (AdGroup, platform)', async (): Promise<void> => {
      seedTree();

      await service.syncCampaign(CAMPAIGN_ID);

      expect(units()).toHaveLength(1);
      expect(units()[0]).toMatchObject({
        campaignId: CAMPAIGN_ID,
        leverId: LEVER_ID,
        adGroupId: AD_GROUP_ID,
        lever: 'dooh',
        platform: 'hawk',
        adAccountId: ACCOUNT_ID,
        fxRate: 1,
      });
    });

    it('should create nothing for a platform the brand has no account on', async (): Promise<void> => {
      seedTree({ link: null });

      await service.syncCampaign(CAMPAIGN_ID);

      expect(units()).toEqual([]);
    });

    it('should create nothing for a couple no phase has landed', async (): Promise<void> => {
      Reflect.deleteProperty(registry, 'hawk');
      seedTree();

      await service.syncCampaign(CAMPAIGN_ID);

      expect(units()).toEqual([]);
    });

    it('should follow the distribution key of the AdGroup when it carries one', async (): Promise<void> => {
      registry.dv360 = { dooh: hawkRules({ label: 'DV360' }) };
      seedTree({
        lever: { platformShares: [{ platform: 'dv360', shareBasisPoints: 10_000 }] },
        adGroup: { platformShares: [{ platform: 'hawk', shareBasisPoints: 10_000 }] },
      });

      await service.syncCampaign(CAMPAIGN_ID);

      // The AdGroup buys on Hawk although its lever names DV360: the key of the AdGroup wins.
      expect(units().map((unit: PlatformUnitEntity): string => unit.platform)).toEqual(['hawk']);
    });

    it('should create nothing a second time', async (): Promise<void> => {
      seedTree();

      await service.syncCampaign(CAMPAIGN_ID);
      await service.syncCampaign(CAMPAIGN_ID);

      expect(units()).toHaveLength(1);
    });
  });

  describe('syncCampaign', () => {
    it('should apply the desired state of a unit that has something to apply', async (): Promise<void> => {
      seedTree();
      seedUnit();

      await service.syncCampaign(CAMPAIGN_ID);

      expect(apply).toHaveBeenCalledTimes(1);
      const [context, desired, refs] = apply.mock.calls[0] as [
        { credentials: string; externalId: string; externalAdvertiserId: string },
        DesiredUnit,
        Record<string, string>,
      ];
      expect(context).toMatchObject({
        platform: 'hawk',
        externalId: 'A1',
        externalAdvertiserId: '555',
        currency: 'EUR',
        credentials: 'sk-hawk',
      });
      expect(desired.objects.map((object): string => object.key)).toEqual([
        `ad_group:${AD_GROUP_ID}`,
        `targeting_group:${NODE_ID}`,
        `keyword:${KEYWORD_ID}`,
        `line:${LINE_ID}`,
      ]);
      expect(refs).toEqual({});
      expect(units()[0]).toMatchObject({ syncState: 'synced', attempts: 0, nextAttemptAt: null });
      expect(units()[0].syncedHash).toHaveLength(64);
    });

    it('should apply a unit of a platform whose credentials are ours, with no secret of the account', async (): Promise<void> => {
      // A `manager_link` platform: our manager account manages theirs, so the account carries no
      // secret, and the adapter reads ours itself (`docs/phase-10.md` § 4.1).
      adapters.hawk = { platform: 'hawk', connection: 'manager_link', apply };
      seedTree({ account: { secretName: null } });
      seedUnit();

      await service.syncCampaign(CAMPAIGN_ID);

      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply.mock.calls[0][0]).toMatchObject({ platform: 'hawk', credentials: null });
      expect(secrets.get).not.toHaveBeenCalled();
      expect(units()[0]).toMatchObject({ syncState: 'synced' });
    });

    it('should not read a secret an account of a manager_link platform happens to name', async (): Promise<void> => {
      adapters.hawk = { platform: 'hawk', connection: 'manager_link', apply };
      seedTree();
      seedUnit();

      await service.syncCampaign(CAMPAIGN_ID);

      expect(apply.mock.calls[0][0]).toMatchObject({ credentials: null });
      expect(secrets.get).not.toHaveBeenCalled();
    });

    it('should make no call at all when nothing changed', async (): Promise<void> => {
      seedTree();
      seedUnit();
      await service.syncCampaign(CAMPAIGN_ID);
      apply.mockClear();
      secrets.get.mockClear();

      await service.syncCampaign(CAMPAIGN_ID);

      // The fingerprint is equal, so neither the platform nor the secret store is touched.
      expect(apply).not.toHaveBeenCalled();
      expect(secrets.get).not.toHaveBeenCalled();
    });

    it('should apply a change once, however many modifications caused it', async (): Promise<void> => {
      seedTree();
      seedUnit();
      await service.syncCampaign(CAMPAIGN_ID);
      const first: string = units()[0].syncedHash as string;
      apply.mockClear();

      // Two modifications in the same window mark the same bit, and one sync applies both.
      (store.rows(LineEntity)[0] as { name: string }).name = 'Bannière 2';
      (store.rows(TargetingGroupEntity)[0] as { name: string }).name = 'Paris';
      await store.manager.update(PlatformUnitEntity, { id: UNIT_ID }, { syncState: 'pending' });

      await service.syncCampaign(CAMPAIGN_ID);

      expect(apply).toHaveBeenCalledTimes(1);
      expect(units()[0].syncedHash).not.toBe(first);
    });

    it('should leave a draft alone: there is nothing over there to reconcile', async (): Promise<void> => {
      seedTree({ campaign: { status: 'draft' } });
      seedUnit();

      await service.syncCampaign(CAMPAIGN_ID);

      expect(apply).not.toHaveBeenCalled();
      expect(units()).toHaveLength(1);
    });

    it('should do nothing for a campaign that is gone', async (): Promise<void> => {
      await service.syncCampaign(CAMPAIGN_ID);

      expect(apply).not.toHaveBeenCalled();
    });

    it('should do nothing when another worker holds the campaign lock', async (): Promise<void> => {
      seedTree();
      seedUnit();
      store.setLocked(false);

      await service.syncCampaign(CAMPAIGN_ID);

      // The other worker is doing the same work from the same database, and the sweep catches what
      // it leaves: waiting would only tie up a worker to do nothing twice.
      expect(apply).not.toHaveBeenCalled();
    });

    it('should keep the units of an ended campaign, and apply them', async (): Promise<void> => {
      seedTree({ campaign: { status: 'ended' } });
      seedUnit();

      await service.syncCampaign(CAMPAIGN_ID);

      // Everything over there must go to pause, which is a change like any other.
      expect(apply).toHaveBeenCalledTimes(1);
      expect((apply.mock.calls[0] as [unknown, DesiredUnit])[1].status).toBe('paused');
    });

    it('should not create units for an ended campaign that never had any', async (): Promise<void> => {
      seedTree({ campaign: { status: 'ended' } });

      await service.syncCampaign(CAMPAIGN_ID);

      expect(units()).toEqual([]);
    });

    it('should keep a unit pending when the platform did not take the status asked for', async (): Promise<void> => {
      seedTree();
      seedUnit();
      apply.mockResolvedValue({ refs: {}, appliedStatus: 'paused' });

      await service.syncCampaign(CAMPAIGN_ID);

      // A platform that reviews before activating leaves it waiting; the fingerprint is written all
      // the same, so the wait costs no further call until something changes.
      expect(units()[0]).toMatchObject({ syncState: 'pending', appliedStatus: 'paused' });
      expect(units()[0].syncedHash).toHaveLength(64);
    });

    it.each([
      ['no account at all', { account: { id: 'other' } }],
      ['an account that was disconnected', { account: { deletedAt: new Date() } }],
      ['an account whose link is still pending', { account: { status: 'pending' } }],
      ['an account with no credentials', { account: { secretName: null } }],
    ])('should skip a unit with %s', async (_label: string, overrides: object): Promise<void> => {
      seedTree(overrides);
      seedUnit();

      await service.syncCampaign(CAMPAIGN_ID);

      expect(apply).not.toHaveBeenCalled();
      expect(units()[0].syncState).toBe('pending');
    });

    it('should skip a unit whose brand no longer buys on that platform', async (): Promise<void> => {
      seedTree({ link: null });
      seedUnit();

      // The link is what names the sub-advertiser to buy for: without it there is nothing to send.
      await service.syncCampaign(CAMPAIGN_ID);

      expect(apply).not.toHaveBeenCalled();
    });

    it('should skip a unit whose AdGroup is gone', async (): Promise<void> => {
      seedTree({ adGroup: { deletedAt: new Date() } });
      seedUnit();

      await service.syncCampaign(CAMPAIGN_ID);

      expect(apply).not.toHaveBeenCalled();
    });

    it('should pause a unit whose day has nothing left to spend', async (): Promise<void> => {
      seedTree();
      seedUnit();
      curves.pacedDay.mockResolvedValue({ todayCents: 0, averageCents: 1_400 });

      await service.syncCampaign(CAMPAIGN_ID);

      // The pacing answers 0 once the planned total is spent: nothing must deliver on such a day.
      expect((apply.mock.calls[0] as [unknown, DesiredUnit])[1].status).toBe('paused');
    });

    it('should pause a unit whose window has not come', async (): Promise<void> => {
      seedTree({ campaign: { startsOn: '2027-02-01', endsOn: '2027-02-07' } });
      seedUnit();

      await service.syncCampaign(CAMPAIGN_ID);

      expect((apply.mock.calls[0] as [unknown, DesiredUnit])[1].status).toBe('paused');
    });

    it('should send a paused node, and everything under it, paused', async (): Promise<void> => {
      seedTree({ node: { status: 'paused' } });
      seedUnit();

      await service.syncCampaign(CAMPAIGN_ID);

      const desired: DesiredUnit = (apply.mock.calls[0] as [unknown, DesiredUnit])[1];
      expect(desired.objects.map((object): [string, string] => [object.level, object.status])).toEqual([
        ['ad_group', 'active'],
        ['targeting_group', 'paused'],
        ['targeting_group', 'paused'],
        ['line', 'paused'],
      ]);
      // The unit itself stays active: its AdGroup delivers, this branch of it does not.
      expect(desired.status).toBe('active');
    });

    it('should send a Line whose creative was deleted without one', async (): Promise<void> => {
      seedTree();
      seedUnit();
      (store.rows(CreativeEntity)[0] as { deletedAt: Date | null }).deletedAt = new Date();

      await service.syncCampaign(CAMPAIGN_ID);

      // The preview refuses the launch over it; a campaign already live simply keeps what it had.
      const desired: DesiredUnit = (apply.mock.calls[0] as [unknown, DesiredUnit])[1];
      expect(desired.objects.find((object): boolean => object.level === 'line')?.creative).toBeNull();
    });

    it('should send a Line whose creative has no delivering version without one', async (): Promise<void> => {
      seedTree();
      seedUnit();
      (store.rows(CreativeEntity)[0] as { activeVersionId: string | null }).activeVersionId = null;

      await service.syncCampaign(CAMPAIGN_ID);

      const desired: DesiredUnit = (apply.mock.calls[0] as [unknown, DesiredUnit])[1];
      expect(desired.objects.find((object): boolean => object.level === 'line')?.creative).toBeNull();
    });

    it('should send the negative keywords with the positive ones, in a stable order', async (): Promise<void> => {
      seedTree();
      seedUnit();
      store.seed(KeywordEntity, [
        {
          id: 'fb000000-0000-4000-8000-000000000000',
          organizationId: IDS.organization,
          campaignId: CAMPAIGN_ID,
          targetingGroupId: NODE_ID,
          text: 'lit gratuit',
          matchType: 'broad',
          negative: true,
        },
      ]);

      await service.syncCampaign(CAMPAIGN_ID);

      const desired: DesiredUnit = (apply.mock.calls[0] as [unknown, DesiredUnit])[1];
      // Sorted on our ids: two reads that answered the same keywords in another order must not look
      // like a change and cost a call.
      expect(
        desired.objects
          .filter((object): boolean => object.keywordId !== null)
          .map((object): string | undefined => object.keyword?.text)
      ).toEqual(['lit gratuit', 'lit chêne']);
    });

    it('should send a TargetingGroup that carries no keyword', async (): Promise<void> => {
      seedTree();
      seedUnit();
      await store.manager.delete(KeywordEntity, { id: KEYWORD_ID });

      await service.syncCampaign(CAMPAIGN_ID);

      const desired: DesiredUnit = (apply.mock.calls[0] as [unknown, DesiredUnit])[1];
      expect(desired.objects.some((object): boolean => object.object === 'keyword')).toBe(false);
    });

    it('should refuse definitively a platform with no adapter', async (): Promise<void> => {
      seedTree();
      seedUnit();
      Reflect.deleteProperty(adapters, 'hawk');

      await service.syncCampaign(CAMPAIGN_ID);

      expect(units()[0]).toMatchObject({
        syncState: 'error',
        lastErrorCode: 'sync_adapter_missing',
        lastErrorParams: { platform: 'hawk' },
        // No amount of retrying writes code, so nothing is scheduled.
        nextAttemptAt: null,
        attempts: 1,
      });
    });

    it('should wait while a temporary failure is not due again', async (): Promise<void> => {
      seedTree();
      seedUnit({ syncState: 'error', nextAttemptAt: new Date(NOW.getTime() + 60_000), attempts: 1 });

      await service.syncCampaign(CAMPAIGN_ID);

      expect(apply).not.toHaveBeenCalled();
    });

    it('should try a temporary failure again once it is due', async (): Promise<void> => {
      seedTree();
      seedUnit({ syncState: 'error', nextAttemptAt: new Date(NOW.getTime() - 1), attempts: 1 });

      await service.syncCampaign(CAMPAIGN_ID);

      expect(apply).toHaveBeenCalledTimes(1);
      expect(units()[0].syncState).toBe('synced');
    });

    it('should never try a definitive failure again on its own', async (): Promise<void> => {
      seedTree();
      seedUnit({ syncState: 'error', nextAttemptAt: null, attempts: 1 });

      await service.syncCampaign(CAMPAIGN_ID);

      expect(apply).not.toHaveBeenCalled();
    });
  });

  describe('the failures', () => {
    it('should double the delay of a temporary failure, up to the ceiling', async (): Promise<void> => {
      seedTree();
      seedUnit({ attempts: 2 });
      apply.mockRejectedValue(
        new PlatformError('hawk', 'Too many requests', {
          statusCode: 429,
          retryable: true,
          invalidCredentials: false,
          requestId: 'r-1',
        })
      );

      await service.syncCampaign(CAMPAIGN_ID);

      // Third attempt: two to the power of two, four minutes.
      expect(units()[0]).toMatchObject({ syncState: 'error', attempts: 3, lastError: 'Too many requests' });
      expect((units()[0].nextAttemptAt as Date).getTime()).toBe(NOW.getTime() + 4 * 60_000);
    });

    it('should cap the delay at the configured ceiling', async (): Promise<void> => {
      seedTree();
      seedUnit({ attempts: 20 });
      apply.mockRejectedValue(
        new PlatformError('hawk', 'Boom', {
          statusCode: 503,
          retryable: true,
          invalidCredentials: false,
          requestId: null,
        })
      );

      await service.syncCampaign(CAMPAIGN_ID);

      expect((units()[0].nextAttemptAt as Date).getTime()).toBe(NOW.getTime() + 60 * 60_000);
    });

    it('should not schedule anything for a failure the platform called definitive', async (): Promise<void> => {
      seedTree();
      seedUnit();
      apply.mockRejectedValue(
        new PlatformError('hawk', 'Unknown field [BAD_FIELD]', {
          statusCode: 400,
          retryable: false,
          invalidCredentials: false,
          requestId: null,
        })
      );

      await service.syncCampaign(CAMPAIGN_ID);

      expect(units()[0]).toMatchObject({ syncState: 'error', nextAttemptAt: null, lastErrorCode: null });
    });

    it('should keep our own code and its values when we worded the message', async (): Promise<void> => {
      seedTree();
      seedUnit();
      apply.mockRejectedValue(
        new PlatformError('hawk', 'The order has no political declaration', {
          statusCode: 400,
          retryable: false,
          invalidCredentials: false,
          requestId: null,
          messageCode: 'hawk_political_required',
          messageParams: { field: 'sponsor' },
        })
      );

      await service.syncCampaign(CAMPAIGN_ID);

      expect(units()[0]).toMatchObject({
        lastErrorCode: 'hawk_political_required',
        lastErrorParams: { field: 'sponsor' },
      });
    });

    it('should keep our code even when its message has no values', async (): Promise<void> => {
      seedTree();
      seedUnit();
      apply.mockRejectedValue(
        new PlatformError('hawk', 'The account is not ready', {
          statusCode: 400,
          retryable: false,
          invalidCredentials: false,
          requestId: null,
          messageCode: 'hawk_account_not_ready',
        })
      );

      await service.syncCampaign(CAMPAIGN_ID);

      expect(units()[0]).toMatchObject({ lastErrorCode: 'hawk_account_not_ready', lastErrorParams: {} });
    });

    it('should invalidate the account when the platform refused its key', async (): Promise<void> => {
      seedTree();
      seedUnit();
      apply.mockRejectedValue(
        new PlatformError('hawk', 'Unauthorized', {
          statusCode: 401,
          retryable: false,
          invalidCredentials: true,
          requestId: null,
        })
      );

      await service.syncCampaign(CAMPAIGN_ID);

      // It stops every unit of that account, not just this one: an admin has to act.
      expect(store.rows(AdAccountEntity)[0]).toMatchObject({
        status: 'invalid',
        statusReason: 'credentials_rejected',
      });
    });

    it.each([
      ['alone', false],
      ['even when the platform also called the key refused', true],
    ])(
      'should leave the account alone when our own credentials failed, %s',
      async (_label: string, invalidCredentials: boolean): Promise<void> => {
        seedTree();
        seedUnit({ attempts: 1 });
        apply.mockRejectedValue(
          new PlatformError('hawk', 'The service account key was revoked', {
            statusCode: 401,
            retryable: false,
            invalidCredentials,
            ownCredentials: true,
            requestId: null,
          })
        );

        await service.syncCampaign(CAMPAIGN_ID);

        // The client did nothing and can do nothing: the account stays usable, and the unit keeps
        // trying, so that it resumes on its own once an operator mends our credentials.
        expect(store.rows(AdAccountEntity)[0]).toMatchObject({ status: 'active' });
        expect(units()[0]).toMatchObject({
          syncState: 'error',
          attempts: 2,
          lastErrorCode: 'sync_platform_credentials_failed',
          lastErrorParams: { platform: 'hawk' },
        });
        expect((units()[0].nextAttemptAt as Date).getTime()).toBe(NOW.getTime() + 2 * 60_000);
      }
    );

    it('should treat a failure of ours as definitive, with its own code', async (): Promise<void> => {
      seedTree();
      seedUnit();
      secrets.get.mockRejectedValue(
        Object.assign(new Error('Secret is missing'), { statusCode: 500, errorCode: 'secret_missing' })
      );

      await service.syncCampaign(CAMPAIGN_ID);

      expect(units()[0]).toMatchObject({
        syncState: 'error',
        lastErrorCode: 'secret_missing',
        nextAttemptAt: null,
      });
    });

    it('should record a failure that is not an Error at all', async (): Promise<void> => {
      seedTree();
      seedUnit();
      apply.mockRejectedValue('the adapter threw a string');

      await service.syncCampaign(CAMPAIGN_ID);

      expect(units()[0]).toMatchObject({ syncState: 'error', lastError: 'the adapter threw a string' });
    });
  });

  describe('the trail of the platform ids', () => {
    it('should write nothing when an object gets its first id', async (): Promise<void> => {
      seedTree();
      seedUnit();

      await service.syncCampaign(CAMPAIGN_ID);

      // No id, then an id, is not a change (R5).
      expect(store.rows(ExternalIdHistoryEntity)).toEqual([]);
      expect(units()[0].refs).toMatchObject({ [`ad_group:${AD_GROUP_ID}`]: 'x-0' });
    });

    it('should write one row per id that changed, and keep what it was', async (): Promise<void> => {
      seedTree();
      seedUnit({ refs: { [`ad_group:${AD_GROUP_ID}`]: 'old-campaign' }, syncState: 'pending' });

      await service.syncCampaign(CAMPAIGN_ID);

      expect(store.rows(ExternalIdHistoryEntity)).toEqual([
        expect.objectContaining({
          organizationId: IDS.organization,
          platformUnitId: UNIT_ID,
          platform: 'hawk',
          level: 'ad_group',
          nodeId: AD_GROUP_ID,
          refKey: `ad_group:${AD_GROUP_ID}`,
          previousExternalId: 'old-campaign',
          externalId: 'x-0',
        }),
      ]);
    });

    it('should write nothing for an id that did not move', async (): Promise<void> => {
      seedTree();
      seedUnit({ refs: { [`ad_group:${AD_GROUP_ID}`]: 'x-0' }, syncState: 'pending' });

      await service.syncCampaign(CAMPAIGN_ID);

      expect(store.rows(ExternalIdHistoryEntity)).toEqual([]);
    });

    it('should write nothing for an object the platform no longer answers for', async (): Promise<void> => {
      seedTree();
      seedUnit({ refs: { [`ad_group:${AD_GROUP_ID}`]: 'old' }, syncState: 'pending' });
      apply.mockResolvedValue({ refs: {}, appliedStatus: 'active' });

      await service.syncCampaign(CAMPAIGN_ID);

      expect(store.rows(ExternalIdHistoryEntity)).toEqual([]);
    });

    it('should name no node for a keyword, which is not one', async (): Promise<void> => {
      seedTree();
      seedUnit({ refs: { [`keyword:${KEYWORD_ID}`]: 'old-keyword' }, syncState: 'pending' });

      await service.syncCampaign(CAMPAIGN_ID);

      expect(store.rows(ExternalIdHistoryEntity)[0]).toMatchObject({
        refKey: `keyword:${KEYWORD_ID}`,
        nodeId: null,
        previousExternalId: 'old-keyword',
      });
    });
  });

  describe('sweep', () => {
    it('should queue one sync per campaign that has a unit waiting', async (): Promise<void> => {
      seedUnit({ syncState: 'pending' });
      seedUnit({ id: 'u2', syncState: 'pending' });
      seedUnit({ id: 'u3', campaignId: 'other', syncState: 'pending' });

      await service.sweep();

      expect(scheduler.request).toHaveBeenCalledTimes(2);
      expect(scheduler.request).toHaveBeenCalledWith(CAMPAIGN_ID);
      expect(scheduler.request).toHaveBeenCalledWith('other');
    });

    it('should take a temporary failure that is due', async (): Promise<void> => {
      seedUnit({ syncState: 'error', nextAttemptAt: new Date(NOW.getTime() - 1) });

      await service.sweep();

      expect(scheduler.request).toHaveBeenCalledWith(CAMPAIGN_ID);
    });

    it('should leave alone what is synced, what is not due, and what is definitive', async (): Promise<void> => {
      seedUnit({ syncState: 'synced' });
      seedUnit({ id: 'u2', syncState: 'error', nextAttemptAt: new Date(NOW.getTime() + 60_000) });
      seedUnit({ id: 'u3', syncState: 'error', nextAttemptAt: null });

      await service.sweep();

      expect(scheduler.request).not.toHaveBeenCalled();
    });
  });

  describe('refreshPacing', () => {
    it('should mark a campaign whose own midnight has passed, and move its appointment', async (): Promise<void> => {
      seedTree({ campaign: { nextPacingAt: new Date(NOW.getTime() - 1) } });
      seedUnit({ syncState: 'synced' });

      await service.refreshPacing();

      expect(units()[0].syncState).toBe('pending');
      expect(scheduler.request).toHaveBeenCalledWith(CAMPAIGN_ID);
      // Next local midnight in Paris, plus half of the configured jitter.
      const appointment: Date = (store.rows(CampaignEntity)[0] as { nextPacingAt: Date }).nextPacingAt;
      expect(appointment.toISOString()).toBe('2027-01-03T23:15:00.000Z');
    });

    it('should leave a campaign whose appointment is not due', async (): Promise<void> => {
      seedTree({ campaign: { nextPacingAt: new Date(NOW.getTime() + 60_000) } });

      await service.refreshPacing();

      expect(scheduler.request).not.toHaveBeenCalled();
    });

    it('should fall back to UTC for a campaign with no timezone of its own', async (): Promise<void> => {
      seedTree({ campaign: { timezone: null, nextPacingAt: new Date(NOW.getTime() - 1) } });

      await service.refreshPacing();

      const appointment: Date = (store.rows(CampaignEntity)[0] as { nextPacingAt: Date }).nextPacingAt;
      expect(appointment.toISOString()).toBe('2027-01-04T00:15:00.000Z');
    });
  });

  describe('endCampaigns', () => {
    it('should end the campaigns past their last day, and tell the platforms', async (): Promise<void> => {
      seedUnit({ syncState: 'synced' });
      // The shape the driver really answers for an `UPDATE … RETURNING`: the rows, then their count.
      store.query.mockResolvedValue([[{ id: CAMPAIGN_ID }], 1]);

      await service.endCampaigns();

      expect(store.query).toHaveBeenCalledWith(expect.stringContaining('AT TIME ZONE COALESCE(timezone'));
      expect(units()[0].syncState).toBe('pending');
      expect(scheduler.request).toHaveBeenCalledWith(CAMPAIGN_ID);
    });

    it('should queue nothing when no campaign ended', async (): Promise<void> => {
      store.query.mockResolvedValue([[], 0]);

      await service.endCampaigns();

      expect(scheduler.request).not.toHaveBeenCalled();
    });
  });

  describe('platformStatus', () => {
    it('should say what exists over there and what is still to be created', async (): Promise<void> => {
      seedTree();
      seedUnit({ refs: { [`ad_group:${AD_GROUP_ID}`]: 'HAWK-1' }, syncState: 'pending' });

      const status: CampaignPlatformStatus = await service.platformStatus(JANE, IDS.organization, CAMPAIGN_ID);

      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
      expect(status).toMatchObject({ campaignId: CAMPAIGN_ID, pending: 1 });
      expect(status.units[0]).toMatchObject({
        id: UNIT_ID,
        platform: 'hawk',
        lever: 'dooh',
        adGroupId: AD_GROUP_ID,
        adAccountId: ACCOUNT_ID,
        currency: 'EUR',
        state: 'pending',
      });
      expect(status.units[0].objects).toEqual([
        {
          key: `ad_group:${AD_GROUP_ID}`,
          level: 'ad_group',
          nodeId: AD_GROUP_ID,
          keywordId: null,
          object: 'campaign',
          externalId: 'HAWK-1',
        },
        expect.objectContaining({ key: `targeting_group:${NODE_ID}`, externalId: null }),
        expect.objectContaining({ key: `keyword:${KEYWORD_ID}`, keywordId: KEYWORD_ID, externalId: null }),
        expect.objectContaining({ key: `line:${LINE_ID}`, externalId: null }),
      ]);
    });

    it('should show the objects the platform makes of our campaign too', async (): Promise<void> => {
      registry.hawk = {
        dooh: hawkRules({
          projection: {
            levels: {
              campaign: 'media_plan',
              lever: null,
              ad_group: 'order',
              targeting_group: 'line_item',
              line: 'creative',
            },
            budgetLevel: 'ad_group',
          },
        }),
      };
      seedTree();
      seedUnit({ refs: { [`campaign:${CAMPAIGN_ID}`]: 'MP-1' } });

      const status: CampaignPlatformStatus = await service.platformStatus(JANE, IDS.organization, CAMPAIGN_ID);

      // The mediaplan is this unit's ancestor over there, and the unit carries its id.
      expect(status.units[0].objects[0]).toMatchObject({
        key: `campaign:${CAMPAIGN_ID}`,
        object: 'media_plan',
        externalId: 'MP-1',
      });
    });

    it('should answer no object for a couple whose phase has not landed', async (): Promise<void> => {
      seedTree();
      seedUnit();
      Reflect.deleteProperty(registry, 'hawk');

      const status: CampaignPlatformStatus = await service.platformStatus(JANE, IDS.organization, CAMPAIGN_ID);

      expect(status.units[0].objects).toEqual([]);
    });

    it('should answer no object for a unit whose lever is gone', async (): Promise<void> => {
      seedTree({ lever: { deletedAt: new Date() } });
      seedUnit();

      const status: CampaignPlatformStatus = await service.platformStatus(JANE, IDS.organization, CAMPAIGN_ID);

      expect(status.units[0].objects).toEqual([]);
    });

    it('should answer no object for a unit whose AdGroup is gone', async (): Promise<void> => {
      seedTree({ adGroup: { deletedAt: new Date() } });
      seedUnit();

      const status: CampaignPlatformStatus = await service.platformStatus(JANE, IDS.organization, CAMPAIGN_ID);

      expect(status.units[0].objects).toEqual([]);
    });

    it('should carry when a unit was last applied', async (): Promise<void> => {
      seedTree();
      seedUnit({
        syncState: 'synced',
        lastAttemptAt: new Date('2027-01-03T10:00:00.000Z'),
        lastSyncedAt: new Date('2027-01-03T10:00:00.000Z'),
      });

      const status: CampaignPlatformStatus = await service.platformStatus(JANE, IDS.organization, CAMPAIGN_ID);

      expect(status).toMatchObject({ pending: 0 });
      expect(status.units[0]).toMatchObject({
        state: 'synced',
        lastSyncedAt: '2027-01-03T10:00:00.000Z',
        errorCode: null,
      });
    });

    it('should carry the error of a unit, with its code and its values', async (): Promise<void> => {
      seedTree();
      seedUnit({
        syncState: 'error',
        lastError: 'Unauthorized',
        lastErrorCode: 'hawk_unauthorized',
        lastErrorParams: { account: 'A1' },
        attempts: 2,
        nextAttemptAt: new Date('2027-01-03T10:04:00.000Z'),
        lastAttemptAt: new Date('2027-01-03T10:00:00.000Z'),
        lastSyncedAt: null,
      });

      const status: CampaignPlatformStatus = await service.platformStatus(JANE, IDS.organization, CAMPAIGN_ID);

      expect(status.units[0]).toMatchObject({
        state: 'error',
        attempts: 2,
        nextAttemptAt: '2027-01-03T10:04:00.000Z',
        lastAttemptAt: '2027-01-03T10:00:00.000Z',
        lastSyncedAt: null,
        errorCode: 'hawk_unauthorized',
        errorParams: { account: 'A1' },
        errorMessage: 'Unauthorized',
      });
    });

    it('should refuse a campaign the caller cannot see', async (): Promise<void> => {
      await expect(service.platformStatus(JANE, IDS.organization, CAMPAIGN_ID)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('should fall back to the campaign currency when the account is gone', async (): Promise<void> => {
      seedTree({ account: { id: 'other' } });
      seedUnit();

      const status: CampaignPlatformStatus = await service.platformStatus(JANE, IDS.organization, CAMPAIGN_ID);

      expect(status.units[0].currency).toBe('EUR');
    });
  });

  describe('requestSync', () => {
    it('should mark the units and queue the work', async (): Promise<void> => {
      seedTree();
      seedUnit({ syncState: 'synced' });

      await expect(service.requestSync(JANE, IDS.organization, CAMPAIGN_ID)).resolves.toEqual({
        campaignId: CAMPAIGN_ID,
        units: 1,
      });
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'manager');
      expect(scheduler.request).toHaveBeenCalledWith(CAMPAIGN_ID);
    });

    it('should refuse a draft, which has nothing over there', async (): Promise<void> => {
      seedTree({ campaign: { status: 'draft' } });

      let error: unknown;
      try {
        await service.requestSync(JANE, IDS.organization, CAMPAIGN_ID);
      } catch (thrown: unknown) {
        error = thrown;
      }

      expect(statusCodeOf(error)).toBe(400);
      expect(errorCodeOf(error)).toEqual({ code: 'sync_campaign_not_launched', params: {} });
    });
  });

  describe('retry', () => {
    it('should clear the backoff of one unit and queue the work', async (): Promise<void> => {
      seedTree();
      seedUnit({ syncState: 'error', attempts: 5, nextAttemptAt: null, lastErrorCode: 'hawk_unauthorized' });

      const unit: PlatformUnitView = await service.retry(JANE, IDS.organization, CAMPAIGN_ID, UNIT_ID);

      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'manager');
      expect(unit).toMatchObject({ id: UNIT_ID, state: 'pending', attempts: 0, nextAttemptAt: null });
      expect(units()[0]).toMatchObject({ syncState: 'pending', attempts: 0 });
      expect(scheduler.request).toHaveBeenCalledWith(CAMPAIGN_ID);
    });

    it('should refuse a unit of another campaign', async (): Promise<void> => {
      seedTree();
      seedUnit({ campaignId: 'other' });

      let error: unknown;
      try {
        await service.retry(JANE, IDS.organization, CAMPAIGN_ID, UNIT_ID);
      } catch (thrown: unknown) {
        error = thrown;
      }

      expect(statusCodeOf(error)).toBe(404);
      expect(errorCodeOf(error)).toEqual({ code: 'platform_unit_not_found', params: {} });
    });
  });

  describe('JobQueueSyncScheduler', () => {
    it('should send the campaign on the sync queue', async (): Promise<void> => {
      const send: jest.Mock = jest.fn().mockResolvedValue('job-1');

      await new JobQueueSyncScheduler(send).request(CAMPAIGN_ID);

      expect(send).toHaveBeenCalledWith('sync.campaign', { campaignId: CAMPAIGN_ID });
    });
  });

  describe('SyncServicePlugin', () => {
    it('should decorate the instance with the engine and its scheduler', async (): Promise<void> => {
      const db: DataSourceMock = createDataSourceMock();
      const jobQueue = { send: jest.fn().mockResolvedValue('job-1') };
      const app: FastifyInstance = await buildServiceApp([SyncServicePlugin], {
        db,
        access: createAccessMock(),
        curves: { pacedDay: jest.fn() },
        secrets: { get: jest.fn() },
        jobQueue,
      });

      expect(app.syncService).toBeInstanceOf(SyncService);
      await app.syncScheduler.request(CAMPAIGN_ID);
      expect(jobQueue.send).toHaveBeenCalledWith('sync.campaign', { campaignId: CAMPAIGN_ID });
      await app.close();
    });
  });
});
