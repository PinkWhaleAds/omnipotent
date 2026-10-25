import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { FastifyInstance, LightMyRequestResponse } from 'fastify';

import LabelController from '@modules/label/label.controller';
import type { LabelService } from '@services';
import { BulkResult, DeletionResult, ErrorResponse, Label, LabelledResource, Paginated } from '@src/types';
import { IDS, JANE, NOW } from '@test/unit/mocks/auth.fixtures';
import { closeTestApp, setupRouteAppForTest } from '@test/utils/fastify-test-app.utils';
import { httpError } from '@utils';

/** Jest stand-in for every {@link LabelService} method the handlers call. */
type LabelServiceMock = Record<
  | 'list'
  | 'get'
  | 'create'
  | 'update'
  | 'delete'
  | 'restore'
  | 'resources'
  | 'bulkCreate'
  | 'bulkUpdate'
  | 'bulkDelete'
  | 'bulkRestore',
  jest.Mock
>;

/** The Label the service answers. */
const LABEL: Label = {
  id: 'e0000000-0000-4000-8000-000000000001',
  organizationId: IDS.organization,
  name: 'Printemps',
  color: '#1f6feb',
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  deletedAt: null,
};

/** The header every org-scoped route reads. */
const HEADERS: Record<string, string> = { 'x-organization-id': IDS.organization };

/** The querystring a list route sees once the defaults are filled. */
const DEFAULT_QUERY = { page: 1, limit: 50, sortBy: 'name', sortOrder: 'asc', includeDeleted: false };

