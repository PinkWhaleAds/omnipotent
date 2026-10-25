import { FastifyInstance } from 'fastify';

import { CampaignEntity, LeverEntity } from '@src/database/entities';
import LabelServicePlugin, { LabelService } from '@src/services/label.service';
import LeverServicePlugin, { LeverService, toCampaignLever } from '@src/services/lever.service';
import { Paginated } from '@src/types/api.types';
import { CampaignLever, ListLeversQuery } from '@src/types/campaign-lever.types';
import { DeletionResult } from '@src/types/crud.types';
import { LabelSummary } from '@src/types/label.types';
import { PlatformShare } from '@src/types/platform.types';
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

/** A Label as a lever carries it. */
const SPRING: LabelSummary = { id: 'e0000000-0000-4000-8000-000000000001', name: 'Printemps', color: '#1f6feb' };

/** A distribution key of the `dac` lever. */
const SHARES: PlatformShare[] = [
  { platform: 'hawk', shareBasisPoints: 4_000 },
  { platform: 'dv360', shareBasisPoints: 6_000 },
];

/** The query a list route hands the service when the caller asked for nothing in particular. */
const DEFAULT_QUERY: ListLeversQuery = {
  page: 1,
  limit: 50,
  sortBy: 'lever',
  sortOrder: 'asc',
  labelMode: 'any',
  includeDeleted: false,
};

/** The budget block an only lever of a 1 000 € campaign answers. */
const BUDGET: BudgetBlock = {
  explicitCents: null,
  effectiveCents: 100_000,
  source: 'inherited',
  volume: null,
  perPlatform: [
    { platform: 'hawk', shareBasisPoints: 4_000, cents: 40_000 },
    { platform: 'dv360', shareBasisPoints: 6_000, cents: 60_000 },
  ],
};

/** Jest mocks of the {@link LabelService} methods a lever needs. */
type LabelServiceMock = { setOn: jest.Mock; summariesOf: jest.Mock };

/**
 * Build a Campaign row the levers hang from.
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
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  } as CampaignEntity;
}

/**
 * Build a Lever row.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function leverRow(overrides: Partial<LeverEntity> = {}): LeverEntity {
  return {
    id: LEVER_ID,
    organizationId: IDS.organization,
    campaignId: CAMPAIGN_ID,
    lever: 'dac',
    status: 'active',
    productsMode: false,
    platformShares: SHARES,
    budgetCents: null,
    budgetVolume: null,
    budgetVolumeUnit: null,
    startsOn: null,
    endsOn: null,
    capping: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  } as LeverEntity;
}

/** The API shape of {@link leverRow}, with no Label. */
const DAC: CampaignLever = {
  id: LEVER_ID,
  organizationId: IDS.organization,
  campaignId: CAMPAIGN_ID,
  lever: 'dac',
  status: 'active',
  productsMode: false,
  platformShares: SHARES,
  budget: BUDGET,
  startsOn: null,
  endsOn: null,
  capping: null,
  labels: [],
  createdAt: ISO,
  updatedAt: ISO,
  deletedAt: null,
};

