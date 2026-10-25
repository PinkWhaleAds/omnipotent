import { FastifyInstance } from 'fastify';

import { AdGroupEntity, CampaignEntity, LeverEntity, TargetingGroupEntity } from '@src/database/entities';
import LabelServicePlugin, { LabelService } from '@src/services/label.service';
import TargetingGroupServicePlugin, {
  TargetingGroupService,
  toTargetingGroup,
} from '@src/services/targeting-group.service';
import { Paginated } from '@src/types/api.types';
import { BulkResult, DeletionResult } from '@src/types/crud.types';
import { LabelSummary } from '@src/types/label.types';
import { ListTargetingGroupsQuery, TargetingGroup } from '@src/types/targeting-group.types';
import { BudgetBlock } from '@src/types/tree.types';
import { AccessServiceMock, buildServiceApp, createAccessMock } from '@test/unit/mocks/access.mock';
import { IDS, JANE, NOW } from '@test/unit/mocks/auth.fixtures';
import { createDataSourceMock, DataSourceMock, QueryBuilderMock } from '@test/unit/mocks/data-source.mock';
import { httpError } from '@utils';

/** The instant every row is created and updated at, as the API writes it. */
const ISO: string = NOW.toISOString();

/** Ids the specs work with. */
const CAMPAIGN_ID = 'f1000000-0000-4000-8000-000000000001';
const LEVER_ID = 'f2000000-0000-4000-8000-000000000001';
const AD_GROUP_ID = 'f3000000-0000-4000-8000-000000000001';
const TARGETING_GROUP_ID = 'f4000000-0000-4000-8000-000000000001';
const OTHER_TARGETING_GROUP_ID = 'f4000000-0000-4000-8000-000000000002';

/** A Label as a TargetingGroup carries it. */
const SPRING: LabelSummary = { id: 'e0000000-0000-4000-8000-000000000001', name: 'Printemps', color: '#1f6feb' };

/** The query a list route hands the service when the caller asked for nothing in particular. */
const DEFAULT_QUERY: ListTargetingGroupsQuery = {
  page: 1,
  limit: 50,
  sortBy: 'name',
  sortOrder: 'asc',
  labelMode: 'any',
  includeDeleted: false,
};

/** Jest mocks of the {@link LabelService} methods a TargetingGroup needs. */
type LabelServiceMock = { setOn: jest.Mock; summariesOf: jest.Mock };

/**
 * Build a TargetingGroup row.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function targetingGroupRow(overrides: Partial<TargetingGroupEntity> = {}): TargetingGroupEntity {
  return {
    id: TARGETING_GROUP_ID,
    organizationId: IDS.organization,
    campaignId: CAMPAIGN_ID,
    adGroupId: AD_GROUP_ID,
    lever: 'dac',
    name: 'Île-de-France',
    status: 'active',
    bidAmountCents: null,
    budgetCents: null,
    budgetVolume: null,
    budgetVolumeUnit: null,
    capping: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  } as TargetingGroupEntity;
}

/**
 * Arrange the tree above a TargetingGroup: a campaign of 1 000 €, one `dac` lever whose key is a
 * single platform, and one AdGroup bidding 450 cents.
 *
 * @param db - The data source mock to arrange
 * @param node - The TargetingGroup `findOne` answers, `null` to answer nothing
 * @param siblings - The TargetingGroups of the AdGroup, which divide its budget
 */
