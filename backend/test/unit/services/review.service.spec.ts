import { FastifyInstance } from 'fastify';

import { AdAccountEntity, PlatformUnitEntity } from '@src/database/entities';
import { AccountContext, ADAPTERS, PlatformAdapter, PlatformError } from '@src/platforms/platform-adapter';
import ReviewServicePlugin, {
  isAdKey,
  reviewsAfterApply,
  reviewsAfterRead,
  ReviewService,
} from '@src/services/review.service';
import { AdReview, Platform } from '@src/types';
import { buildServiceApp, createAccessMock } from '@test/unit/mocks/access.mock';
import { createDataSourceMock, DataSourceMock, QueryBuilderMock } from '@test/unit/mocks/data-source.mock';

/** A fixed instant, so a spec owns the clock. */
const NOW: Date = new Date('2027-01-03T10:00:00.000Z');

/** The accounts the specs read. */
const ACCOUNT_ID = 'ff000000-0000-4000-8000-000000000001';
const OTHER_ACCOUNT_ID = 'ff000000-0000-4000-8000-000000000002';

/** Verdicts the specs hand around. */
const APPROVED: AdReview = { status: 'approved', reasons: [] };
const PENDING: AdReview = { status: 'pending', reasons: [] };
const REJECTED: AdReview = { status: 'rejected', reasons: ['ALCOHOL'] };