describe('Unit::Services::LeverService', () => {
  let db: DataSourceMock;
  let access: AccessServiceMock;
  let labels: LabelServiceMock;
  let service: LeverService;

  beforeEach((): void => {
    db = createDataSourceMock();
    access = createAccessMock();
    labels = { setOn: jest.fn().mockResolvedValue([SPRING]), summariesOf: jest.fn().mockResolvedValue(new Map()) };
    service = new LeverService(db.dataSource, access as never, labels as unknown as LabelService);
    // The campaign the levers hang from, and the siblings that divide its budget.
    db.manager.findOne.mockImplementation(async (entity: unknown) =>
      entity === CampaignEntity ? campaignRow() : leverRow()
    );
    db.manager.find.mockResolvedValue([leverRow()]);
  });

  describe('toCampaignLever', () => {
    it('should map a row to its API shape, dates as ISO strings', (): void => {
      expect(toCampaignLever(leverRow(), BUDGET)).toEqual(DAC);
    });

    it('should carry the deletion instant, the window and the Labels', (): void => {
      const lever: CampaignLever = toCampaignLever(
        leverRow({ deletedAt: NOW, startsOn: '2026-11-10', endsOn: '2026-11-15' }),
        BUDGET,
        [SPRING]
      );

      expect(lever).toMatchObject({
        deletedAt: ISO,
        startsOn: '2026-11-10',
        endsOn: '2026-11-15',
        labels: [SPRING],
      });
    });
  });

  describe('list', () => {
    it('should list the levers of the campaign, read by a viewer', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('lever');
      builder.getManyAndCount.mockResolvedValue([[leverRow()], 1]);
      labels.summariesOf.mockResolvedValue(new Map([[LEVER_ID, [SPRING]]]));

      const page: Paginated<CampaignLever> = await service.list(JANE, IDS.organization, CAMPAIGN_ID, DEFAULT_QUERY);

      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
      expect(page).toEqual({ items: [{ ...DAC, labels: [SPRING] }], total: 1, page: 1, limit: 50 });
      expect(builder.andWhere).toHaveBeenCalledWith('lever.campaign_id = :parentId', { parentId: CAMPAIGN_ID });
    });

    it('should answer 404 for a campaign of another Organization', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(service.list(JANE, IDS.organization, CAMPAIGN_ID, DEFAULT_QUERY)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'campaign_not_found',
      });
    });
  });

  describe('get', () => {
    it('should read one lever, its budget resolved against its campaign', async (): Promise<void> => {
      await expect(service.get(JANE, IDS.organization, LEVER_ID)).resolves.toEqual(DAC);
    });

    it('should answer 404 for a lever of another Organization', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(service.get(JANE, IDS.organization, LEVER_ID)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'lever_not_found',
      });
    });
  });

  describe('create', () => {
    beforeEach((): void => {
      db.manager.save.mockResolvedValue(leverRow());
    });

    it('should add a lever with its distribution key and its Labels', async (): Promise<void> => {
      await expect(
        service.create(JANE, IDS.organization, CAMPAIGN_ID, {
          lever: 'dac',
          platformShares: SHARES,
          labelIds: [SPRING.id],
        })
      ).resolves.toEqual({ ...DAC, labels: [SPRING] });
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'manager');
      expect(labels.setOn).toHaveBeenCalledWith(db.manager, IDS.organization, 'lever', LEVER_ID, [SPRING.id]);
    });

    it('should add a lever with no Label', async (): Promise<void> => {
      await expect(
        service.create(JANE, IDS.organization, CAMPAIGN_ID, { lever: 'dac', platformShares: SHARES })
      ).resolves.toEqual(DAC);
      expect(labels.setOn).not.toHaveBeenCalled();
    });

    it('should refuse a platform the channel does not serve', async (): Promise<void> => {
      await expect(
        service.create(JANE, IDS.organization, CAMPAIGN_ID, {
          lever: 'dac',
          platformShares: [{ platform: 'google_ads', shareBasisPoints: 10_000 }],
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'platform_not_eligible',
        errorParams: { platform: 'google_ads', lever: 'dac' },
      });
    });

    it('should refuse a key that does not total a hundred percent', async (): Promise<void> => {
      await expect(
        service.create(JANE, IDS.organization, CAMPAIGN_ID, {
          lever: 'dac',
          platformShares: [{ platform: 'hawk', shareBasisPoints: 9_000 }],
        })
      ).rejects.toMatchObject({ errorCode: 'platform_shares_invalid' });
    });

    it('should refuse a Products mode on a channel that has none', async (): Promise<void> => {
      await expect(
        service.create(JANE, IDS.organization, CAMPAIGN_ID, {
          lever: 'dac',
          platformShares: SHARES,
          productsMode: true,
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'products_mode_not_permitted',
        errorParams: { lever: 'dac' },
      });
    });

    it('should accept a Products mode on the Search', async (): Promise<void> => {
      db.manager.save.mockResolvedValue(
        leverRow({
          lever: 'search',
          productsMode: true,
          platformShares: [{ platform: 'google_ads', shareBasisPoints: 10_000 }],
        })
      );

      await expect(
        service.create(JANE, IDS.organization, CAMPAIGN_ID, {
          lever: 'search',
          platformShares: [{ platform: 'google_ads', shareBasisPoints: 10_000 }],
          productsMode: true,
        })
      ).resolves.toMatchObject({ lever: 'search', productsMode: true });
    });

    it('should refuse a channel that could not express what the campaign already carries', async (): Promise<void> => {
      // The campaign carries a capping; no Search platform expresses one (L6).
      db.manager.findOne.mockImplementation(async (entity: unknown) =>
        entity === CampaignEntity ? campaignRow({ capping: [{ maxImpressions: 3, period: 'day' }] }) : leverRow()
      );

      await expect(
        service.create(JANE, IDS.organization, CAMPAIGN_ID, {
          lever: 'search',
          platformShares: [{ platform: 'google_ads', shareBasisPoints: 10_000 }],
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'lever_field_forbidden',
        errorParams: { lever: 'search', level: 'campaign', field: 'capping' },
      });
    });

    it('should answer 409 when the campaign already carries that channel', async (): Promise<void> => {
      db.manager.save.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));

      await expect(
        service.create(JANE, IDS.organization, CAMPAIGN_ID, { lever: 'dac', platformShares: SHARES })
      ).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'lever_already_exists',
        errorParams: { lever: 'dac' },
      });
    });

    it('should let any other database failure through', async (): Promise<void> => {
      db.manager.save.mockRejectedValue(Object.assign(new Error('connection lost'), { code: '08006' }));

      await expect(
        service.create(JANE, IDS.organization, CAMPAIGN_ID, { lever: 'dac', platformShares: SHARES })
      ).rejects.toThrow('connection lost');
    });

    it('should refuse a window outside the campaign', async (): Promise<void> => {
      await expect(
        service.create(JANE, IDS.organization, CAMPAIGN_ID, {
          lever: 'dac',
          platformShares: SHARES,
          startsOn: '2026-10-01',
          endsOn: '2026-11-10',
        })
      ).rejects.toMatchObject({ errorCode: 'dates_outside_parent' });
    });

    it('should answer 404 for a campaign of another Organization', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(
        service.create(JANE, IDS.organization, CAMPAIGN_ID, { lever: 'dac', platformShares: SHARES })
      ).rejects.toMatchObject({ statusCode: 404, errorCode: 'campaign_not_found' });
    });
  });

  describe('update', () => {
    beforeEach((): void => {
      db.manager.save.mockResolvedValue(leverRow({ productsMode: false }));
    });

    it('should change the distribution key', async (): Promise<void> => {
      const key: PlatformShare[] = [{ platform: 'dv360', shareBasisPoints: 10_000 }];
      db.manager.save.mockResolvedValue(leverRow({ platformShares: key }));

      await expect(service.update(JANE, IDS.organization, LEVER_ID, { platformShares: key })).resolves.toMatchObject({
        platformShares: key,
      });
    });

    it('should refuse a key the channel cannot serve', async (): Promise<void> => {
      await expect(
        service.update(JANE, IDS.organization, LEVER_ID, {
          platformShares: [{ platform: 'meta', shareBasisPoints: 10_000 }],
        })
      ).rejects.toMatchObject({ errorCode: 'platform_not_eligible' });
    });

    it('should refuse a Products mode the channel has not', async (): Promise<void> => {
      await expect(service.update(JANE, IDS.organization, LEVER_ID, { productsMode: true })).rejects.toMatchObject({
        errorCode: 'products_mode_not_permitted',
      });
    });

    it('should accept turning the Products mode off', async (): Promise<void> => {
      await expect(service.update(JANE, IDS.organization, LEVER_ID, { productsMode: false })).resolves.toMatchObject({
        productsMode: false,
      });
    });

    it('should accept a budget that fits in the campaign', async (): Promise<void> => {
      db.manager.save.mockResolvedValue(leverRow({ budgetCents: 60_000 }));

      await expect(service.update(JANE, IDS.organization, LEVER_ID, { budgetCents: 60_000 })).resolves.toMatchObject({
        id: LEVER_ID,
      });
    });

    it('should accept a body changing nothing', async (): Promise<void> => {
      await expect(service.update(JANE, IDS.organization, LEVER_ID, {})).resolves.toMatchObject({ id: LEVER_ID });
    });

    it('should answer 404 for a lever of another Organization', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(service.update(JANE, IDS.organization, LEVER_ID, {})).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'lever_not_found',
      });
    });
  });

  describe('delete and restore', () => {
    it('should soft-delete a lever, which frees its channel', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(leverRow());

      const result: DeletionResult = await service.delete(JANE, IDS.organization, LEVER_ID);

      expect(result.id).toBe(LEVER_ID);
      expect(Date.parse(result.deletedAt as string)).not.toBeNaN();
    });

    it('should restore a deleted lever when its channel is free', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(leverRow({ deletedAt: NOW }));
      db.manager.exists.mockResolvedValue(false);

      await expect(service.restore(JANE, IDS.organization, LEVER_ID)).resolves.toEqual({
        id: LEVER_ID,
        deletedAt: null,
      });
    });

    it('should refuse to restore a lever whose channel was taken again', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(leverRow({ deletedAt: NOW }));
      db.manager.exists.mockResolvedValue(true);

      await expect(service.restore(JANE, IDS.organization, LEVER_ID)).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'lever_already_exists',
        errorParams: { lever: 'dac' },
      });
    });

    it('should answer 409 for a lever that is not deleted', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(leverRow());
      db.manager.exists.mockResolvedValue(false);

      await expect(service.restore(JANE, IDS.organization, LEVER_ID)).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'lever_not_deleted',
      });
    });
  });

  describe('setLabels', () => {
    it('should replace the Labels of a lever', async (): Promise<void> => {
      await expect(service.setLabels(JANE, IDS.organization, LEVER_ID, { labelIds: [SPRING.id] })).resolves.toEqual({
        ...DAC,
        labels: [SPRING],
      });
    });

    it('should answer 404 for a deleted lever', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(service.setLabels(JANE, IDS.organization, LEVER_ID, { labelIds: [] })).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'lever_not_found',
      });
    });
  });

  describe('LeverServicePlugin', () => {
    it('should decorate the instance with a LeverService wired to its dependencies', async (): Promise<void> => {
      const app: FastifyInstance = await buildServiceApp([LabelServicePlugin, LeverServicePlugin], { db, access });
      db.manager.findOne.mockResolvedValue(leverRow());

      expect(app.leverService).toBeInstanceOf(LeverService);
      await expect(app.leverService.get(JANE, IDS.organization, LEVER_ID)).resolves.toMatchObject({ id: LEVER_ID });

      await app.close();
    });
  });

  describe('refusals of the access service', () => {
    it('should let a refused role travel out untouched', async (): Promise<void> => {
      access.assertOrganizationRole.mockRejectedValue(
        httpError(403, 'Requires the manager role', { code: 'role_required' })
      );

      await expect(
        service.create(JANE, IDS.organization, CAMPAIGN_ID, { lever: 'dac', platformShares: SHARES })
      ).rejects.toMatchObject({ statusCode: 403, errorCode: 'role_required' });
      expect(db.mocks.transaction).not.toHaveBeenCalled();
    });
  });
});
