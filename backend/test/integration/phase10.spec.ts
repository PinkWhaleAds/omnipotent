import { randomUUID } from 'node:crypto';

import { DataSource, QueryFailedError, Repository } from 'typeorm';

import { AdAccountEntity, CampaignEntity, PlatformUnitEntity } from '@src/database/entities';
import { ADAPTERS, PlatformAdapter } from '@src/platforms/platform-adapter';
import { ReviewService } from '@src/services/review.service';
import { AdReview, Platform } from '@src/types';
import { connectIntegrationDatabase, seedTree, SeededTree, truncateAll } from './database.utils';

/**
 * What only a real PostgreSQL can prove about the schema of phase 10: an account linked to **our**
 * manager account belongs to **one** Organization among the living rows, whichever it is — our
 * credentials reach every account so linked — and one waiting for its client has no name, currency
 * or timezone yet (`docs/phase-10.md` §§ 4.4 and 4.5).
 */
describe('Integration::Phase10', () => {
  const ORGANIZATION = 'c0000000-0000-4000-8000-000000000001';
  const OTHER_ORGANIZATION = 'c0000000-0000-4000-8000-000000000002';
  let dataSource: DataSource;

  /**
   * Connect an account the way a `manager_link` platform does: the reference alone, waiting.
   *
   * @param organizationId - Whose Organization
   * @param linkRef - Its reference, `null` for one declared by hand
   * @returns The row
   */
  async function connect(organizationId: string, linkRef: string | null): Promise<AdAccountEntity> {
    const accounts: Repository<AdAccountEntity> = dataSource.getRepository(AdAccountEntity);
    return accounts.save(
      accounts.create({
        organizationId,
        platform: 'google_ads',
        externalId: linkRef ?? '1234567890',
        name: null,
        currency: null,
        timezone: null,
        status: 'pending',
        statusReason: 'link_requested',
        scope: {},
        secretName: null,
        linkRef,
        linkRequestedAt: linkRef === null ? null : new Date(),
      })
    );
  }

  beforeAll(async (): Promise<void> => {
    dataSource = await connectIntegrationDatabase();
  });

  afterAll(async (): Promise<void> => {
    await dataSource.destroy();
  });

  beforeEach(async (): Promise<void> => {
    await truncateAll(dataSource);
  });

  it('should keep an account waiting for its client with no name, currency or timezone', async (): Promise<void> => {
    await expect(connect(ORGANIZATION, '5550001111')).resolves.toMatchObject({
      name: null,
      currency: null,
      timezone: null,
      linkRef: '5550001111',
    });
  });

  it('should refuse a linked account to a second Organization', async (): Promise<void> => {
    await connect(ORGANIZATION, '5550001111');

    // The index that phase 7 did not need: there, another Organization could connect the same
    // account, since each brought its own key.
    await expect(connect(OTHER_ORGANIZATION, '5550001111')).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('should free a linked account once disconnected', async (): Promise<void> => {
    const account: AdAccountEntity = await connect(ORGANIZATION, '5550001111');
    await dataSource.getRepository(AdAccountEntity).update({ id: account.id }, { deletedAt: new Date() });

    await expect(connect(OTHER_ORGANIZATION, '5550001111')).resolves.toMatchObject({
      organizationId: OTHER_ORGANIZATION,
    });
  });

  it('should leave the accounts declared by hand out of it', async (): Promise<void> => {
    await connect(ORGANIZATION, null);

    await expect(connect(OTHER_ORGANIZATION, null)).resolves.toMatchObject({ linkRef: null });
  });

  describe('the verdicts to read', () => {
    /** The registry of adapters, writable, so the spec declares Google's as the application does. */
    const adapters: Partial<Record<Platform, PlatformAdapter>> = ADAPTERS as Partial<Record<Platform, PlatformAdapter>>;
    const NOW: Date = new Date('2027-01-03T10:00:00.000Z');
    const APPROVED: AdReview = { status: 'approved', reasons: [] };
    let tree: SeededTree;
    let account: AdAccountEntity;
    let readReviews: jest.Mock;

    /**
     * Insert a unit on Google, under an AdGroup of its own.
     *
     * @param ad - The id of its one ad
     * @param overrides - What this case declares
     * @returns The row
     */
    async function seedUnit(ad: string, overrides: Partial<PlatformUnitEntity> = {}): Promise<PlatformUnitEntity> {
      const units: Repository<PlatformUnitEntity> = dataSource.getRepository(PlatformUnitEntity);
      return units.save(
        units.create({
          organizationId: ORGANIZATION,
          campaignId: tree.campaignId,
          leverId: tree.leverId,
          adGroupId: randomUUID(),
          lever: 'search',
          platform: 'google_ads',
          adAccountId: account.id,
          fxRate: 1,
          refs: { [`line:${ad}`]: ad },
          syncState: 'synced',
          ...overrides,
        })
      );
    }

    beforeEach(async (): Promise<void> => {
      tree = await seedTree(dataSource, ORGANIZATION);
      await dataSource.getRepository(CampaignEntity).update({ id: tree.campaignId }, { status: 'paused' });
      account = await connect(ORGANIZATION, '5550001111');
      await dataSource
        .getRepository(AdAccountEntity)
        .update(
          { id: account.id },
          { status: 'active', statusReason: null, currency: 'EUR', timezone: 'Europe/Paris' }
        );
      readReviews = jest.fn(
        async (_account: unknown, ads: string[]): Promise<Map<string, AdReview>> =>
          new Map(ads.map((ad: string): [string, AdReview] => [ad, APPROVED]))
      );
      adapters.google_ads = {
        platform: 'google_ads',
        connection: 'manager_link',
        apply: jest.fn(),
        readReviews,
      } as PlatformAdapter;
    });

    afterEach((): void => {
      Reflect.deleteProperty(adapters, 'google_ads');
    });

    it('should read a verdict awaited, a unit never read, and one read a day ago — and only them', async (): Promise<void> => {
      const hourAgo = new Date(NOW.getTime() - 3_600_000);
      await seedUnit('awaited', {
        reviews: { 'line:awaited': { status: 'pending', reasons: [] } },
        reviewsReadAt: hourAgo,
      });
      await seedUnit('never', { reviewsReadAt: null });
      await seedUnit('stale', {
        reviews: { 'line:stale': APPROVED },
        reviewsReadAt: new Date(NOW.getTime() - 25 * 3_600_000),
      });
      await seedUnit('fresh', { reviews: { 'line:fresh': APPROVED }, reviewsReadAt: hourAgo });

      await new ReviewService(dataSource, { get: jest.fn() } as never, (): number => NOW.getTime()).poll();

      expect(readReviews).toHaveBeenCalledTimes(1);
      expect([...(readReviews.mock.calls[0][1] as string[])].sort()).toEqual(['awaited', 'never', 'stale']);
      const stored: PlatformUnitEntity[] = await dataSource.getRepository(PlatformUnitEntity).find();
      const awaited = stored.find((row: PlatformUnitEntity): boolean => row.refs['line:awaited'] !== undefined);
      expect(awaited).toMatchObject({ reviews: { 'line:awaited': APPROVED }, reviewsReadAt: NOW });
    });

    it('should leave alone the ads of a campaign ended, and of an account no longer active', async (): Promise<void> => {
      await seedUnit('never');
      await dataSource.getRepository(CampaignEntity).update({ id: tree.campaignId }, { status: 'ended' });

      await new ReviewService(dataSource, { get: jest.fn() } as never, (): number => NOW.getTime()).poll();
      await dataSource.getRepository(CampaignEntity).update({ id: tree.campaignId }, { status: 'active' });
      await dataSource.getRepository(AdAccountEntity).update({ id: account.id }, { status: 'invalid' });
      await new ReviewService(dataSource, { get: jest.fn() } as never, (): number => NOW.getTime()).poll();

      expect(readReviews).not.toHaveBeenCalled();
    });
  });
});