/**
 * A unit as its row stands.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function unit(overrides: Partial<PlatformUnitEntity> = {}): PlatformUnitEntity {
  return {
    id: 'u1',
    adAccountId: ACCOUNT_ID,
    platform: 'google_ads',
    refs: {},
    reviews: {},
    reviewsReadAt: null,
    ...overrides,
  } as PlatformUnitEntity;
}

/**
 * An account as its row stands.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function account(overrides: Partial<AdAccountEntity> = {}): AdAccountEntity {
  return {
    id: ACCOUNT_ID,
    platform: 'google_ads',
    externalId: '5550001111',
    scope: {},
    secretName: null,
    status: 'active',
    ...overrides,
  } as AdAccountEntity;
}

describe('Unit::Services::ReviewService', () => {
  /** The registry of adapters, writable, so a spec declares one as a phase would. */
  const adapters: Partial<Record<Platform, PlatformAdapter>> = ADAPTERS as Partial<Record<Platform, PlatformAdapter>>;

  let db: DataSourceMock;
  let builder: QueryBuilderMock;
  let secrets: { get: jest.Mock };
  let readReviews: jest.Mock;
  let service: ReviewService;

  /**
   * Declare an adapter.
   *
   * @param platform - Its platform
   * @param overrides - What it does differently from a Google-like one
   * @returns Nothing
   */
  function declare(platform: Platform, overrides: Partial<PlatformAdapter> = {}): void {
    adapters[platform] = {
      platform,
      connection: 'manager_link',
      apply: jest.fn(),
      readReviews,
      ...overrides,
    } as PlatformAdapter;
  }

  /**
   * The units read, then each as it stands when written: the same row unless a spec says otherwise.
   *
   * @param due - The units due
   * @param accounts - Their accounts
   * @returns Nothing
   */
  function seed(due: PlatformUnitEntity[], accounts: AdAccountEntity[]): void {
    builder.getMany.mockResolvedValue(due);
    db.manager.find.mockResolvedValue(accounts);
    db.manager.findOne.mockImplementation(
      async (_entity: unknown, options: { where: { id: string } }): Promise<PlatformUnitEntity | undefined> =>
        due.find((row: PlatformUnitEntity): boolean => row.id === options.where.id)
    );
  }

  /**
   * What was written on the units, by id.
   *
   * @returns The columns written, by unit
   */
  function written(): Map<string, Partial<PlatformUnitEntity>> {
    return new Map(
      db.manager.update.mock.calls
        .filter(([entity]: [unknown]): boolean => entity === PlatformUnitEntity)
        .map(([, where, values]: [unknown, { id: string }, Partial<PlatformUnitEntity>]) => [where.id, values])
    );
  }

  beforeEach((): void => {
    jest.clearAllMocks();
    db = createDataSourceMock();
    builder = db.builder('unit');
    secrets = { get: jest.fn().mockResolvedValue('the-key') };
    readReviews = jest.fn().mockResolvedValue(new Map());
    service = new ReviewService(db.dataSource, secrets as never, (): number => NOW.getTime());
  });

  afterEach((): void => {
    for (const platform of Object.keys(adapters)) Reflect.deleteProperty(adapters, platform);
  });

  describe('poll', () => {
    it('should read nothing when no platform can say what it made of an ad', async (): Promise<void> => {
      declare('hawk', { readReviews: undefined });

      await service.poll();

      expect(db.manager.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should read only the units due, on the platforms that can say, of the campaigns that deliver', async (): Promise<void> => {
      declare('google_ads');
      declare('hawk', { readReviews: undefined });

      await service.poll();

      expect(builder.where).toHaveBeenCalledWith('unit.platform IN (:...platforms)', { platforms: ['google_ads'] });
      expect(builder.andWhere).toHaveBeenCalledWith('campaign.status IN (:...followed)', {
        followed: ['active', 'paused'],
      });
      expect(builder.andWhere).toHaveBeenCalledWith("account.status = 'active'");
      // A verdict awaited, never read, or read more than a day ago.
      expect(builder.andWhere).toHaveBeenCalledWith(expect.stringContaining("->> 'status' = 'pending'"), {
        stale: new Date('2027-01-02T10:00:00.000Z'),
      });
      // Nothing due: no account is even looked up.
      expect(db.manager.find).not.toHaveBeenCalled();
    });

    it('should read the ads of each account in one call, and keep their verdicts', async (): Promise<void> => {
      declare('google_ads');
      const first: PlatformUnitEntity = unit({
        refs: { 'targeting_group:t1': 'CAMPAIGN-1', 'line:l1': 'AD-1', 'line:l2': 'AD-2' },
        reviews: { 'line:l1': PENDING, 'line:l2': APPROVED },
      });
      const second: PlatformUnitEntity = unit({ id: 'u2', refs: { 'line:l3': 'AD-3' } });
      const empty: PlatformUnitEntity = unit({ id: 'u3', refs: { 'targeting_group:t9': 'CAMPAIGN-9' } });
      seed([first, second, empty], [account({ scope: { region: 'eu' } })]);
      readReviews.mockResolvedValue(
        new Map([
          ['AD-1', REJECTED],
          ['AD-3', APPROVED],
          ['CAMPAIGN-1', APPROVED],
        ])
      );

      await service.poll();

      expect(readReviews).toHaveBeenCalledTimes(1);
      expect(readReviews).toHaveBeenCalledWith(
        {
          platform: 'google_ads',
          adAccountId: ACCOUNT_ID,
          externalId: '5550001111',
          scope: { region: 'eu' },
          credentials: null,
        } satisfies AccountContext,
        ['AD-1', 'AD-2', 'AD-3']
      );
      // An ad the platform said nothing of keeps its verdict; a campaign is no ad, whatever was answered.
      expect(written()).toEqual(
        new Map([
          ['u1', { reviews: { 'line:l1': REJECTED, 'line:l2': APPROVED }, reviewsReadAt: NOW }],
          ['u2', { reviews: { 'line:l3': APPROVED }, reviewsReadAt: NOW }],
          ['u3', { reviews: {}, reviewsReadAt: NOW }],
        ])
      );
      expect(db.manager.findOne).toHaveBeenCalledWith(PlatformUnitEntity, {
        where: { id: 'u1' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('should mark read, without a call, an account whose units hold no ad yet', async (): Promise<void> => {
      declare('google_ads');
      seed([unit({ refs: { 'targeting_group:t1': 'CAMPAIGN-1' } })], [account()]);

      await service.poll();

      expect(readReviews).not.toHaveBeenCalled();
      expect(written().get('u1')).toEqual({ reviews: {}, reviewsReadAt: NOW });
    });

    it('should read an account that brings its own key with that key', async (): Promise<void> => {
      declare('thrad', { connection: 'account_secret' });
      seed(
        [unit({ platform: 'thrad', refs: { 'line:l1': 'AD-1' } })],
        [account({ platform: 'thrad', secretName: 'thrad/acc-1' })]
      );

      await service.poll();

      expect(secrets.get).toHaveBeenCalledWith('thrad/acc-1');
      expect(readReviews).toHaveBeenCalledWith(expect.objectContaining({ credentials: 'the-key' }), ['AD-1']);
    });

    it('should leave alone an account that should bring its own key and has none yet', async (): Promise<void> => {
      declare('thrad', { connection: 'account_secret' });
      seed([unit({ platform: 'thrad', refs: { 'line:l1': 'AD-1' } })], [account({ platform: 'thrad' })]);

      await service.poll();

      expect(readReviews).not.toHaveBeenCalled();
      expect(db.manager.update).not.toHaveBeenCalled();
    });

    it('should write nothing on a unit gone while its ads were read', async (): Promise<void> => {
      declare('google_ads');
      seed([unit({ refs: { 'line:l1': 'AD-1' } })], [account()]);
      db.manager.findOne.mockResolvedValue(null);

      await service.poll();

      expect(db.manager.update).not.toHaveBeenCalled();
    });

    it('should invalidate an account whose key the platform refused, and still read the others', async (): Promise<void> => {
      declare('google_ads');
      seed(
        [unit({ refs: { 'line:l1': 'AD-1' } }), unit({ id: 'u2', adAccountId: OTHER_ACCOUNT_ID, refs: {} })],
        [account(), account({ id: OTHER_ACCOUNT_ID })]
      );
      readReviews.mockRejectedValueOnce(
        new PlatformError('google_ads', 'Unauthorized', {
          statusCode: 401,
          retryable: false,
          invalidCredentials: true,
          requestId: null,
        })
      );

      await service.poll();

      expect(db.manager.update).toHaveBeenCalledWith(
        AdAccountEntity,
        { id: ACCOUNT_ID },
        { status: 'invalid', statusReason: 'credentials_rejected' }
      );
      // Not marked read: the next poll tries again. The other account is read all the same.
      expect([...written().keys()]).toEqual(['u2']);
    });

    it.each([
      [
        'our own credentials failed',
        new PlatformError('google_ads', 'Unauthorized', {
          statusCode: 401,
          retryable: false,
          invalidCredentials: true,
          ownCredentials: true,
          requestId: null,
        }),
      ],
      [
        'the platform failed for a while',
        new PlatformError('google_ads', 'Unavailable', {
          statusCode: 503,
          retryable: true,
          invalidCredentials: false,
          requestId: null,
        }),
      ],
      ['something else failed', new Error('boom')],
    ])('should leave the account alone when %s', async (_label: string, error: Error): Promise<void> => {
      declare('google_ads');
      seed([unit({ refs: { 'line:l1': 'AD-1' } })], [account()]);
      readReviews.mockRejectedValue(error);

      await expect(service.poll()).resolves.toBeUndefined();

      expect(db.manager.update).not.toHaveBeenCalled();
    });
  });

  describe('reviewsAfterRead', () => {
    it('should leave the last word to a sync that sent the ad again while it was read', (): void => {
      const read: PlatformUnitEntity = unit({ refs: { 'line:l1': 'AD-1' }, reviews: { 'line:l1': APPROVED } });
      const current: PlatformUnitEntity = unit({ refs: { 'line:l1': 'AD-1' }, reviews: { 'line:l1': PENDING } });

      expect(reviewsAfterRead(current, read, new Map([['AD-1', APPROVED]]))).toEqual({ 'line:l1': PENDING });
    });

    it('should not give an ad recreated in between the verdict of the one before', (): void => {
      const read: PlatformUnitEntity = unit({ refs: { 'line:l1': 'AD-1' } });
      const current: PlatformUnitEntity = unit({ refs: { 'line:l1': 'AD-9' } });

      expect(reviewsAfterRead(current, read, new Map([['AD-1', REJECTED]]))).toEqual({});
    });
  });

  describe('reviewsAfterApply', () => {
    it('should keep the verdicts of the ads held, and send the ads written back to review', (): void => {
      expect(
        reviewsAfterApply(
          { 'line:l1': APPROVED, 'line:l2': REJECTED, 'line:gone': REJECTED },
          { refs: { 'line:l1': 'AD-1', 'line:l2': 'AD-2' }, appliedStatus: 'active', submitted: ['line:l2'] }
        )
      ).toEqual({ 'line:l1': APPROVED, 'line:l2': PENDING });
      expect(reviewsAfterApply({ 'line:l1': APPROVED }, { refs: {}, appliedStatus: null })).toEqual({});
    });
  });

  describe('isAdKey', () => {
    it('should tell an ad from the other objects', (): void => {
      expect(isAdKey('line:l1')).toBe(true);
      expect(isAdKey('keyword:k1')).toBe(false);
      expect(isAdKey('targeting_group:t1#ad_group')).toBe(false);
    });
  });

  describe('ReviewServicePlugin', () => {
    it('should decorate the instance with the service', async (): Promise<void> => {
      const app: FastifyInstance = await buildServiceApp([ReviewServicePlugin], {
        db: createDataSourceMock(),
        access: createAccessMock(),
        secrets: { get: jest.fn() },
      });

      expect(app.reviewService).toBeInstanceOf(ReviewService);
      await app.close();
    });
  });
});
