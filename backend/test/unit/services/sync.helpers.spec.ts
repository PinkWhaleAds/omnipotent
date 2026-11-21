import { AdGroupEntity, LineEntity, PlatformUnitEntity } from '@src/database/entities';
import {
  markAccountDirty,
  markCampaignDirty,
  markCampaignsDirty,
  markCreativeDirty,
  markGoalDirty,
  markListDirty,
} from '@src/services/sync.helpers';
import { IDS } from '@test/unit/mocks/auth.fixtures';
import { createTreeStore, TreeStore } from '@test/unit/mocks/tree-store.mock';

/** The ids the specs work with. */
const CAMPAIGN_ID = 'f1000000-0000-4000-8000-000000000001';
const OTHER_CAMPAIGN_ID = 'f1000000-0000-4000-8000-000000000002';
const ACCOUNT_ID = 'ff000000-0000-4000-8000-000000000001';
const CREATIVE_ID = 'fe000000-0000-4000-8000-000000000001';

describe('Unit::Services::SyncHelpers', () => {
  let store: TreeStore;

  /**
   * Seed one unit.
   *
   * @param overrides - What this case declares
   * @returns Nothing
   */
  function seedUnit(overrides: Partial<PlatformUnitEntity> = {}): void {
    store.seed(PlatformUnitEntity, [
      {
        id: `u-${store.rows(PlatformUnitEntity).length + 1}`,
        organizationId: IDS.organization,
        campaignId: CAMPAIGN_ID,
        adAccountId: ACCOUNT_ID,
        syncState: 'synced',
        syncedHash: 'abc',
        attempts: 3,
        nextAttemptAt: new Date('2027-01-01T00:00:00.000Z'),
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
    store = createTreeStore();
  });

  describe('markCampaignDirty', () => {
    it('should mark the units of that campaign, and clear their backoff', async (): Promise<void> => {
      seedUnit();
      seedUnit({ campaignId: OTHER_CAMPAIGN_ID });

      expect(await markCampaignDirty(store.manager, CAMPAIGN_ID)).toBe(1);
      expect(units()[0]).toMatchObject({ syncState: 'pending', attempts: 0, nextAttemptAt: null });
      // A modification is a fresh start, including after a failure nothing would retry on its own.
      expect(units()[1]).toMatchObject({ campaignId: OTHER_CAMPAIGN_ID, syncState: 'synced', attempts: 3 });
    });

    it('should leave the fingerprint alone, so a change that changes nothing costs no call', async (): Promise<void> => {
      seedUnit();

      await markCampaignDirty(store.manager, CAMPAIGN_ID);

      expect(units()[0].syncedHash).toBe('abc');
    });

    it('should cost nothing for a campaign with no unit', async (): Promise<void> => {
      expect(await markCampaignDirty(store.manager, CAMPAIGN_ID)).toBe(0);
    });

    it('should not touch a unit that is already waiting', async (): Promise<void> => {
      seedUnit({ syncState: 'pending', attempts: 0, nextAttemptAt: null });

      expect(await markCampaignDirty(store.manager, CAMPAIGN_ID)).toBe(0);
    });

    it('should answer nothing when the driver does not say how many rows it touched', async (): Promise<void> => {
      seedUnit();
      // `UpdateResult.affected` is optional in TypeORM, and not every driver fills it.
      jest.spyOn(store.manager, 'update').mockResolvedValue({ raw: [], generatedMaps: [] });

      expect(await markCampaignDirty(store.manager, CAMPAIGN_ID)).toBe(0);
    });
  });

  describe('markCampaignsDirty', () => {
    it('should mark several campaigns at once, ignoring the duplicates', async (): Promise<void> => {
      seedUnit();
      seedUnit({ campaignId: OTHER_CAMPAIGN_ID });

      expect(await markCampaignsDirty(store.manager, [CAMPAIGN_ID, OTHER_CAMPAIGN_ID, CAMPAIGN_ID])).toBe(2);
    });

    it('should do nothing at all for an empty list', async (): Promise<void> => {
      seedUnit();

      expect(await markCampaignsDirty(store.manager, [])).toBe(0);
      expect(store.manager.update).not.toHaveBeenCalled();
    });
  });

  describe('markCreativeDirty', () => {
    it('should mark every campaign whose Lines deliver it', async (): Promise<void> => {
      seedUnit();
      seedUnit({ campaignId: OTHER_CAMPAIGN_ID });
      store.seed(LineEntity, [
        { id: 'l1', campaignId: CAMPAIGN_ID, creativeId: CREATIVE_ID, deletedAt: null },
        { id: 'l2', campaignId: OTHER_CAMPAIGN_ID, creativeId: 'other', deletedAt: null },
      ]);

      expect(await markCreativeDirty(store.manager, CREATIVE_ID)).toBe(1);
      expect(units()[0].syncState).toBe('pending');
      expect(units()[1].syncState).toBe('synced');
    });

    it('should mark a campaign whose Line was deleted too, since the platform still holds the ad', async (): Promise<void> => {
      seedUnit();
      store.seed(LineEntity, [{ id: 'l1', campaignId: CAMPAIGN_ID, creativeId: CREATIVE_ID, deletedAt: new Date() }]);

      expect(await markCreativeDirty(store.manager, CREATIVE_ID)).toBe(1);
    });
  });

  describe('markListDirty', () => {
    it('should mark every campaign whose targeting mentions it', async (): Promise<void> => {
      seedUnit();
      store.query.mockResolvedValue([{ campaignId: CAMPAIGN_ID }]);

      expect(await markListDirty(store.manager, 'a-list')).toBe(1);
      expect(store.query).toHaveBeenCalledWith(expect.stringContaining('targeting::text LIKE $1'), ['%a-list%']);
      expect(units()[0].syncState).toBe('pending');
    });

    it('should cost nothing when no targeting mentions it', async (): Promise<void> => {
      seedUnit();
      store.query.mockResolvedValue([]);

      expect(await markListDirty(store.manager, 'a-list')).toBe(0);
    });
  });

  describe('markAccountDirty', () => {
    it('should mark every unit buying on that account, whatever their campaign', async (): Promise<void> => {
      seedUnit();
      seedUnit({ campaignId: OTHER_CAMPAIGN_ID });
      seedUnit({ adAccountId: 'another' });

      expect(await markAccountDirty(store.manager, ACCOUNT_ID)).toBe(2);
      expect(units()[2].syncState).toBe('synced');
    });
  });

  describe('markGoalDirty', () => {
    it('should mark the units of the AdGroups optimizing the goal, on that account only', async (): Promise<void> => {
      store.seed(AdGroupEntity, [
        { id: 'g-1', conversionGoalId: 'goal-1' },
        { id: 'g-2', conversionGoalId: 'goal-1' },
        { id: 'g-3', conversionGoalId: 'goal-2' },
      ]);
      seedUnit({ adGroupId: 'g-1' });
      seedUnit({ adGroupId: 'g-2', adAccountId: 'another' });
      seedUnit({ adGroupId: 'g-3' });

      expect(await markGoalDirty(store.manager, 'goal-1', ACCOUNT_ID)).toBe(1);
      expect(units().map((unit: PlatformUnitEntity): string => unit.syncState)).toEqual([
        'pending',
        'synced',
        'synced',
      ]);
    });

    it('should cost nothing when no AdGroup optimizes the goal', async (): Promise<void> => {
      seedUnit({ adGroupId: 'g-1' });

      expect(await markGoalDirty(store.manager, 'goal-1', ACCOUNT_ID)).toBe(0);
      expect(store.manager.update).not.toHaveBeenCalled();
    });
  });
});
