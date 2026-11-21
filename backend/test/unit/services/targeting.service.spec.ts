import { FastifyInstance } from 'fastify';

import { GeoLocationEntity, ListEntity, PlatformUnitEntity, TargetingGroupEntity } from '@src/database/entities';
import TargetingServicePlugin, { TargetingService } from '@src/services/targeting.service';
import { Targeting, TargetingResponse } from '@src/types';
import { AccessServiceMock, buildServiceApp, createAccessMock } from '@test/unit/mocks/access.mock';
import { IDS, JANE, NOW } from '@test/unit/mocks/auth.fixtures';
import { createDataSourceMock, DataSourceMock, QueryBuilderMock } from '@test/unit/mocks/data-source.mock';
import { httpError } from '@utils';

/** The TargetingGroup the specs target. */
const NODE_ID = 'f4000000-0000-4000-8000-000000000001';

/** The list the specs reference. */
const LIST_ID = 'fa000000-0000-4000-8000-000000000001';

/**
 * A place of the referential, as its row stands.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function place(overrides: Partial<GeoLocationEntity> = {}): GeoLocationEntity {
  return {
    id: '1006094',
    name: 'Paris',
    canonicalName: 'Paris,Paris,Ile-de-France,France',
    searchText: 'paris | paris paris ile de france france',
    parentId: '20321',
    countryCode: 'FR',
    targetType: 'City',
    level: 'city',
    status: 'Active',
    updatedAt: NOW,
    ...overrides,
  };
}

/**
 * The node as its row stands.
 *
 * Its lever is `dac`, the widest paradigm, so a refusal in these specs is the model's rule and not an
 * accident of the lever.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function node(overrides: Partial<TargetingGroupEntity> = {}): TargetingGroupEntity {
  return {
    id: NODE_ID,
    organizationId: IDS.organization,
    campaignId: 'f1000000-0000-4000-8000-000000000001',
    adGroupId: 'f3000000-0000-4000-8000-000000000001',
    lever: 'dac',
    name: 'Île-de-France',
    status: 'active',
    targeting: {},
    budgetCents: null,
    budgetVolume: null,
    budgetVolumeUnit: null,
    bidAmountCents: null,
    capping: null,
    platformShares: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  } as unknown as TargetingGroupEntity;
}

describe('Unit::Services::TargetingService', () => {
  let db: DataSourceMock;
  let access: AccessServiceMock;
  let geo: { findByIds: jest.Mock };
  let service: TargetingService;

  beforeEach((): void => {
    jest.clearAllMocks();
    db = createDataSourceMock();
    access = createAccessMock();
    geo = { findByIds: jest.fn().mockResolvedValue(new Map()) };
    service = new TargetingService(db.dataSource, access as never, geo as never);
    db.manager.findOne.mockResolvedValue(node());
  });

  describe('get', () => {
    it('should answer what the node targets, its lever, and what that lever permits', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(node({ targeting: { country: { include: ['FR'], exclude: [] } } }));

      const answer: TargetingResponse = await service.get(JANE, IDS.organization, NODE_ID);

      expect(answer).toEqual({
        targetingGroupId: NODE_ID,
        lever: 'dac',
        permittedDimensions: expect.arrayContaining(['country']),
        targeting: { country: { include: ['FR'], exclude: [] } },
      });
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
    });

    it('should not find a node of another Organization, nor a deleted one', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(service.get(JANE, IDS.organization, NODE_ID)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'targeting_group_not_found',
      });
      expect(db.manager.findOne).toHaveBeenCalledWith(TargetingGroupEntity, {
        where: { id: NODE_ID, organizationId: IDS.organization, deletedAt: expect.anything() },
      });
    });
  });

  describe('replace', () => {
    it('should store the criteria with their defaults applied', async (): Promise<void> => {
      const answer: TargetingResponse = await service.replace(JANE, IDS.organization, NODE_ID, {
        country: { include: ['FR'] },
      } as Targeting);

      expect(db.manager.update).toHaveBeenCalledWith(
        TargetingGroupEntity,
        { id: NODE_ID },
        { targeting: { country: { include: ['FR'], exclude: [] } } }
      );
      expect(answer.targeting).toEqual({ country: { include: ['FR'], exclude: [] } });
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'manager');
    });

    it('should mark the units of its campaign, in the same transaction', async (): Promise<void> => {
      await service.replace(JANE, IDS.organization, NODE_ID, { country: { include: ['FR'] } } as Targeting);

      // A country or a radius changed on a launched campaign must reach the platforms.
      expect(db.manager.update).toHaveBeenCalledWith(
        PlatformUnitEntity,
        expect.objectContaining({ campaignId: 'f1000000-0000-4000-8000-000000000001' }),
        { syncState: 'pending', attempts: 0, nextAttemptAt: null }
      );
    });

    it('should accept an empty targeting: a node that restricts nothing is valid', async (): Promise<void> => {
      await expect(service.replace(JANE, IDS.organization, NODE_ID, {})).resolves.toMatchObject({ targeting: {} });
    });

    it('should replace what the node had rather than adding to it', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(node({ targeting: { country: { include: ['FR'], exclude: [] } } }));

      const answer: TargetingResponse = await service.replace(JANE, IDS.organization, NODE_ID, {
        device: { include: ['mobile'] },
      } as Targeting);

      expect(answer.targeting).toEqual({ device: { include: ['mobile'], exclude: [] } });
    });

    it('should refuse a dimension the lever has nothing to do with', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(node({ lever: 'search' }));

      await expect(
        service.replace(JANE, IDS.organization, NODE_ID, { exchange: { include: ['x'] } } as Targeting)
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'targeting_dimension_forbidden',
        errorParams: { lever: 'search', dimension: 'exchange' },
      });
      expect(db.manager.update).not.toHaveBeenCalled();
    });

    it('should refuse criteria that do not hold', async (): Promise<void> => {
      await expect(
        service.replace(JANE, IDS.organization, NODE_ID, { country: { include: ['France'] } } as Targeting)
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'targeting_criteria_invalid' });
    });

    it('should accept a list of the kind the dimension expects', async (): Promise<void> => {
      db.manager.find.mockResolvedValue([{ id: LIST_ID, kind: 'app_site' }]);

      await expect(
        service.replace(JANE, IDS.organization, NODE_ID, { app_site_lists: { include: [LIST_ID] } } as Targeting)
      ).resolves.toMatchObject({ targeting: { app_site_lists: { include: [LIST_ID], exclude: [] } } });
      expect(db.manager.find).toHaveBeenCalledWith(ListEntity, {
        where: {
          organizationId: IDS.organization,
          id: expect.anything(),
          deletedAt: expect.anything(),
        },
      });
    });

    it('should refuse a list that holds something else', async (): Promise<void> => {
      db.manager.find.mockResolvedValue([{ id: LIST_ID, kind: 'poi' }]);

      await expect(
        service.replace(JANE, IDS.organization, NODE_ID, { app_site_lists: { exclude: [LIST_ID] } } as Targeting)
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'targeting_list_kind_mismatch',
        errorParams: { listId: LIST_ID, kind: 'poi', expected: 'app_site' },
      });
    });

    it('should refuse a list that does not exist', async (): Promise<void> => {
      db.manager.find.mockResolvedValue([]);

      await expect(
        service.replace(JANE, IDS.organization, NODE_ID, { app_site_lists: { include: [LIST_ID] } } as Targeting)
      ).rejects.toMatchObject({ statusCode: 404, errorCode: 'list_not_found', errorParams: { listId: LIST_ID } });
    });

    it('should read no list when no dimension references one', async (): Promise<void> => {
      await service.replace(JANE, IDS.organization, NODE_ID, { country: { include: ['FR'] } } as Targeting);

      expect(db.manager.find).not.toHaveBeenCalled();
    });
  });

  describe('setDimension', () => {
    it('should leave the other dimensions alone', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(node({ targeting: { country: { include: ['FR'], exclude: [] } } }));

      const answer: TargetingResponse = await service.setDimension(JANE, IDS.organization, NODE_ID, 'device', {
        include: ['ctv'],
      });

      expect(answer.targeting).toEqual({
        country: { include: ['FR'], exclude: [] },
        device: { include: ['ctv'], exclude: [] },
      });
    });

    it('should replace the criteria that dimension carried', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(node({ targeting: { country: { include: ['FR'], exclude: [] } } }));

      const answer: TargetingResponse = await service.setDimension(JANE, IDS.organization, NODE_ID, 'country', {
        include: ['BE'],
      });

      expect(answer.targeting).toEqual({ country: { include: ['BE'], exclude: [] } });
    });
  });

  describe('the places of location', () => {
    it('should fill each place from the referential, whatever the caller typed beside its id', async (): Promise<void> => {
      geo.findByIds.mockResolvedValue(
        new Map([
          ['1006094', place()],
          [
            '9056126',
            place({ id: '9056126', name: '75001', canonicalName: '75001,Ile-de-France,France', level: 'postal_code' }),
          ],
        ])
      );

      const answer: TargetingResponse = await service.setDimension(JANE, IDS.organization, NODE_ID, 'location', {
        include: [{ id: '1006094', name: 'Lyon', countryCode: 'BE' }],
        exclude: [{ id: '9056126' }],
      });

      const location = {
        include: [
          {
            id: '1006094',
            level: 'city',
            name: 'Paris',
            canonicalName: 'Paris,Paris,Ile-de-France,France',
            countryCode: 'FR',
          },
        ],
        exclude: [
          {
            id: '9056126',
            level: 'postal_code',
            name: '75001',
            canonicalName: '75001,Ile-de-France,France',
            countryCode: 'FR',
          },
        ],
      };
      expect(answer.targeting).toEqual({ location });
      expect(geo.findByIds).toHaveBeenCalledWith(['1006094', '9056126']);
      expect(db.manager.update).toHaveBeenCalledWith(
        TargetingGroupEntity,
        { id: NODE_ID },
        { targeting: { location } }
      );
    });

    it('should fill the places of a whole targeting too', async (): Promise<void> => {
      geo.findByIds.mockResolvedValue(new Map([['1006094', place()]]));

      const answer: TargetingResponse = await service.replace(JANE, IDS.organization, NODE_ID, {
        country: { include: ['FR'] },
        location: { include: [{ id: '1006094' }] },
      } as unknown as Targeting);

      expect(answer.targeting).toMatchObject({
        location: { include: [{ id: '1006094', name: 'Paris' }], exclude: [] },
      });
    });

    it('should refuse an id the referential does not hold, each once', async (): Promise<void> => {
      geo.findByIds.mockResolvedValue(new Map([['1006094', place()]]));

      await expect(
        service.setDimension(JANE, IDS.organization, NODE_ID, 'location', {
          include: [{ id: '1006094' }, { id: '42' }, { id: '42' }],
          exclude: [{ id: '43' }],
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'targeting_location_unknown',
        errorParams: { ids: '42, 43' },
      });
      expect(db.manager.update).not.toHaveBeenCalled();
    });

    it('should refuse a country, a place of a level not offered, one without country, and one Google is removing', async (): Promise<void> => {
      geo.findByIds.mockResolvedValue(
        new Map([
          ['2250', place({ id: '2250', level: 'country' })],
          ['1', place({ id: '1', level: null })],
          ['2', place({ id: '2', countryCode: null })],
          ['3', place({ id: '3', status: 'Removal Planned' })],
          ['1006094', place()],
        ])
      );

      await expect(
        service.setDimension(JANE, IDS.organization, NODE_ID, 'location', {
          include: [{ id: '2250' }, { id: '1' }, { id: '2' }, { id: '3' }, { id: '1006094' }],
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'targeting_location_not_targetable',
        errorParams: { ids: '2250, 1, 2, 3' },
      });
    });

    it('should not read the referential for a targeting without places', async (): Promise<void> => {
      await service.setDimension(JANE, IDS.organization, NODE_ID, 'country', { include: ['FR'] });

      expect(geo.findByIds).not.toHaveBeenCalled();
    });
  });

  describe('the circles of proximity', () => {
    it('should keep a circle with its country and the address it came from', async (): Promise<void> => {
      const point = {
        latitude: 48.86,
        longitude: 2.35,
        radiusKm: 5,
        countryCode: 'FR',
        address: '1 rue de Rivoli, Paris',
      };

      const answer: TargetingResponse = await service.setDimension(JANE, IDS.organization, NODE_ID, 'proximity', {
        points: [point],
      });

      expect(answer.targeting).toEqual({ proximity: { points: [point] } });
    });

    it('should refuse a circle without its country, the country it replaces', async (): Promise<void> => {
      await expect(
        service.setDimension(JANE, IDS.organization, NODE_ID, 'proximity', {
          points: [
            { latitude: 48.86, longitude: 2.35, radiusKm: 5, countryCode: 'FR' },
            { latitude: 45.76, longitude: 4.84, radiusKm: 5 },
          ],
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'targeting_criteria_invalid',
        errorParams: { dimension: 'proximity', reason: 'every point needs its countryCode, the country it replaces' },
      });
      expect(db.manager.update).not.toHaveBeenCalled();
    });
  });

  describe('removeDimension', () => {
    it('should drop the dimension and keep the others', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(
        node({
          targeting: { country: { include: ['FR'], exclude: [] }, device: { include: ['ctv'], exclude: [] } },
        })
      );

      const answer: TargetingResponse = await service.removeDimension(JANE, IDS.organization, NODE_ID, 'country');

      expect(answer.targeting).toEqual({ device: { include: ['ctv'], exclude: [] } });
    });

    it('should accept dropping a dimension the node does not carry', async (): Promise<void> => {
      await expect(service.removeDimension(JANE, IDS.organization, NODE_ID, 'country')).resolves.toMatchObject({
        targeting: {},
      });
    });
  });

  describe('referencesOfList', () => {
    it('should ask the question for every dimension that points at lists, on both sides', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('node');
      builder.getRawMany.mockResolvedValue([{ id: NODE_ID }]);

      const nodes: string[] = await service.referencesOfList(db.manager as never, IDS.organization, LIST_ID);

      expect(nodes).toEqual([NODE_ID]);
      const [clause, params] = builder.andWhere.mock.calls[builder.andWhere.mock.calls.length - 1] as [
        string,
        Record<string, string>,
      ];
      // One containment per dimension and per side, and the list id travels in every one of them.
      expect(clause.split(' OR ').length).toBe(Object.keys(params).length);
      expect(Object.values(params).every((containment: string): boolean => containment.includes(LIST_ID))).toBe(true);
      expect(Object.values(params)).toContain(JSON.stringify({ poi_lists: { include: [LIST_ID] } }));
      expect(Object.values(params)).toContain(JSON.stringify({ poi_lists: { exclude: [LIST_ID] } }));
    });

    it('should answer nothing when no targeting references it', async (): Promise<void> => {
      await expect(service.referencesOfList(db.manager as never, IDS.organization, LIST_ID)).resolves.toEqual([]);
    });
  });

  describe('refusals of the access service', () => {
    it('should relay a refusal of the role, before reading anything', async (): Promise<void> => {
      access.assertOrganizationRole.mockRejectedValue(httpError(403, 'Requires the manager role'));

      await expect(service.replace(JANE, IDS.organization, NODE_ID, {})).rejects.toMatchObject({ statusCode: 403 });
      expect(db.mocks.transaction).not.toHaveBeenCalled();
    });
  });

  describe('TargetingServicePlugin', () => {
    it('should decorate the instance with a TargetingService wired to its dependencies', async (): Promise<void> => {
      const app: FastifyInstance = await buildServiceApp([TargetingServicePlugin], { db, access, geo });

      expect(app.targetingService).toBeInstanceOf(TargetingService);
      await expect(app.targetingService.get(JANE, IDS.organization, NODE_ID)).resolves.toMatchObject({
        targetingGroupId: NODE_ID,
      });

      await app.close();
    });
  });
});
