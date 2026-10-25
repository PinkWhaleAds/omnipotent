import { FastifyInstance } from 'fastify';

import { ListEntity, TargetingGroupEntity } from '@src/database/entities';
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
  let service: TargetingService;

  beforeEach((): void => {
    jest.clearAllMocks();
    db = createDataSourceMock();
    access = createAccessMock();
    service = new TargetingService(db.dataSource, access as never);
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
      const app: FastifyInstance = await buildServiceApp([TargetingServicePlugin], { db, access });

      expect(app.targetingService).toBeInstanceOf(TargetingService);
      await expect(app.targetingService.get(JANE, IDS.organization, NODE_ID)).resolves.toMatchObject({
        targetingGroupId: NODE_ID,
      });

      await app.close();
    });
  });
});