function seedAbove(db: DataSourceMock, node: TargetingGroupEntity | null, siblings: TargetingGroupEntity[] = []): void {
  db.manager.findOne.mockImplementation(async (entity: unknown): Promise<unknown> => {
    if (entity === CampaignEntity) {
      return { id: CAMPAIGN_ID, budgetCents: 100_000, startsOn: '2026-11-05', endsOn: '2026-11-20', deletedAt: null };
    }
    if (entity === LeverEntity) {
      return {
        id: LEVER_ID,
        campaignId: CAMPAIGN_ID,
        lever: 'dac',
        platformShares: [{ platform: 'dv360', shareBasisPoints: 10_000 }],
        budgetCents: null,
        deletedAt: null,
      };
    }
    if (entity === AdGroupEntity) {
      return {
        id: AD_GROUP_ID,
        organizationId: IDS.organization,
        campaignId: CAMPAIGN_ID,
        leverId: LEVER_ID,
        lever: 'dac',
        bidAmountCents: 450,
        platformShares: null,
        budgetCents: null,
        deletedAt: null,
      };
    }
    return node;
  });
  db.manager.find.mockImplementation(async (entity: unknown): Promise<unknown[]> => {
    if (entity === TargetingGroupEntity) return siblings.length > 0 ? siblings : node ? [node] : [];
    if (entity === AdGroupEntity) return [{ id: AD_GROUP_ID, lever: 'dac', budgetCents: null }];
    if (entity === LeverEntity) return [{ id: LEVER_ID, lever: 'dac', budgetCents: null }];
    return [];
  });
}

/** The budget block an only TargetingGroup of a 1 000 € campaign answers. */
const BUDGET: BudgetBlock = {
  explicitCents: null,
  effectiveCents: 100_000,
  source: 'inherited',
  volume: null,
  perPlatform: [{ platform: 'dv360', shareBasisPoints: 10_000, cents: 100_000 }],
};

/** The API shape of {@link targetingGroupRow}, with no Label. */
const IDF: TargetingGroup = {
  id: TARGETING_GROUP_ID,
  organizationId: IDS.organization,
  campaignId: CAMPAIGN_ID,
  adGroupId: AD_GROUP_ID,
  lever: 'dac',
  name: 'Île-de-France',
  status: 'active',
  bidAmountCents: null,
  budget: BUDGET,
  capping: null,
  labels: [],
  createdAt: ISO,
  updatedAt: ISO,
  deletedAt: null,
};

