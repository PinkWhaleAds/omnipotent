import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { FastifyInstance, LightMyRequestResponse } from 'fastify';

import AdvertiserController from '@modules/advertiser/advertiser.controller';
import type { AdvertiserService } from '@services';
import { Advertiser, BulkResult, DeletionResult, ErrorResponse, Paginated } from '@src/types';
import { IDS, JANE, NOW } from '@test/unit/mocks/auth.fixtures';
import { closeTestApp, setupRouteAppForTest } from '@test/utils/fastify-test-app.utils';
import { httpError } from '@utils';

/** Jest stand-in for every {@link AdvertiserService} method the handlers call. */
type AdvertiserServiceMock = Record<
  | 'list'
  | 'get'
  | 'create'
  | 'update'
  | 'delete'
  | 'restore'
  | 'setLabels'
  | 'bulkCreate'
  | 'bulkUpdate'
  | 'bulkDelete'
  | 'bulkRestore',
  jest.Mock
>;

/** The Advertiser the service answers. */
const ADVERTISER: Advertiser = {
  id: IDS.advertiser,
  organizationId: IDS.organization,
  name: 'Herbéa',
  websiteUrl: 'https://herbea.test',
  labels: [],
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  deletedAt: null,
};

/** A Label id the bodies post. */
const LABEL_ID = 'e0000000-0000-4000-8000-000000000001';

/** The header every org-scoped route reads. */
const HEADERS: Record<string, string> = { 'x-organization-id': IDS.organization };

/** The querystring a list route sees once the defaults are filled. */
const DEFAULT_QUERY = {
  page: 1,
  limit: 50,
  sortBy: 'name',
  sortOrder: 'asc',
  labelMode: 'any',
  includeDeleted: false,
};

