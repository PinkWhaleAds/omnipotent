import { DataSource, QueryFailedError, Repository } from 'typeorm';

import { CampaignEntity, ExternalIdHistoryEntity, PlatformUnitEntity } from '@src/database/entities';
import { connectIntegrationDatabase, seedTree, SeededTree, truncateAll } from './database.utils';

/**
 * What only a real PostgreSQL can prove about phase 9: a unit exists **once** per couple
 * (AdGroup, plateforme), the trail of the platform ids cannot be rewritten, the backlog is read
 * through its partial index, and a campaign ends on **its own** last day whatever timezone it counts
 * in (`docs/phase-9.md` § 2 and § 4).
 */
describe('Integration::Phase9', () => {
  const ORGANIZATION = 'c0000000-0000-4000-8000-000000000001';
  let dataSource: DataSource;
  let tree: SeededTree;

  /**
   * Insert a unit of the seeded tree.
   *
   * @param overrides - What this case declares
   * @returns The row
   */
  async function seedUnit(overrides: Partial<PlatformUnitEntity> = {}): Promise<PlatformUnitEntity> {
    const units: Repository<PlatformUnitEntity> = dataSource.getRepository(PlatformUnitEntity);
    return units.save(
      units.create({
        organizationId: ORGANIZATION,
        campaignId: tree.campaignId,
        leverId: tree.leverId,
        adGroupId: tree.adGroupId,
        lever: 'dac',
        platform: 'dv360',
        adAccountId: '0ff00000-0000-4000-8000-000000000001',
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
    tree = await seedTree(dataSource, ORGANIZATION);
  });

  describe('the unit', () => {
    it('should exist once per couple (AdGroup, platform)', async (): Promise<void> => {
      await seedUnit();

      await expect(seedUnit()).rejects.toBeInstanceOf(QueryFailedError);
    });

    it('should allow the same AdGroup on several platforms', async (): Promise<void> => {
      await seedUnit();
      await seedUnit({ platform: 'hawk' });

      await expect(dataSource.getRepository(PlatformUnitEntity).count()).resolves.toBe(2);
    });

    it('should keep the map of the platform ids as it was written', async (): Promise<void> => {
      const refs: Record<string, string> = { [`ad_group:${tree.adGroupId}`]: 'IO-1', 'keyword:k1': 'KW-1' };
      const unit: PlatformUnitEntity = await seedUnit({ refs });

      const stored: PlatformUnitEntity | null = await dataSource
        .getRepository(PlatformUnitEntity)
        .findOneBy({ id: unit.id });
      expect(stored?.refs).toEqual(refs);
      expect(stored?.fxRate).toBe(1);
    });
  });

  describe('the backlog', () => {
    it('should read only what has something to apply, through the partial index', async (): Promise<void> => {
      const due: Date = new Date('2027-01-03T10:00:00.000Z');
      await seedUnit({ syncState: 'pending' });
      await seedUnit({ platform: 'hawk', syncState: 'synced' });
      await seedUnit({ platform: 'meta', syncState: 'error', nextAttemptAt: new Date(due.getTime() - 1) });
      await seedUnit({ platform: 'tiktok', syncState: 'error', nextAttemptAt: new Date(due.getTime() + 60_000) });
      // A definitive failure: nothing reschedules it, and the sweep must not pick it up.
      await seedUnit({ platform: 'snap', syncState: 'error', nextAttemptAt: null });

      const backlog: { platform: string }[] = await dataSource.query(
        `SELECT platform FROM platform_units
          WHERE sync_state IN ('pending', 'error') AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
            AND NOT (sync_state = 'error' AND next_attempt_at IS NULL)
          ORDER BY platform`,
        [due]
      );

      expect(backlog.map((row: { platform: string }): string => row.platform)).toEqual(['dv360', 'meta']);
    });

    it('should have an index the planner can use for that read', async (): Promise<void> => {
      const indexes: { indexdef: string }[] = await dataSource.query(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'platform_units'`
      );

      expect(indexes.map((row: { indexdef: string }): string => row.indexdef).join('\n')).toContain(
        'WHERE ((sync_state)::text = ANY'
      );
    });
  });

  describe('the trail of the platform ids', () => {
    it('should accept a row, and refuse to let anybody change or delete it', async (): Promise<void> => {
      const unit: PlatformUnitEntity = await seedUnit();
      const history: Repository<ExternalIdHistoryEntity> = dataSource.getRepository(ExternalIdHistoryEntity);
      const row: ExternalIdHistoryEntity = await history.save(
        history.create({
          organizationId: ORGANIZATION,
          platformUnitId: unit.id,
          platform: 'dv360',
          level: 'ad_group',
          nodeId: tree.adGroupId,
          refKey: `ad_group:${tree.adGroupId}`,
          previousExternalId: 'IO-1',
          externalId: 'IO-2',
        })
      );

      // R5 made real by a trigger rather than by a convention: a report about the previous days still
      // carries the old id, and that only holds if no code can rewrite the trail.
      await expect(history.update({ id: row.id }, { externalId: 'IO-3' })).rejects.toThrow(/append-only/);
      await expect(history.delete({ id: row.id })).rejects.toThrow(/append-only/);
      await expect(history.count()).resolves.toBe(1);
    });
  });

  describe('the end of a campaign', () => {
    it('should end a campaign on its own last day, in its own timezone', async (): Promise<void> => {
      const campaigns: Repository<CampaignEntity> = dataSource.getRepository(CampaignEntity);
      // A last day well behind us, whatever the timezone resolves to.
      await campaigns.update(
        { id: tree.campaignId },
        { status: 'active', timezone: 'Pacific/Auckland', startsOn: '2020-01-01', endsOn: '2020-01-07' }
      );

      // `UPDATE … RETURNING` answers the rows **and** their count, which is what the engine reads.
      const [ended]: [{ id: string }[], number] = (await dataSource.query(
        `UPDATE campaigns SET status = 'ended', updated_at = now()
           WHERE status IN ('active', 'paused')
             AND deleted_at IS NULL
             AND ends_on < (now() AT TIME ZONE COALESCE(timezone, 'UTC'))::date
         RETURNING id`
      )) as [{ id: string }[], number];

      expect(ended.map((row: { id: string }): string => row.id)).toEqual([tree.campaignId]);
      await expect(campaigns.findOneBy({ id: tree.campaignId })).resolves.toMatchObject({ status: 'ended' });
    });

    it('should leave a campaign whose last day has not come', async (): Promise<void> => {
      const campaigns: Repository<CampaignEntity> = dataSource.getRepository(CampaignEntity);
      await campaigns.update({ id: tree.campaignId }, { status: 'active', endsOn: '2099-12-31' });

      const [ended]: [unknown[], number] = (await dataSource.query(
        `UPDATE campaigns SET status = 'ended'
           WHERE status IN ('active', 'paused')
             AND deleted_at IS NULL
             AND ends_on < (now() AT TIME ZONE COALESCE(timezone, 'UTC'))::date
         RETURNING id`
      )) as [unknown[], number];

      expect(ended).toEqual([]);
    });
  });

  describe('the campaigns whose targeting mentions a list', () => {
    it('should be found whatever dimension carries the reference', async (): Promise<void> => {
      const listId = '0aa00000-0000-4000-8000-000000000001';
      const other: SeededTree = await seedTree(dataSource, ORGANIZATION, {
        audience: { include: [listId], exclude: [] },
      });

      const rows: { campaignId: string }[] = await dataSource.query(
        'SELECT DISTINCT campaign_id AS "campaignId" FROM targeting_groups WHERE targeting::text LIKE $1',
        [`%${listId}%`]
      );

      expect(rows.map((row: { campaignId: string }): string => row.campaignId)).toEqual([other.campaignId]);
    });
  });
});
