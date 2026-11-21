import { FastifyInstance } from 'fastify';

import { AdvertiserEntity, ConversionGoalEntity } from '@src/database/entities';
import ConversionGoalServicePlugin, {
  ConversionGoalService,
  toConversionGoal,
} from '@src/services/conversion-goal.service';
import { ConversionGoal, CreateConversionGoalBody } from '@src/types';
import { AccessServiceMock, buildServiceApp, createAccessMock } from '@test/unit/mocks/access.mock';
import { IDS, JANE, NOW } from '@test/unit/mocks/auth.fixtures';
import { createDataSourceMock, DataSourceMock, QueryBuilderMock } from '@test/unit/mocks/data-source.mock';
import { httpError } from '@utils';

/** The goal the specs work with. */
const GOAL_ID = 'f0000000-0000-4000-8000-000000000001';

/** The instant every row is created and updated at, as the API writes it. */
const ISO: string = NOW.toISOString();

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

/** The API shape of {@link goalRow}. */
const ACHAT: ConversionGoal = {
  id: GOAL_ID,
  advertiserId: IDS.advertiser,
  key: 'achat',
  name: 'Achat',
  category: 'purchase',
  valueMode: 'dynamic',
  defaultValueCents: 8_900,
  currency: 'EUR',
  counting: 'every',
  status: 'active',
  createdAt: ISO,
  updatedAt: ISO,
};

/** The body creating {@link ACHAT}, defaults applied. */
const CREATE: CreateConversionGoalBody = {
  key: 'achat',
  name: 'Achat',
  category: 'purchase',
  valueMode: 'dynamic',
  defaultValueCents: 8_900,
  currency: 'EUR',
  counting: 'every',
};