describe('Unit::Modules::AdvertiserController', () => {
  const service: AdvertiserServiceMock = {
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    restore: jest.fn(),
    setLabels: jest.fn(),
    bulkCreate: jest.fn(),
    bulkUpdate: jest.fn(),
    bulkDelete: jest.fn(),
    bulkRestore: jest.fn(),
  };
  let app: FastifyInstance;

  beforeEach(async (): Promise<void> => {
    jest.clearAllMocks();
    app = await setupRouteAppForTest(
      AdvertiserController,
      { advertiserService: service as unknown as AdvertiserService },
      JANE
    );
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  describe('listAdvertisers', () => {
    it('should list with the defaults of the querystring filled', async (): Promise<void> => {
      const page: Paginated<Advertiser> = { items: [ADVERTISER], total: 1, page: 1, limit: 50 };
      service.list.mockResolvedValue(page);

      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: '/advertisers',
        headers: HEADERS,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(page);
      expect(service.list).toHaveBeenCalledWith(JANE, IDS.organization, DEFAULT_QUERY);
    });

    it('should forward the page, the sort, the search and the Label filter', async (): Promise<void> => {
      service.list.mockResolvedValue({ items: [], total: 0, page: 2, limit: 10 });

      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `/advertisers?page=2&limit=10&sortBy=createdAt&sortOrder=desc&search=herb&labelIds=${LABEL_ID}&labelMode=all&includeDeleted=true`,
        headers: HEADERS,
      });

      expect(response.statusCode).toBe(200);
      expect(service.list).toHaveBeenCalledWith(JANE, IDS.organization, {
        page: 2,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        search: 'herb',
        labelIds: [LABEL_ID],
        labelMode: 'all',
        includeDeleted: true,
      });
    });

    it('should refuse a sort on a field the resource does not declare', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: '/advertisers?sortBy=websiteUrl',
        headers: HEADERS,
      });

      expect(response.statusCode).toBe(400);
      expect((JSON.parse(response.body) as ErrorResponse).code).toBe('validation_failed');
      expect(service.list).not.toHaveBeenCalled();
    });

    it('should refuse a request without the Organization header', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/advertisers' });

      expect(response.statusCode).toBe(400);
      expect(service.list).not.toHaveBeenCalled();
    });
  });

  describe('getAdvertiser', () => {
    it('should answer one Advertiser', async (): Promise<void> => {
      service.get.mockResolvedValue(ADVERTISER);

      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `/advertisers/${IDS.advertiser}`,
        headers: HEADERS,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(ADVERTISER);
      expect(service.get).toHaveBeenCalledWith(JANE, IDS.organization, IDS.advertiser);
    });

    it('should relay the 404 of the service in the single error shape', async (): Promise<void> => {
      service.get.mockRejectedValue(httpError(404, 'Advertiser not found', { code: 'advertiser_not_found' }));

      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `/advertisers/${IDS.advertiser}`,
        headers: HEADERS,
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toMatchObject({ code: 'advertiser_not_found', params: {} });
    });

    it('should refuse an id that is not a uuid', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: '/advertisers/not-a-uuid',
        headers: HEADERS,
      });

      expect(response.statusCode).toBe(400);
      expect(service.get).not.toHaveBeenCalled();
    });
  });

  describe('createAdvertiser', () => {
    it('should create an Advertiser and answer 201', async (): Promise<void> => {
      service.create.mockResolvedValue(ADVERTISER);

      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/advertisers',
        headers: HEADERS,
        payload: { name: '  Herbéa  ', websiteUrl: 'https://herbea.test', labelIds: [LABEL_ID] },
      });

      expect(response.statusCode).toBe(201);
      expect(JSON.parse(response.body)).toEqual(ADVERTISER);
      // The body is parsed by its Zod schema, so the name arrives trimmed.
      expect(service.create).toHaveBeenCalledWith(JANE, IDS.organization, {
        name: 'Herbéa',
        websiteUrl: 'https://herbea.test',
        labelIds: [LABEL_ID],
      });
    });

    it('should refuse a website that is not http(s)', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/advertisers',
        headers: HEADERS,
        payload: { name: 'Herbéa', websiteUrl: 'javascript:alert(1)' },
      });

      expect(response.statusCode).toBe(400);
      expect(service.create).not.toHaveBeenCalled();
    });
  });

  describe('updateAdvertiser', () => {
    it('should update an Advertiser', async (): Promise<void> => {
      service.update.mockResolvedValue(ADVERTISER);

      const response: LightMyRequestResponse = await app.inject({
        method: 'PATCH',
        url: `/advertisers/${IDS.advertiser}`,
        headers: HEADERS,
        payload: { websiteUrl: null },
      });

      expect(response.statusCode).toBe(200);
      expect(service.update).toHaveBeenCalledWith(JANE, IDS.organization, IDS.advertiser, { websiteUrl: null });
    });
  });

  describe('deleteAdvertiser', () => {
    it('should answer the id and the deletion instant', async (): Promise<void> => {
      const deleted: DeletionResult = { id: IDS.advertiser, deletedAt: NOW.toISOString() };
      service.delete.mockResolvedValue(deleted);

      const response: LightMyRequestResponse = await app.inject({
        method: 'DELETE',
        url: `/advertisers/${IDS.advertiser}`,
        headers: HEADERS,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(deleted);
      expect(service.delete).toHaveBeenCalledWith(JANE, IDS.organization, IDS.advertiser);
    });
  });

  describe('restoreAdvertiser', () => {
    it('should answer the id with no deletion instant left', async (): Promise<void> => {
      service.restore.mockResolvedValue({ id: IDS.advertiser, deletedAt: null });

      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: `/advertisers/${IDS.advertiser}/restore`,
        headers: HEADERS,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ id: IDS.advertiser, deletedAt: null });
      expect(service.restore).toHaveBeenCalledWith(JANE, IDS.organization, IDS.advertiser);
    });

    it('should relay the 409 of an Advertiser that is not deleted', async (): Promise<void> => {
      service.restore.mockRejectedValue(
        httpError(409, 'This advertiser is not deleted', { code: 'advertiser_not_deleted' })
      );

      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: `/advertisers/${IDS.advertiser}/restore`,
        headers: HEADERS,
      });

      expect(response.statusCode).toBe(409);
      expect((JSON.parse(response.body) as ErrorResponse).code).toBe('advertiser_not_deleted');
    });
  });

  describe('setAdvertiserLabels', () => {
    it('should post the complete set of Labels', async (): Promise<void> => {
      service.setLabels.mockResolvedValue(ADVERTISER);

      const response: LightMyRequestResponse = await app.inject({
        method: 'PUT',
        url: `/advertisers/${IDS.advertiser}/labels`,
        headers: HEADERS,
        payload: { labelIds: [LABEL_ID] },
      });

      expect(response.statusCode).toBe(200);
      expect(service.setLabels).toHaveBeenCalledWith(JANE, IDS.organization, IDS.advertiser, {
        labelIds: [LABEL_ID],
      });
    });

    it('should accept an empty set, which clears them', async (): Promise<void> => {
      service.setLabels.mockResolvedValue(ADVERTISER);

      const response: LightMyRequestResponse = await app.inject({
        method: 'PUT',
        url: `/advertisers/${IDS.advertiser}/labels`,
        headers: HEADERS,
        payload: { labelIds: [] },
      });

      expect(response.statusCode).toBe(200);
      expect(service.setLabels).toHaveBeenCalledWith(JANE, IDS.organization, IDS.advertiser, { labelIds: [] });
    });
  });

  describe('bulkCreateAdvertisers', () => {
    it('should default the mode to atomic and answer 200', async (): Promise<void> => {
      const result: BulkResult<Advertiser> = { items: [ADVERTISER], failed: [] };
      service.bulkCreate.mockResolvedValue(result);

      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/advertisers/bulk',
        headers: HEADERS,
        payload: { items: [{ name: 'Herbéa' }] },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(result);
      expect(service.bulkCreate).toHaveBeenCalledWith(JANE, IDS.organization, {
        mode: 'atomic',
        items: [{ name: 'Herbéa' }],
      });
    });

    it('should answer 200 with the failures of a partial bulk', async (): Promise<void> => {
      const result: BulkResult<Advertiser> = {
        items: [ADVERTISER],
        failed: [{ index: 1, code: 'advertiser_name_taken', params: { name: 'Herbéa' }, message: 'Taken' }],
      };
      service.bulkCreate.mockResolvedValue(result);

      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/advertisers/bulk',
        headers: HEADERS,
        payload: { mode: 'partial', items: [{ name: 'Herbéa' }, { name: 'Herbéa' }] },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(result);
    });

    it('should refuse a bulk of more than 200 items', async (): Promise<void> => {
      const items: { name: string }[] = Array.from({ length: 201 }, (_, index: number) => ({
        name: `Brand ${index}`,
      }));

      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/advertisers/bulk',
        headers: HEADERS,
        payload: { items },
      });

      expect(response.statusCode).toBe(400);
      expect(service.bulkCreate).not.toHaveBeenCalled();
    });

    it('should refuse an unknown field inside an item, naming where it is', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/advertisers/bulk',
        headers: HEADERS,
        payload: { items: [{ name: 'Herbéa' }, { name: 'Maison Lune', website: 'https://maison-lune.test' }] },
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toMatchObject({
        code: 'validation_failed',
        params: { field: 'items.1.website', rule: 'additionalProperties', location: 'body' },
      });
      expect(service.bulkCreate).not.toHaveBeenCalled();
    });

    it('should refuse an empty bulk', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/advertisers/bulk',
        headers: HEADERS,
        payload: { items: [] },
      });

      expect(response.statusCode).toBe(400);
      expect(service.bulkCreate).not.toHaveBeenCalled();
    });
  });

  describe('bulkUpdateAdvertisers', () => {
    it('should update several Advertisers, each item naming its own', async (): Promise<void> => {
      service.bulkUpdate.mockResolvedValue({ items: [ADVERTISER], failed: [] });

      const response: LightMyRequestResponse = await app.inject({
        method: 'PATCH',
        url: '/advertisers/bulk',
        headers: HEADERS,
        payload: { items: [{ id: IDS.advertiser, name: 'Herbéa' }] },
      });

      expect(response.statusCode).toBe(200);
      expect(service.bulkUpdate).toHaveBeenCalledWith(JANE, IDS.organization, {
        mode: 'atomic',
        items: [{ id: IDS.advertiser, name: 'Herbéa' }],
      });
    });
  });

  describe('bulkDeleteAdvertisers', () => {
    it('should delete several Advertisers', async (): Promise<void> => {
      const result: BulkResult<DeletionResult> = {
        items: [{ id: IDS.advertiser, deletedAt: NOW.toISOString() }],
        failed: [],
      };
      service.bulkDelete.mockResolvedValue(result);

      const response: LightMyRequestResponse = await app.inject({
        method: 'DELETE',
        url: '/advertisers/bulk',
        headers: HEADERS,
        payload: { ids: [IDS.advertiser] },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(result);
      expect(service.bulkDelete).toHaveBeenCalledWith(JANE, IDS.organization, {
        mode: 'atomic',
        ids: [IDS.advertiser],
      });
    });

    it('should relay the 400 of a bulk naming the same id twice', async (): Promise<void> => {
      service.bulkDelete.mockRejectedValue(
        httpError(400, 'The id appears twice in this request', {
          code: 'bulk_ids_duplicated',
          params: { id: IDS.advertiser },
        })
      );

      const response: LightMyRequestResponse = await app.inject({
        method: 'DELETE',
        url: '/advertisers/bulk',
        headers: HEADERS,
        payload: { ids: [IDS.advertiser, IDS.advertiser] },
      });

      expect(response.statusCode).toBe(400);
      expect((JSON.parse(response.body) as ErrorResponse).code).toBe('bulk_ids_duplicated');
    });
  });

  describe('bulkRestoreAdvertisers', () => {
    it('should restore several Advertisers', async (): Promise<void> => {
      service.bulkRestore.mockResolvedValue({ items: [{ id: IDS.advertiser, deletedAt: null }], failed: [] });

      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/advertisers/bulk/restore',
        headers: HEADERS,
        payload: { mode: 'partial', ids: [IDS.advertiser] },
      });

      expect(response.statusCode).toBe(200);
      expect(service.bulkRestore).toHaveBeenCalledWith(JANE, IDS.organization, {
        mode: 'partial',
        ids: [IDS.advertiser],
      });
    });
  });

  describe('the bulk URLs against the id ones', () => {
    it('should route /advertisers/bulk to the bulk route, not to :id', async (): Promise<void> => {
      service.bulkCreate.mockResolvedValue({ items: [], failed: [] });

      await app.inject({
        method: 'POST',
        url: '/advertisers/bulk',
        headers: HEADERS,
        payload: { items: [{ name: 'A' }] },
      });

      expect(service.bulkCreate).toHaveBeenCalledTimes(1);
      expect(service.restore).not.toHaveBeenCalled();
    });
  });
});
