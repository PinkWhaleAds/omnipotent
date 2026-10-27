import { FastifyInstance } from 'fastify';

import { CampaignEntity, LeverEntity } from '@src/database/entities';
import CampaignServicePlugin, { CampaignService, toCampaign } from '@src/services/campaign.service';
import LabelServicePlugin, { LabelService } from '@src/services/label.service';
import { Paginated } from '@src/types/api.types';
import { Campaign, ListCampaignsQuery } from '@src/types/campaign.types';
import { BulkResult, DeletionResult } from '@src/types/crud.types';
import { LabelSummary } from '@src/types/label.types';
import { BudgetBlock } from '@src/types/tree.types';
import { AccessServiceMock, buildServiceApp, createAccessMock } from '@test/unit/mocks/access.mock';
import { IDS, JANE, NOW } from '@test/unit/mocks/auth.fixtures';
import { createDataSourceMock, DataSourceMock, QueryBuilderMock } from '@test/unit/mocks/data-source.mock';
import { httpError } from '@utils';

/** The instant every row is created and updated at, as the API writes it. */
const ISO: string = NOW.toISOString();

/** Ids of the campaigns the specs work with. */
const CAMPAIGN_ID = 'f1000000-0000-4000-8000-000000000001';
const OTHER_CAMPAIGN_ID = 'f1000000-0000-4000-8000-000000000002';

/** A Label as a campaign carries it. */
const SPRING: LabelSummary = { id: 'e0000000-0000-4000-8000-000000000001', name: 'Printemps', color: '#1f6feb' };

/** The query a list route hands the service when the caller asked for nothing in particular. */
const DEFAULT_QUERY: ListCampaignsQuery = {
  page: 1,
  limit: 50,
  sortBy: 'name',
  sortOrder: 'asc',
  labelMode: 'any',
  includeDeleted: false,
};

/** Jest mocks of the {@link LabelService} methods a campaign needs. */
type LabelServiceMock = { setOn: jest.Mock; summariesOf: jest.Mock };

/**
 * Build a Campaign row.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function campaignRow(overrides: Partial<CampaignEntity> = {}): CampaignEntity {
  return {
    id: CAMPAIGN_ID,
    organizationId: IDS.organization,
    advertiserId: IDS.advertiser,
    name: 'Herbéa — Automne',
    status: 'draft',
    currency: 'EUR',
    timezone: null,
    startsOn: '2026-11-05',
    endsOn: '2026-11-20',
    budgetCents: 100_000,
    budgetVolume: null,
    budgetVolumeUnit: null,
    capping: null,
    insertionOrderNumber: null,
    containsPoliticalAdvertising: false,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  } as CampaignEntity;
}

/** The budget block a campaign of 1 000 € answers: explicit, and split on nothing. */
const BUDGET: BudgetBlock = {
  explicitCents: 100_000,
  effectiveCents: 100_000,
  source: 'explicit',
  volume: null,
  perPlatform: [],
};

/** The API shape of {@link campaignRow}, with no Label. */
const AUTOMNE: Campaign = {
  id: CAMPAIGN_ID,
  organizationId: IDS.organization,
  advertiserId: IDS.advertiser,
  name: 'Herbéa — Automne',
  status: 'draft',
  currency: 'EUR',
  timezone: null,
  startsOn: '2026-11-05',
  endsOn: '2026-11-20',
  budget: BUDGET,
  capping: [],
  insertionOrderNumber: null,
  containsPoliticalAdvertising: false,
  labels: [],
  createdAt: ISO,
  updatedAt: ISO,
  deletedAt: null,
};