describe('Unit::Services::TargetingGroupService', () => {
  let db: DataSourceMock;
  let access: AccessServiceMock;
  let labels: LabelServiceMock;
  let service: TargetingGroupService;

  beforeEach((): void => {
    db = createDataSourceMock();
    access = createAccessMock();
    labels = { setOn: jest.fn().mockResolvedValue([SPRING]), summariesOf: jest.fn().mockResolvedValue(new Map()) };
    service = new TargetingGroupService(db.dataSource, access as never, labels as unknown as LabelService);
    seedAbove(db, targetingGroupRow());
    db.manager.save.mockResolvedValue(targetingGroupRow());
  });

  describe('toTargetingGroup', () => {
    it('should map a row to its API shape, with no window of its own', (): void => {
      expect(toTargetingGroup(targetingGroupRow(), BUDGET)).toEqual(IDF);
      expect(Object.keys(toTargetingGroup(targetingGroupRow(), BUDGET))).not.toContain('startsOn');
    });

    it('should carry the deletion instant, its own bid and the Labels', (): void => {
      const group: TargetingGroup = toTargetingGroup(
        targetingGroupRow({ deletedAt: NOW, bidAmountCents: 300 }),
        BUDGET,
        [SPRING]
      );

      expect(group).toMatchObject({ deletedAt: ISO, bidAmountCents: 300, labels: [SPRING] });
    });
  });

  describe('list', () => {
    it('should list the TargetingGroups of the AdGroup, read by a viewer', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('targeting_group');
      builder.getManyAndCount.mockResolvedValue([[targetingGroupRow()], 1]);
      labels.summariesOf.mockResolvedValue(new Map([[TARGETING_GROUP_ID, [SPRING]]]));

      const page: Paginated<TargetingGroup> = await service.list(JANE, IDS.organization, AD_GROUP_ID, DEFAULT_QUERY);

      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
      expect(page).toEqual({ items: [{ ...IDF, labels: [SPRING] }], total: 1, page: 1, limit: 50 });
      expect(builder.andWhere).toHaveBeenCalledWith('targeting_group.ad_group_id = :parentId', {
        parentId: AD_GROUP_ID,
      });
    });

    it('should search the name without case nor accents', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('targeting_group');

      await service.list(JANE, IDS.organization, AD_GROUP_ID, { ...DEFAULT_QUERY, search: 'Île' });

      expect(builder.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE :search'), { search: '%Ile%' });
    });

    it('should answer 404 for an AdGroup of another Organization', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(service.list(JANE, IDS.organization, AD_GROUP_ID, DEFAULT_QUERY)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'ad_group_not_found',
      });
    });
  });

  describe('get', () => {
    it('should read one TargetingGroup, its budget resolved up the tree', async (): Promise<void> => {
      await expect(service.get(JANE, IDS.organization, TARGETING_GROUP_ID)).resolves.toEqual(IDF);
    });

    it('should divide its AdGroup between the TargetingGroups that share it', async (): Promise<void> => {
      seedAbove(db, targetingGroupRow(), [targetingGroupRow(), targetingGroupRow({ id: OTHER_TARGETING_GROUP_ID })]);

      const group: TargetingGroup = await service.get(JANE, IDS.organization, TARGETING_GROUP_ID);

      expect(group.budget.effectiveCents).toBe(50_000);
    });

    it('should answer 404 for a TargetingGroup of another Organization', async (): Promise<void> => {
      seedAbove(db, null);

      await expect(service.get(JANE, IDS.organization, TARGETING_GROUP_ID)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'targeting_group_not_found',
      });
    });
  });

  describe('create', () => {
    it('should create a TargetingGroup with its Labels', async (): Promise<void> => {
      await expect(
        service.create(JANE, IDS.organization, AD_GROUP_ID, { name: 'Île-de-France', labelIds: [SPRING.id] })
      ).resolves.toEqual({ ...IDF, labels: [SPRING] });
      expect(db.manager.create).toHaveBeenCalledWith(
        TargetingGroupEntity,
        expect.objectContaining({ campaignId: CAMPAIGN_ID, adGroupId: AD_GROUP_ID, lever: 'dac' })
      );
      expect(labels.setOn).toHaveBeenCalledWith(db.manager, IDS.organization, 'targeting_group', TARGETING_GROUP_ID, [
        SPRING.id,
      ]);
    });

    it('should create a TargetingGroup with no Label', async (): Promise<void> => {
      await expect(service.create(JANE, IDS.organization, AD_GROUP_ID, { name: 'Île-de-France' })).resolves.toEqual(
        IDF
      );
      expect(labels.setOn).not.toHaveBeenCalled();
    });

    it('should keep its own bid amount, which overrides its AdGroup', async (): Promise<void> => {
      await service.create(JANE, IDS.organization, AD_GROUP_ID, { name: 'Île-de-France', bidAmountCents: 300 });

      expect(db.manager.create).toHaveBeenCalledWith(
        TargetingGroupEntity,
        expect.objectContaining({ bidAmountCents: 300 })
      );
    });

    it('should convert a volume through its own bid when it has one', async (): Promise<void> => {
      await service.create(JANE, IDS.organization, AD_GROUP_ID, {
        name: 'Île-de-France',
        bidAmountCents: 1_000,
        budgetVolume: { amount: 10_000, unit: 'impressions' },
      });

      expect(db.manager.create).toHaveBeenCalledWith(
        TargetingGroupEntity,
        expect.objectContaining({ budgetCents: 10_000, budgetVolume: 10_000 })
      );
    });

    it('should fall back on the bid of its AdGroup to convert a volume', async (): Promise<void> => {
      await service.create(JANE, IDS.organization, AD_GROUP_ID, {
        name: 'Île-de-France',
        budgetVolume: { amount: 10_000, unit: 'impressions' },
      });

      // 10 000 impressions at the AdGroup's 450 cents per thousand.
      expect(db.manager.create).toHaveBeenCalledWith(
        TargetingGroupEntity,
        expect.objectContaining({ budgetCents: 4_500 })
      );
    });

    it('should refuse a budget that overflows its AdGroup', async (): Promise<void> => {
      seedAbove(db, targetingGroupRow(), [targetingGroupRow({ id: OTHER_TARGETING_GROUP_ID, budgetCents: 90_000 })]);

      await expect(
        service.create(JANE, IDS.organization, AD_GROUP_ID, { name: 'Île-de-France', budgetCents: 20_000 })
      ).rejects.toMatchObject({ errorCode: 'budget_exceeds_parent' });
    });

    it('should answer 404 for an AdGroup of another Organization', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(
        service.create(JANE, IDS.organization, AD_GROUP_ID, { name: 'Île-de-France' })
      ).rejects.toMatchObject({ statusCode: 404, errorCode: 'ad_group_not_found' });
    });
  });

  describe('update', () => {
    it('should rename a TargetingGroup', async (): Promise<void> => {
      db.manager.save.mockResolvedValue(targetingGroupRow({ name: 'Grand Est' }));

      await expect(
        service.update(JANE, IDS.organization, TARGETING_GROUP_ID, { name: 'Grand Est' })
      ).resolves.toMatchObject({ name: 'Grand Est' });
    });

    it('should change its bid amount, and give it back', async (): Promise<void> => {
      await service.update(JANE, IDS.organization, TARGETING_GROUP_ID, { bidAmountCents: 600 });
      expect(db.manager.save).toHaveBeenCalledWith(
        TargetingGroupEntity,
        expect.objectContaining({ bidAmountCents: 600 })
      );

      await service.update(JANE, IDS.organization, TARGETING_GROUP_ID, { bidAmountCents: null });
      expect(db.manager.save).toHaveBeenCalledWith(
        TargetingGroupEntity,
        expect.objectContaining({ bidAmountCents: null })
      );
    });

    it('should convert a volume through the bid it carries, else its AdGroup', async (): Promise<void> => {
      seedAbove(db, targetingGroupRow({ bidAmountCents: 1_000 }));

      await service.update(JANE, IDS.organization, TARGETING_GROUP_ID, {
        budgetVolume: { amount: 10_000, unit: 'impressions' },
      });

      expect(db.manager.save).toHaveBeenCalledWith(
        TargetingGroupEntity,
        expect.objectContaining({ budgetCents: 10_000 })
      );
    });

    it('should accept a body changing nothing', async (): Promise<void> => {
      await expect(service.update(JANE, IDS.organization, TARGETING_GROUP_ID, {})).resolves.toMatchObject({
        id: TARGETING_GROUP_ID,
      });
    });

    it('should answer 404 for a TargetingGroup of another Organization', async (): Promise<void> => {
      seedAbove(db, null);

      await expect(service.update(JANE, IDS.organization, TARGETING_GROUP_ID, {})).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'targeting_group_not_found',
      });
    });
  });

  describe('delete and restore', () => {
    it('should soft-delete a TargetingGroup and answer when', async (): Promise<void> => {
      const result: DeletionResult = await service.delete(JANE, IDS.organization, TARGETING_GROUP_ID);

      expect(result.id).toBe(TARGETING_GROUP_ID);
      expect(Date.parse(result.deletedAt as string)).not.toBeNaN();
    });

    it('should restore a deleted TargetingGroup', async (): Promise<void> => {
      seedAbove(db, targetingGroupRow({ deletedAt: NOW }));

      await expect(service.restore(JANE, IDS.organization, TARGETING_GROUP_ID)).resolves.toEqual({
        id: TARGETING_GROUP_ID,
        deletedAt: null,
      });
    });

    it('should answer 409 for a TargetingGroup that is not deleted', async (): Promise<void> => {
      await expect(service.restore(JANE, IDS.organization, TARGETING_GROUP_ID)).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'targeting_group_not_deleted',
      });
    });
  });

  describe('setLabels', () => {
    it('should replace the Labels of a TargetingGroup', async (): Promise<void> => {
      await expect(
        service.setLabels(JANE, IDS.organization, TARGETING_GROUP_ID, { labelIds: [SPRING.id] })
      ).resolves.toEqual({ ...IDF, labels: [SPRING] });
    });

    it('should answer 404 for a deleted TargetingGroup', async (): Promise<void> => {
      seedAbove(db, null);

      await expect(
        service.setLabels(JANE, IDS.organization, TARGETING_GROUP_ID, { labelIds: [] })
      ).rejects.toMatchObject({ statusCode: 404, errorCode: 'targeting_group_not_found' });
    });
  });

  describe('the bulk routes', () => {
    it('should create every item of an atomic bulk under the AdGroup', async (): Promise<void> => {
      const result: BulkResult<TargetingGroup> = await service.bulkCreate(JANE, IDS.organization, AD_GROUP_ID, {
        mode: 'atomic',
        items: [{ name: 'Île-de-France' }, { name: 'Grand Est' }],
      });

      expect(result.items).toHaveLength(2);
      expect(result.failed).toEqual([]);
    });

    it('should report what a partial bulk could not create', async (): Promise<void> => {
      seedAbove(db, targetingGroupRow(), [targetingGroupRow({ id: OTHER_TARGETING_GROUP_ID, budgetCents: 90_000 })]);

      const result: BulkResult<TargetingGroup> = await service.bulkCreate(JANE, IDS.organization, AD_GROUP_ID, {
        mode: 'partial',
        items: [{ name: 'Île-de-France' }, { name: 'Trop chère', budgetCents: 50_000 }],
      });

      expect(result.items).toHaveLength(1);
      expect(result.failed).toEqual([
        { index: 1, code: 'budget_exceeds_parent', params: expect.any(Object), message: expect.any(String) },
      ]);
    });

    it('should update, delete and restore several TargetingGroups', async (): Promise<void> => {
      await expect(
        service.bulkUpdate(JANE, IDS.organization, {
          mode: 'atomic',
          items: [{ id: TARGETING_GROUP_ID, name: 'Île-de-France' }],
        })
      ).resolves.toMatchObject({ items: [{ id: TARGETING_GROUP_ID }] });

      await expect(
        service.bulkDelete(JANE, IDS.organization, { mode: 'atomic', ids: [TARGETING_GROUP_ID] })
      ).resolves.toMatchObject({ items: [{ id: TARGETING_GROUP_ID }] });

      seedAbove(db, targetingGroupRow({ deletedAt: NOW }));
      await expect(
        service.bulkRestore(JANE, IDS.organization, { mode: 'atomic', ids: [TARGETING_GROUP_ID] })
      ).resolves.toMatchObject({ items: [{ id: TARGETING_GROUP_ID, deletedAt: null }] });
    });

    it('should refuse a bulk naming the same TargetingGroup twice', async (): Promise<void> => {
      for (const call of [
        service.bulkUpdate(JANE, IDS.organization, {
          mode: 'atomic',
          items: [
            { id: TARGETING_GROUP_ID, name: 'A' },
            { id: TARGETING_GROUP_ID, name: 'B' },
          ],
        }),
        service.bulkDelete(JANE, IDS.organization, { mode: 'atomic', ids: [TARGETING_GROUP_ID, TARGETING_GROUP_ID] }),
        service.bulkRestore(JANE, IDS.organization, { mode: 'atomic', ids: [TARGETING_GROUP_ID, TARGETING_GROUP_ID] }),
      ]) {
        await expect(call).rejects.toMatchObject({ statusCode: 400, errorCode: 'bulk_ids_duplicated' });
      }
    });
  });

  describe('TargetingGroupServicePlugin', () => {
    it('should decorate the instance with a TargetingGroupService wired to its dependencies', async (): Promise<void> => {
      const app: FastifyInstance = await buildServiceApp([LabelServicePlugin, TargetingGroupServicePlugin], {
        db,
        access,
      });

      expect(app.targetingGroupService).toBeInstanceOf(TargetingGroupService);
      await expect(app.targetingGroupService.get(JANE, IDS.organization, TARGETING_GROUP_ID)).resolves.toMatchObject({
        id: TARGETING_GROUP_ID,
      });

      await app.close();
    });
  });

  describe('refusals of the access service', () => {
    it('should let a refused role travel out untouched', async (): Promise<void> => {
      access.assertOrganizationRole.mockRejectedValue(
        httpError(403, 'Requires the manager role', { code: 'role_required' })
      );

      await expect(
        service.create(JANE, IDS.organization, AD_GROUP_ID, { name: 'Île-de-France' })
      ).rejects.toMatchObject({ statusCode: 403, errorCode: 'role_required' });
      expect(db.mocks.transaction).not.toHaveBeenCalled();
    });
  });
});