describe('Unit::Services::ConversionGoalService', () => {
  let db: DataSourceMock;
  let access: AccessServiceMock;
  let tracking: { request: jest.Mock };
  let service: ConversionGoalService;

  beforeEach((): void => {
    db = createDataSourceMock();
    access = createAccessMock();
    tracking = { request: jest.fn().mockResolvedValue(undefined) };
    service = new ConversionGoalService(db.dataSource, access as never, tracking);
    db.manager.exists.mockResolvedValue(true);
  });

  it('should map a row to its API shape', (): void => {
    expect(toConversionGoal(goalRow())).toEqual(ACHAT);
  });

  describe('list', () => {
    it('should list the goals of an Advertiser oldest first, as a viewer', async (): Promise<void> => {
      db.repository(ConversionGoalEntity).findAndCount.mockResolvedValue([[goalRow()], 1]);

      await expect(service.list(JANE, IDS.organization, IDS.advertiser, { page: 2, limit: 10 })).resolves.toEqual({
        items: [ACHAT],
        total: 1,
        page: 2,
        limit: 10,
      });
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
      expect(db.manager.exists).toHaveBeenCalledWith(AdvertiserEntity, {
        where: { id: IDS.advertiser, organizationId: IDS.organization },
      });
      expect(db.repository(ConversionGoalEntity).findAndCount).toHaveBeenCalledWith({
        where: { organizationId: IDS.organization, advertiserId: IDS.advertiser },
        order: { createdAt: 'ASC', id: 'ASC' },
        skip: 10,
        take: 10,
      });
    });

    it('should filter the goals by status', async (): Promise<void> => {
      await service.list(JANE, IDS.organization, IDS.advertiser, { page: 1, limit: 50, status: 'archived' });

      expect(db.repository(ConversionGoalEntity).findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'archived' }) })
      );
    });

    it('should answer 404 for an Advertiser the Organization does not have', async (): Promise<void> => {
      db.manager.exists.mockResolvedValue(false);

      await expect(service.list(JANE, IDS.organization, IDS.advertiser, { page: 1, limit: 50 })).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'advertiser_not_found',
      });
    });
  });

  describe('get', () => {
    it('should read a goal of the Organization', async (): Promise<void> => {
      db.repository(ConversionGoalEntity).findOneBy.mockResolvedValue(goalRow());

      await expect(service.get(JANE, IDS.organization, GOAL_ID)).resolves.toEqual(ACHAT);
      expect(db.repository(ConversionGoalEntity).findOneBy).toHaveBeenCalledWith({
        id: GOAL_ID,
        organizationId: IDS.organization,
      });
    });

    it('should answer 404 for a goal of another Organization', async (): Promise<void> => {
      await expect(service.get(JANE, IDS.organization, GOAL_ID)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'conversion_goal_not_found',
      });
    });
  });

  describe('create', () => {
    it('should create an active goal as a manager, then ask for its setup', async (): Promise<void> => {
      db.repository(ConversionGoalEntity).save.mockResolvedValue(goalRow());

      await expect(service.create(JANE, IDS.organization, IDS.advertiser, CREATE)).resolves.toEqual(ACHAT);
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'manager');
      expect(db.repository(ConversionGoalEntity).create).toHaveBeenCalledWith({
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
      });
      expect(tracking.request).toHaveBeenCalledWith(IDS.advertiser);
    });

    it('should keep neither amount nor currency on a goal without value', async (): Promise<void> => {
      await service.create(JANE, IDS.organization, IDS.advertiser, {
        ...CREATE,
        valueMode: 'none',
        defaultValueCents: 100,
        currency: 'EUR',
      });

      expect(db.repository(ConversionGoalEntity).create).toHaveBeenCalledWith(
        expect.objectContaining({ valueMode: 'none', defaultValueCents: null, currency: null })
      );
    });

    it('should accept a dynamic value without fallback amount', async (): Promise<void> => {
      await service.create(JANE, IDS.organization, IDS.advertiser, { ...CREATE, defaultValueCents: undefined });

      expect(db.repository(ConversionGoalEntity).create).toHaveBeenCalledWith(
        expect.objectContaining({ valueMode: 'dynamic', defaultValueCents: null, currency: 'EUR' })
      );
    });

    it('should refuse a value without currency', async (): Promise<void> => {
      await expect(
        service.create(JANE, IDS.organization, IDS.advertiser, { ...CREATE, currency: undefined })
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'conversion_goal_currency_required',
        errorParams: { valueMode: 'dynamic' },
      });
      expect(tracking.request).not.toHaveBeenCalled();
    });

    it('should refuse a fixed value without amount', async (): Promise<void> => {
      await expect(
        service.create(JANE, IDS.organization, IDS.advertiser, {
          ...CREATE,
          valueMode: 'fixed',
          defaultValueCents: null,
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'conversion_goal_value_required',
        errorParams: { valueMode: 'fixed' },
      });
    });

    it('should refuse a key the Advertiser already has, archived goals included', async (): Promise<void> => {
      db.repository(ConversionGoalEntity).find.mockResolvedValue([goalRow({ status: 'archived' })]);

      await expect(service.create(JANE, IDS.organization, IDS.advertiser, CREATE)).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'conversion_goal_key_taken',
        errorParams: { key: 'achat' },
      });
      expect(db.repository(ConversionGoalEntity).find).toHaveBeenCalledWith({
        where: { advertiserId: IDS.advertiser },
        select: { id: true, key: true },
      });
    });

    it('should refuse a key differing from another only by a dash and an underscore', async (): Promise<void> => {
      db.repository(ConversionGoalEntity).find.mockResolvedValue([
        goalRow({ key: 'devis-pro' }),
        goalRow({ key: 'lead' }),
      ]);

      await expect(
        service.create(JANE, IDS.organization, IDS.advertiser, { ...CREATE, key: 'devis_pro' })
      ).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'conversion_goal_key_too_close',
        errorParams: { key: 'devis_pro', existingKey: 'devis-pro' },
      });
    });

    it('should answer 404 for an Advertiser the Organization does not have', async (): Promise<void> => {
      db.manager.exists.mockResolvedValue(false);

      await expect(service.create(JANE, IDS.organization, IDS.advertiser, CREATE)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'advertiser_not_found',
      });
    });

    it('should let a refused role travel out untouched', async (): Promise<void> => {
      access.assertOrganizationRole.mockRejectedValue(
        httpError(403, 'Requires the manager role', { code: 'role_required' })
      );

      await expect(service.create(JANE, IDS.organization, IDS.advertiser, CREATE)).rejects.toMatchObject({
        statusCode: 403,
        errorCode: 'role_required',
      });
    });
  });

  describe('update', () => {
    /** The query builder of the AdGroups that optimize a goal. */
    let builder: QueryBuilderMock;

    beforeEach((): void => {
      db.repository(ConversionGoalEntity).findOneBy.mockResolvedValue(goalRow());
      builder = db.builder('ad_group');
    });

    it('should change a goal, keeping what the body leaves out, then ask for its setup', async (): Promise<void> => {
      await expect(
        service.update(JANE, IDS.organization, GOAL_ID, { name: 'Achat en ligne', counting: 'one' })
      ).resolves.toMatchObject({
        name: 'Achat en ligne',
        counting: 'one',
        valueMode: 'dynamic',
        defaultValueCents: 8_900,
        currency: 'EUR',
      });
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'manager');
      expect(tracking.request).toHaveBeenCalledWith(IDS.advertiser);
      expect(builder.getRawMany).not.toHaveBeenCalled();
    });

    it('should check the value as it ends up, the body over what is stored', async (): Promise<void> => {
      await expect(service.update(JANE, IDS.organization, GOAL_ID, { valueMode: 'fixed' })).resolves.toMatchObject({
        valueMode: 'fixed',
        defaultValueCents: 8_900,
      });
      await expect(
        service.update(JANE, IDS.organization, GOAL_ID, { valueMode: 'fixed', defaultValueCents: null })
      ).rejects.toMatchObject({ errorCode: 'conversion_goal_value_required' });
      await expect(service.update(JANE, IDS.organization, GOAL_ID, { currency: null })).rejects.toMatchObject({
        errorCode: 'conversion_goal_currency_required',
      });
      await expect(
        service.update(JANE, IDS.organization, GOAL_ID, { defaultValueCents: 1_000, currency: 'USD' })
      ).resolves.toMatchObject({ defaultValueCents: 1_000, currency: 'USD' });
    });

    it('should archive a goal no AdGroup of a launched campaign optimizes', async (): Promise<void> => {
      await expect(service.update(JANE, IDS.organization, GOAL_ID, { status: 'archived' })).resolves.toMatchObject({
        status: 'archived',
      });
      expect(builder.where).toHaveBeenCalledWith('ad_group.conversion_goal_id = :goalId', { goalId: GOAL_ID });
      expect(builder.andWhere).toHaveBeenCalledWith('ad_group.bid_strategy = :strategy', {
        strategy: 'maximize_conversions',
      });
      expect(builder.andWhere).toHaveBeenCalledWith('campaign.status IN (:...statuses)', {
        statuses: ['active', 'paused'],
      });
      expect(builder.limit).toHaveBeenCalledWith(1);
    });

    it('should refuse to archive a goal an AdGroup of a launched campaign optimizes', async (): Promise<void> => {
      const optimizing = {
        adGroupId: 'a0000000-0000-4000-8000-000000000001',
        adGroupName: 'Prospection',
        campaignId: 'a0000000-0000-4000-8000-000000000002',
        campaignName: 'Printemps',
      };
      builder.getRawMany.mockResolvedValue([optimizing]);

      await expect(service.update(JANE, IDS.organization, GOAL_ID, { status: 'archived' })).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'conversion_goal_optimized',
        errorParams: optimizing,
      });
      expect(tracking.request).not.toHaveBeenCalled();
    });

    it('should not look for an optimizing AdGroup when the goal is archived already, or measured again', async (): Promise<void> => {
      db.repository(ConversionGoalEntity).findOneBy.mockResolvedValue(goalRow({ status: 'archived' }));

      await service.update(JANE, IDS.organization, GOAL_ID, { status: 'archived' });
      await service.update(JANE, IDS.organization, GOAL_ID, { status: 'active' });

      expect(builder.getRawMany).not.toHaveBeenCalled();
    });

    it('should answer 404 for a goal of another Organization', async (): Promise<void> => {
      db.repository(ConversionGoalEntity).findOneBy.mockResolvedValue(null);

      await expect(service.update(JANE, IDS.organization, GOAL_ID, { name: 'Achat' })).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'conversion_goal_not_found',
      });
    });
  });

  describe('plugin', () => {
    it('should decorate the instance with the service, asking setups of the tracking scheduler', async (): Promise<void> => {
      const app: FastifyInstance = await buildServiceApp([ConversionGoalServicePlugin], { db, access, tracking });
      db.repository(ConversionGoalEntity).save.mockResolvedValue(goalRow());

      expect(app.conversionGoalService).toBeInstanceOf(ConversionGoalService);
      await app.conversionGoalService.create(JANE, IDS.organization, IDS.advertiser, CREATE);
      expect(tracking.request).toHaveBeenCalledWith(IDS.advertiser);

      await app.close();
    });
  });
});