describe('Unit::Modules::LabelController', () => {
  const service: LabelServiceMock = {
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    restore: jest.fn(),
    resources: jest.fn(),
    bulkCreate: jest.fn(),
    bulkUpdate: jest.fn(),
    bulkDelete: jest.fn(),
    bulkRestore: jest.fn(),
  };
  let app: FastifyInstance;

  beforeEach(async (): Promise<void> => {
    jest.clearAllMocks();
    app = await setupRouteAppForTest(LabelController, { labelService: service as unknown as LabelService }, JANE);
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  describe('listLabels', () => {
    it('should list with the defaults of the querystring filled', async (): Promise<void> => {
      const page: Paginated<Label> = { items: [LABEL], total: 1, page: 1, limit: 50 };
      service.list.mockResolvedValue(page);

      const response: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/labels', headers: HEADERS });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(page);
      expect(service.list).toHaveBeenCalledWith(JANE, IDS.organization, DEFAULT_QUERY);
    });

    it('should forward the page, the sort and the search', async (): Promise<void> => {
      service.list.mockResolvedValue({ items: [], total: 0, page: 2, limit: 10 });

      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: '/labels?page=2&limit=10&sortBy=updatedAt&sortOrder=desc&search=prin&includeDeleted=true',
        headers: HEADERS,
      });

      expect(response.statusCode).toBe(200);
      expect(service.list).toHaveBeenCalledWith(JANE, IDS.organization, {
        page: 2,
        limit: 10,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
        search: 'prin',
        includeDeleted: true,
      });
    });

    it('should refuse a filter on Labels: a Label is not labelled itself', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `/labels?labelIds=${LABEL.id}`,
        headers: HEADERS,
      });

      // A parameter the route does not declare is refused, naming it, rather than silently ignored.
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toMatchObject({
        code: 'validation_failed',
        params: { field: 'labelIds', rule: 'additionalProperties', location: 'querystring' },
      });
      expect(service.list).not.toHaveBeenCalled();
    });

    it('should refuse a parameter nobody declares, such as a mistyped sort', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: '/labels?sort=name',
        headers: HEADERS,
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toMatchObject({ params: { field: 'sort' } });
      expect(service.list).not.toHaveBeenCalled();
    });
  });

  describe('getLabel', () => {
    it('should answer one Label', async (): Promise<void> => {
      service.get.mockResolvedValue(LABEL);

      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `/labels/${LABEL.id}`,
        headers: HEADERS,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(LABEL);
      expect(service.get).toHaveBeenCalledWith(JANE, IDS.organization, LABEL.id);
    });

    it('should relay the 404 of the service in the single error shape', async (): Promise<void> => {
      service.get.mockRejectedValue(httpError(404, 'Label not found', { code: 'label_not_found' }));

      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `/labels/${LABEL.id}`,
        headers: HEADERS,
      });

      expect(response.statusCode).toBe(404);
      expect((JSON.parse(response.body) as ErrorResponse).code).toBe('label_not_found');
    });
  });

  describe('createLabel', () => {
    it('should create a Label and answer 201, the colour in lower case', async (): Promise<void> => {
      service.create.mockResolvedValue(LABEL);

      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/labels',
        headers: HEADERS,
        payload: { name: ' Printemps ', color: '#1F6FEB' },
      });

      expect(response.statusCode).toBe(201);
      expect(JSON.parse(response.body)).toEqual(LABEL);
      expect(service.create).toHaveBeenCalledWith(JANE, IDS.organization, { name: 'Printemps', color: '#1f6feb' });
    });

    it('should refuse a colour that is not #rrggbb', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/labels',
        headers: HEADERS,
        payload: { name: 'Printemps', color: 'blue' },
      });

      expect(response.statusCode).toBe(400);
      expect(service.create).not.toHaveBeenCalled();
    });

    it('should refuse a field of the body nobody declares, naming it', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/labels',
        headers: HEADERS,
        payload: { name: 'Printemps', color: '#1f6feb', colour: '#1f6feb' },
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toMatchObject({
        code: 'validation_failed',
        params: { field: 'colour', rule: 'additionalProperties', location: 'body' },
      });
      expect(service.create).not.toHaveBeenCalled();
    });

    it('should refuse a name longer than 64 characters', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/labels',
        headers: HEADERS,
        payload: { name: 'P'.repeat(65), color: '#1f6feb' },
      });

      expect(response.statusCode).toBe(400);
      expect(service.create).not.toHaveBeenCalled();
    });
  });

  describe('updateLabel', () => {
    it('should update a Label', async (): Promise<void> => {
      service.update.mockResolvedValue(LABEL);

      const response: LightMyRequestResponse = await app.inject({
        method: 'PATCH',
        url: `/labels/${LABEL.id}`,
        headers: HEADERS,
        payload: { color: '#d29922' },
      });

      expect(response.statusCode).toBe(200);
      expect(service.update).toHaveBeenCalledWith(JANE, IDS.organization, LABEL.id, { color: '#d29922' });
    });
  });

  describe('deleteLabel', () => {
    it('should answer the id and the deletion instant', async (): Promise<void> => {
      const deleted: DeletionResult = { id: LABEL.id, deletedAt: NOW.toISOString() };
      service.delete.mockResolvedValue(deleted);

      const response: LightMyRequestResponse = await app.inject({
        method: 'DELETE',
        url: `/labels/${LABEL.id}`,
        headers: HEADERS,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(deleted);
      expect(service.delete).toHaveBeenCalledWith(JANE, IDS.organization, LABEL.id);
    });
  });

  describe('restoreLabel', () => {
    it('should answer the id with no deletion instant left', async (): Promise<void> => {
      service.restore.mockResolvedValue({ id: LABEL.id, deletedAt: null });

      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: `/labels/${LABEL.id}/restore`,
        headers: HEADERS,
      });

      expect(response.statusCode).toBe(200);
      expect(service.restore).toHaveBeenCalledWith(JANE, IDS.organization, LABEL.id);
    });
  });

  describe('listLabelResources', () => {
    it('should answer what the Label marks', async (): Promise<void> => {
      const page: Paginated<LabelledResource> = {
        items: [{ resourceType: 'advertiser', resourceId: IDS.advertiser, name: 'Herbéa' }],
        total: 1,
        page: 1,
        limit: 50,
      };
      service.resources.mockResolvedValue(page);

      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `/labels/${LABEL.id}/resources`,
        headers: HEADERS,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(page);
      expect(service.resources).toHaveBeenCalledWith(JANE, IDS.organization, LABEL.id, { page: 1, limit: 50 });
    });

    it('should forward the page it was asked for', async (): Promise<void> => {
      service.resources.mockResolvedValue({ items: [], total: 0, page: 3, limit: 5 });

      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `/labels/${LABEL.id}/resources?page=3&limit=5`,
        headers: HEADERS,
      });

      expect(response.statusCode).toBe(200);
      expect(service.resources).toHaveBeenCalledWith(JANE, IDS.organization, LABEL.id, { page: 3, limit: 5 });
    });
  });

  describe('bulkCreateLabels', () => {
    it('should default the mode to atomic and answer 200', async (): Promise<void> => {
      const result: BulkResult<Label> = { items: [LABEL], failed: [] };
      service.bulkCreate.mockResolvedValue(result);

      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/labels/bulk',
        headers: HEADERS,
        payload: { items: [{ name: 'Printemps', color: '#1f6feb' }] },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(result);
      expect(service.bulkCreate).toHaveBeenCalledWith(JANE, IDS.organization, {
        mode: 'atomic',
        items: [{ name: 'Printemps', color: '#1f6feb' }],
      });
    });
  });

  describe('bulkUpdateLabels', () => {
    it('should update several Labels, each item naming its own', async (): Promise<void> => {
      service.bulkUpdate.mockResolvedValue({ items: [LABEL], failed: [] });

      const response: LightMyRequestResponse = await app.inject({
        method: 'PATCH',
        url: '/labels/bulk',
        headers: HEADERS,
        payload: { mode: 'partial', items: [{ id: LABEL.id, color: '#d29922' }] },
      });

      expect(response.statusCode).toBe(200);
      expect(service.bulkUpdate).toHaveBeenCalledWith(JANE, IDS.organization, {
        mode: 'partial',
        items: [{ id: LABEL.id, color: '#d29922' }],
      });
    });
  });

  describe('bulkDeleteLabels', () => {
    it('should delete several Labels', async (): Promise<void> => {
      service.bulkDelete.mockResolvedValue({ items: [{ id: LABEL.id, deletedAt: NOW.toISOString() }], failed: [] });

      const response: LightMyRequestResponse = await app.inject({
        method: 'DELETE',
        url: '/labels/bulk',
        headers: HEADERS,
        payload: { ids: [LABEL.id] },
      });

      expect(response.statusCode).toBe(200);
      expect(service.bulkDelete).toHaveBeenCalledWith(JANE, IDS.organization, { mode: 'atomic', ids: [LABEL.id] });
    });

    it('should refuse an id that is not a uuid', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'DELETE',
        url: '/labels/bulk',
        headers: HEADERS,
        payload: { ids: ['not-a-uuid'] },
      });

      expect(response.statusCode).toBe(400);
      expect(service.bulkDelete).not.toHaveBeenCalled();
    });
  });

  describe('bulkRestoreLabels', () => {
    it('should restore several Labels', async (): Promise<void> => {
      service.bulkRestore.mockResolvedValue({ items: [{ id: LABEL.id, deletedAt: null }], failed: [] });

      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/labels/bulk/restore',
        headers: HEADERS,
        payload: { ids: [LABEL.id] },
      });

      expect(response.statusCode).toBe(200);
      expect(service.bulkRestore).toHaveBeenCalledWith(JANE, IDS.organization, { mode: 'atomic', ids: [LABEL.id] });
    });
  });
});