describe('Unit::Services::CampaignService', () => {
  let db: DataSourceMock;
  let access: AccessServiceMock;
  let labels: LabelServiceMock;
  let service: CampaignService;

  beforeEach((): void => {
    db = createDataSourceMock();
    access = createAccessMock();
    labels = { setOn: jest.fn().mockResolvedValue([SPRING]), summariesOf: jest.fn().mockResolvedValue(new Map()) };
    service = new CampaignService(db.dataSource, access as never, labels as unknown as LabelService);
    // The Advertiser the campaigns hang from exists, and no lever is attached yet.
    db.manager.exists.mockResolvedValue(true);
  });

  describe('toCampaign', () => {
    it('should map a row to its API shape, dates as ISO strings', (): void => {
      expect(toCampaign(campaignRow(), BUDGET)).toEqual(AUTOMNE);
    });

    it('should read an absent capping as an explicit absence of caps', (): void => {
      expect(toCampaign(campaignRow({ capping: [{ maxImpressions: 3, period: 'day' }] }), BUDGET).capping).toEqual([
        { maxImpressions: 3, period: 'day' },
      ]);
      expect(toCampaign(campaignRow(), BUDGET).capping).toEqual([]);
    });

    it('should carry the deletion instant and the Labels', (): void => {
      const campaign: Campaign = toCampaign(campaignRow({ deletedAt: NOW }), BUDGET, [SPRING]);

      expect(campaign).toMatchObject({ deletedAt: ISO, labels: [SPRING] });
    });
  });

  describe('list', () => {
    it('should list the campaigns of the Advertiser, read by a viewer', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('campaign');
      builder.getManyAndCount.mockResolvedValue([[campaignRow()], 1]);
      labels.summariesOf.mockResolvedValue(new Map([[CAMPAIGN_ID, [SPRING]]]));

      const page: Paginated<Campaign> = await service.list(JANE, IDS.organization, IDS.advertiser, DEFAULT_QUERY);

      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
      expect(page).toEqual({ items: [{ ...AUTOMNE, labels: [SPRING] }], total: 1, page: 1, limit: 50 });
      expect(builder.andWhere).toHaveBeenCalledWith('campaign.advertiser_id = :advertiserId', {
        advertiserId: IDS.advertiser,
      });
      expect(builder.andWhere).toHaveBeenCalledWith('campaign.deleted_at IS NULL');
    });

    it('should search the name without case nor accents, and list the deleted ones when asked', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('campaign');

      await service.list(JANE, IDS.organization, IDS.advertiser, {
        ...DEFAULT_QUERY,
        search: 'Été',
        includeDeleted: true,
        sortBy: 'startsOn',
        sortOrder: 'desc',
      });

      expect(builder.andWhere).not.toHaveBeenCalledWith('campaign.deleted_at IS NULL');
      expect(builder.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE :search'), { search: '%Ete%' });
      expect(builder.addOrderBy).toHaveBeenCalledWith('campaign.startsOn', 'DESC');
    });

    it('should filter on Labels', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('campaign');

      await service.list(JANE, IDS.organization, IDS.advertiser, {
        ...DEFAULT_QUERY,
        labelIds: [SPRING.id],
        labelMode: 'all',
      });

      expect(builder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('HAVING COUNT(DISTINCT assignment.label_id)'),
        expect.objectContaining({ labelResourceType: 'campaign' })
      );
    });

    it('should answer 404 for an Advertiser of another Organization', async (): Promise<void> => {
      db.manager.exists.mockResolvedValue(false);

      await expect(service.list(JANE, IDS.organization, IDS.advertiser, DEFAULT_QUERY)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'advertiser_not_found',
      });
    });
  });

  describe('get', () => {
    it('should read one campaign, deleted or not', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(campaignRow());

      await expect(service.get(JANE, IDS.organization, CAMPAIGN_ID)).resolves.toEqual(AUTOMNE);
      expect(db.manager.findOne).toHaveBeenCalledWith(CampaignEntity, {
        where: { id: CAMPAIGN_ID, organizationId: IDS.organization },
        withDeleted: true,
      });
    });

    it('should answer 404 for a campaign of another Organization', async (): Promise<void> => {
      await expect(service.get(JANE, IDS.organization, CAMPAIGN_ID)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'campaign_not_found',
      });
    });
  });

  describe('create', () => {
    it('should create a campaign with its budget, its window and its Labels', async (): Promise<void> => {
      db.manager.save.mockResolvedValue(campaignRow());

      await expect(
        service.create(JANE, IDS.organization, IDS.advertiser, {
          name: 'Herbéa — Automne',
          currency: 'EUR',
          startsOn: '2026-11-05',
          endsOn: '2026-11-20',
          budgetCents: 100_000,
          containsPoliticalAdvertising: false,
          labelIds: [SPRING.id],
        })
      ).resolves.toEqual({ ...AUTOMNE, labels: [SPRING] });
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'manager');
      expect(labels.setOn).toHaveBeenCalledWith(db.manager, IDS.organization, 'campaign', CAMPAIGN_ID, [SPRING.id]);
    });

    it('should create a campaign with no Label and no timezone of its own', async (): Promise<void> => {
      db.manager.save.mockResolvedValue(campaignRow());

      await expect(
        service.create(JANE, IDS.organization, IDS.advertiser, {
          name: 'Herbéa — Automne',
          currency: 'EUR',
          startsOn: '2026-11-05',
          endsOn: '2026-11-20',
          budgetCents: 100_000,
          containsPoliticalAdvertising: false,
        })
      ).resolves.toEqual(AUTOMNE);
      expect(db.manager.create).toHaveBeenCalledWith(
        CampaignEntity,
        expect.objectContaining({ timezone: null, capping: null, insertionOrderNumber: null, budgetCents: 100_000 })
      );
      expect(labels.setOn).not.toHaveBeenCalled();
    });

    it('should store the political advertising declaration as the user gave it', async (): Promise<void> => {
      db.manager.save.mockResolvedValue(campaignRow({ containsPoliticalAdvertising: true }));

      await expect(
        service.create(JANE, IDS.organization, IDS.advertiser, {
          name: 'Herbéa — Automne',
          currency: 'EUR',
          startsOn: '2026-11-05',
          endsOn: '2026-11-20',
          budgetCents: 100_000,
          containsPoliticalAdvertising: true,
        })
      ).resolves.toMatchObject({ containsPoliticalAdvertising: true });
      // Nothing is assumed here: the declaration is the advertiser's, and the preview is what refuses
      // it (D53). Saving a draft that says yes is allowed, launching it is not.
      expect(db.manager.create).toHaveBeenCalledWith(
        CampaignEntity,
        expect.objectContaining({ containsPoliticalAdvertising: true })
      );
    });

    it('should accept on a campaign with no lever what a Search lever would refuse', async (): Promise<void> => {
      db.manager.save.mockResolvedValue(campaignRow({ capping: [{ maxImpressions: 3, period: 'day' }] }));

      await expect(
        service.create(JANE, IDS.organization, IDS.advertiser, {
          name: 'Herbéa — Automne',
          currency: 'EUR',
          startsOn: '2026-11-05',
          endsOn: '2026-11-20',
          budgetCents: 100_000,
          containsPoliticalAdvertising: false,
          capping: [{ maxImpressions: 3, period: 'day' }],
        })
      ).resolves.toMatchObject({ capping: [{ maxImpressions: 3, period: 'day' }] });
    });

    it('should refuse a window that ends before it starts', async (): Promise<void> => {
      await expect(
        service.create(JANE, IDS.organization, IDS.advertiser, {
          name: 'Herbéa — Automne',
          currency: 'EUR',
          startsOn: '2026-11-20',
          endsOn: '2026-11-05',
          budgetCents: 100_000,
          containsPoliticalAdvertising: false,
        })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'dates_reversed' });
      expect(db.manager.save).not.toHaveBeenCalled();
    });

    it('should refuse an Advertiser of another Organization', async (): Promise<void> => {
      db.manager.exists.mockResolvedValue(false);

      await expect(
        service.create(JANE, IDS.organization, IDS.advertiser, {
          name: 'Herbéa — Automne',
          currency: 'EUR',
          startsOn: '2026-11-05',
          endsOn: '2026-11-20',
          budgetCents: 100_000,
          containsPoliticalAdvertising: false,
        })
      ).rejects.toMatchObject({ statusCode: 404, errorCode: 'advertiser_not_found' });
    });
  });

  describe('update', () => {
    beforeEach((): void => {
      db.manager.findOne.mockResolvedValue(campaignRow());
      db.manager.save.mockResolvedValue(campaignRow({ name: 'Herbéa — Hiver' }));
    });

    it('should rename a campaign and leave the rest alone', async (): Promise<void> => {
      await expect(
        service.update(JANE, IDS.organization, CAMPAIGN_ID, { name: 'Herbéa — Hiver' })
      ).resolves.toMatchObject({ name: 'Herbéa — Hiver' });
      expect(db.manager.save).toHaveBeenCalledWith(CampaignEntity, expect.objectContaining({ name: 'Herbéa — Hiver' }));
    });

    it('should let the political declaration be corrected', async (): Promise<void> => {
      db.manager.save.mockResolvedValue(campaignRow({ containsPoliticalAdvertising: true }));

      await expect(
        service.update(JANE, IDS.organization, CAMPAIGN_ID, { containsPoliticalAdvertising: true })
      ).resolves.toMatchObject({ containsPoliticalAdvertising: true });
      expect(db.manager.save).toHaveBeenCalledWith(
        CampaignEntity,
        expect.objectContaining({ containsPoliticalAdvertising: true })
      );
    });

    it('should refuse to declare a launched campaign as political advertising', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(campaignRow({ status: 'active' }));

      await expect(
        service.update(JANE, IDS.organization, CAMPAIGN_ID, { containsPoliticalAdvertising: true })
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'campaign_political_advertising_unsupported',
        errorParams: { status: 'active' },
      });
      expect(db.manager.save).not.toHaveBeenCalled();
    });

    it('should change the window, the timezone and the order number', async (): Promise<void> => {
      await service.update(JANE, IDS.organization, CAMPAIGN_ID, {
        startsOn: '2026-11-06',
        endsOn: '2026-11-19',
        timezone: 'Europe/Paris',
        insertionOrderNumber: 'IO-4412',
      });

      expect(db.manager.save).toHaveBeenCalledWith(
        CampaignEntity,
        expect.objectContaining({
          startsOn: '2026-11-06',
          endsOn: '2026-11-19',
          timezone: 'Europe/Paris',
          insertionOrderNumber: 'IO-4412',
        })
      );
    });

    it('should refuse a capping once the campaign carries a Search lever', async (): Promise<void> => {
      db.manager.find.mockResolvedValue([{ lever: 'search' }, { lever: 'dac' }]);

      await expect(
        service.update(JANE, IDS.organization, CAMPAIGN_ID, { capping: [{ maxImpressions: 3, period: 'day' }] })
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'lever_field_forbidden',
        errorParams: { lever: 'search', level: 'campaign', field: 'capping' },
      });
    });

    it('should read the levers of the campaign to know what it may carry', async (): Promise<void> => {
      db.manager.find.mockResolvedValue([{ lever: 'dac' }, { lever: 'dac' }]);

      await service.update(JANE, IDS.organization, CAMPAIGN_ID, { capping: [{ maxImpressions: 3, period: 'day' }] });

      expect(db.manager.find).toHaveBeenCalledWith(LeverEntity, {
        where: { campaignId: CAMPAIGN_ID },
        select: { lever: true },
      });
    });

    it('should accept a body changing nothing', async (): Promise<void> => {
      await expect(service.update(JANE, IDS.organization, CAMPAIGN_ID, {})).resolves.toMatchObject({
        id: CAMPAIGN_ID,
      });
    });

    it('should answer 404 for a campaign of another Organization', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(service.update(JANE, IDS.organization, CAMPAIGN_ID, { name: 'Hiver' })).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'campaign_not_found',
      });
    });
  });

  describe('delete and restore', () => {
    it('should soft-delete a campaign and answer when', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(campaignRow());

      const result: DeletionResult = await service.delete(JANE, IDS.organization, CAMPAIGN_ID);

      expect(result.id).toBe(CAMPAIGN_ID);
      expect(Date.parse(result.deletedAt as string)).not.toBeNaN();
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'manager');
    });

    it('should restore a deleted campaign', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(campaignRow({ deletedAt: NOW }));

      await expect(service.restore(JANE, IDS.organization, CAMPAIGN_ID)).resolves.toEqual({
        id: CAMPAIGN_ID,
        deletedAt: null,
      });
    });

    it('should answer 409 for a campaign that is not deleted', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(campaignRow());

      await expect(service.restore(JANE, IDS.organization, CAMPAIGN_ID)).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'campaign_not_deleted',
      });
    });
  });

  describe('setLabels', () => {
    it('should replace the Labels of a campaign', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(campaignRow());

      await expect(service.setLabels(JANE, IDS.organization, CAMPAIGN_ID, { labelIds: [SPRING.id] })).resolves.toEqual({
        ...AUTOMNE,
        labels: [SPRING],
      });
      expect(labels.setOn).toHaveBeenCalledWith(db.manager, IDS.organization, 'campaign', CAMPAIGN_ID, [SPRING.id]);
    });

    it('should answer 404 for a deleted campaign', async (): Promise<void> => {
      await expect(service.setLabels(JANE, IDS.organization, CAMPAIGN_ID, { labelIds: [] })).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'campaign_not_found',
      });
      expect(labels.setOn).not.toHaveBeenCalled();
    });
  });

  describe('the bulk routes', () => {
    it('should create every item of an atomic bulk under the Advertiser', async (): Promise<void> => {
      db.manager.save.mockResolvedValue(campaignRow());

      const result: BulkResult<Campaign> = await service.bulkCreate(JANE, IDS.organization, IDS.advertiser, {
        mode: 'atomic',
        items: [
          {
            name: 'Automne',
            currency: 'EUR',
            startsOn: '2026-11-05',
            endsOn: '2026-11-20',
            budgetCents: 100_000,
            containsPoliticalAdvertising: false,
          },
          {
            name: 'Hiver',
            currency: 'EUR',
            startsOn: '2026-12-01',
            endsOn: '2026-12-31',
            budgetCents: 200_000,
            containsPoliticalAdvertising: false,
          },
        ],
      });

      expect(result.items).toHaveLength(2);
      expect(result.failed).toEqual([]);
    });

    it('should report what a partial bulk could not create', async (): Promise<void> => {
      db.manager.save.mockResolvedValue(campaignRow());

      const result: BulkResult<Campaign> = await service.bulkCreate(JANE, IDS.organization, IDS.advertiser, {
        mode: 'partial',
        items: [
          {
            name: 'Automne',
            currency: 'EUR',
            startsOn: '2026-11-05',
            endsOn: '2026-11-20',
            budgetCents: 100_000,
            containsPoliticalAdvertising: false,
          },
          {
            name: 'À l_envers',
            currency: 'EUR',
            startsOn: '2026-12-31',
            endsOn: '2026-12-01',
            budgetCents: 100_000,
            containsPoliticalAdvertising: false,
          },
        ],
      });

      expect(result.items).toHaveLength(1);
      expect(result.failed).toEqual([
        { index: 1, code: 'dates_reversed', params: expect.any(Object), message: expect.any(String) },
      ]);
    });

    it('should update several campaigns, each item naming its own', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(campaignRow());
      db.manager.save.mockResolvedValue(campaignRow());

      const result: BulkResult<Campaign> = await service.bulkUpdate(JANE, IDS.organization, {
        mode: 'atomic',
        items: [
          { id: CAMPAIGN_ID, name: 'Automne' },
          { id: OTHER_CAMPAIGN_ID, name: 'Hiver' },
        ],
      });

      expect(result.items).toHaveLength(2);
    });

    it('should delete and restore several campaigns', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(campaignRow({ deletedAt: NOW }));

      await expect(
        service.bulkRestore(JANE, IDS.organization, { mode: 'atomic', ids: [CAMPAIGN_ID] })
      ).resolves.toMatchObject({ items: [{ id: CAMPAIGN_ID, deletedAt: null }] });

      db.manager.findOne.mockResolvedValue(campaignRow());
      await expect(
        service.bulkDelete(JANE, IDS.organization, { mode: 'atomic', ids: [CAMPAIGN_ID] })
      ).resolves.toMatchObject({ items: [{ id: CAMPAIGN_ID }] });
    });

    it('should refuse a bulk naming the same campaign twice', async (): Promise<void> => {
      for (const call of [
        service.bulkUpdate(JANE, IDS.organization, {
          mode: 'atomic',
          items: [
            { id: CAMPAIGN_ID, name: 'A' },
            { id: CAMPAIGN_ID, name: 'B' },
          ],
        }),
        service.bulkDelete(JANE, IDS.organization, { mode: 'atomic', ids: [CAMPAIGN_ID, CAMPAIGN_ID] }),
        service.bulkRestore(JANE, IDS.organization, { mode: 'atomic', ids: [CAMPAIGN_ID, CAMPAIGN_ID] }),
      ]) {
        await expect(call).rejects.toMatchObject({ statusCode: 400, errorCode: 'bulk_ids_duplicated' });
      }
    });
  });

  describe('CampaignServicePlugin', () => {
    it('should decorate the instance with a CampaignService wired to its dependencies', async (): Promise<void> => {
      const app: FastifyInstance = await buildServiceApp([LabelServicePlugin, CampaignServicePlugin], { db, access });
      db.manager.findOne.mockResolvedValue(campaignRow());

      expect(app.campaignService).toBeInstanceOf(CampaignService);
      await expect(app.campaignService.get(JANE, IDS.organization, CAMPAIGN_ID)).resolves.toMatchObject({
        id: CAMPAIGN_ID,
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
        service.create(JANE, IDS.organization, IDS.advertiser, {
          name: 'Automne',
          currency: 'EUR',
          startsOn: '2026-11-05',
          endsOn: '2026-11-20',
          budgetCents: 100_000,
          containsPoliticalAdvertising: false,
        })
      ).rejects.toMatchObject({ statusCode: 403, errorCode: 'role_required' });
      expect(db.mocks.transaction).not.toHaveBeenCalled();
    });
  });
});
