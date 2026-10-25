import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { FastifyInstance, LightMyRequestResponse } from 'fastify';

import ListController from '@modules/list/list.controller';
import { IDS, JANE } from '@test/unit/mocks/auth.fixtures';
import { closeTestApp, setupRouteAppForTest } from '@test/utils/fastify-test-app.utils';
import { httpError } from '@utils';

/** The list the routes name. */
const LIST_ID = 'fa000000-0000-4000-8000-000000000001';

/** Headers of every call: the Organization the caller acts in. */
const HEADERS: Record<string, string> = { 'x-organization-id': IDS.organization };

/** An instant, as the API writes it. */
const ISO: string = new Date('2026-10-06T10:00:00.000Z').toISOString();

/** What the list routes answer, checked against their real response schema. */
const LIST = {
  id: LIST_ID,
  organizationId: IDS.organization,
  kind: 'app_site',
  name: 'Sites à exclure',
  items: [{ value: 'example.com', label: 'Example', metadata: { country: 'FR' } }],
  itemCount: 1,
  createdAt: ISO,
  updatedAt: ISO,
  deletedAt: null,
};

describe('Unit::Modules::ListController', () => {
  let app: FastifyInstance;
  let service: Record<string, jest.Mock>;

  beforeEach(async (): Promise<void> => {
    jest.clearAllMocks();
    const deletion = { id: LIST_ID, deletedAt: ISO };
    service = {
      list: jest.fn().mockResolvedValue({ items: [LIST], total: 1, page: 1, limit: 50 }),
      get: jest.fn().mockResolvedValue(LIST),
      create: jest.fn().mockResolvedValue(LIST),
      update: jest.fn().mockResolvedValue(LIST),
      delete: jest.fn().mockResolvedValue(deletion),
      restore: jest.fn().mockResolvedValue({ id: LIST_ID, deletedAt: null }),
      duplicate: jest.fn().mockResolvedValue(LIST),
      move: jest.fn().mockResolvedValue(LIST),
      bulkCreate: jest.fn().mockResolvedValue({ items: [LIST], failed: [] }),
      bulkUpdate: jest.fn().mockResolvedValue({ items: [LIST], failed: [] }),
      bulkDelete: jest.fn().mockResolvedValue({ items: [deletion], failed: [] }),
      bulkRestore: jest.fn().mockResolvedValue({ items: [{ id: LIST_ID, deletedAt: null }], failed: [] }),
    };
    app = await setupRouteAppForTest(ListController, { listService: service }, JANE);
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  it('should list the lists, filtered by kind', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/lists?kind=poi',
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(service.list).toHaveBeenCalledWith(JANE, IDS.organization, expect.objectContaining({ kind: 'poi' }));
  });

  it('should create a list and answer 201', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/lists',
      headers: HEADERS,
      payload: { kind: 'app_site', name: 'Sites à exclure', items: [{ value: 'example.com' }] },
    });

    expect(response.statusCode).toBe(201);
    expect(service.create).toHaveBeenCalledWith(JANE, IDS.organization, {
      kind: 'app_site',
      name: 'Sites à exclure',
      items: [{ value: 'example.com' }],
    });
  });

  it('should read, update, delete and restore flat on the list', async (): Promise<void> => {
    expect((await app.inject({ method: 'GET', url: `/lists/${LIST_ID}`, headers: HEADERS })).statusCode).toBe(200);
    expect(service.get).toHaveBeenCalledWith(JANE, IDS.organization, LIST_ID);

    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/lists/${LIST_ID}`,
          headers: HEADERS,
          payload: { name: 'Sites bloqués' },
        })
      ).statusCode
    ).toBe(200);
    expect(service.update).toHaveBeenCalledWith(JANE, IDS.organization, LIST_ID, { name: 'Sites bloqués' });

    expect((await app.inject({ method: 'DELETE', url: `/lists/${LIST_ID}`, headers: HEADERS })).statusCode).toBe(200);
    expect(service.delete).toHaveBeenCalledWith(JANE, IDS.organization, LIST_ID);

    expect((await app.inject({ method: 'POST', url: `/lists/${LIST_ID}/restore`, headers: HEADERS })).statusCode).toBe(
      200
    );
    expect(service.restore).toHaveBeenCalledWith(JANE, IDS.organization, LIST_ID);
  });

  it('should duplicate into another Organization, answering 201, and move answering 200', async (): Promise<void> => {
    const copy: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/lists/${LIST_ID}/duplicate`,
      headers: HEADERS,
      payload: { organizationId: IDS.otherOrganization },
    });
    expect(copy.statusCode).toBe(201);
    expect(service.duplicate).toHaveBeenCalledWith(JANE, IDS.organization, LIST_ID, {
      organizationId: IDS.otherOrganization,
    });

    const moved: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/lists/${LIST_ID}/move`,
      headers: HEADERS,
      payload: { organizationId: IDS.otherOrganization },
    });
    expect(moved.statusCode).toBe(200);
    expect(service.move).toHaveBeenCalledWith(JANE, IDS.organization, LIST_ID, {
      organizationId: IDS.otherOrganization,
    });
  });

  it('should serve the four bulk routes, the mode defaulting to atomic', async (): Promise<void> => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/lists/bulk',
          headers: HEADERS,
          payload: { items: [{ kind: 'poi', name: 'Magasins' }] },
        })
      ).statusCode
    ).toBe(200);
    expect(service.bulkCreate).toHaveBeenCalledWith(JANE, IDS.organization, {
      mode: 'atomic',
      items: [{ kind: 'poi', name: 'Magasins' }],
    });

    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/lists/bulk',
          headers: HEADERS,
          payload: { items: [{ id: LIST_ID, name: 'Magasins' }] },
        })
      ).statusCode
    ).toBe(200);
    expect(service.bulkUpdate).toHaveBeenCalled();

    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/lists/bulk',
          headers: HEADERS,
          payload: { ids: [LIST_ID] },
        })
      ).statusCode
    ).toBe(200);
    expect(service.bulkDelete).toHaveBeenCalledWith(JANE, IDS.organization, { mode: 'atomic', ids: [LIST_ID] });

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/lists/bulk/restore',
          headers: HEADERS,
          payload: { mode: 'partial', ids: [LIST_ID] },
        })
      ).statusCode
    ).toBe(200);
    expect(service.bulkRestore).toHaveBeenCalledWith(JANE, IDS.organization, { mode: 'partial', ids: [LIST_ID] });
  });

  it('should refuse a kind the enumeration does not hold, and a field the body does not declare', async (): Promise<void> => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/lists',
          headers: HEADERS,
          payload: { kind: 'astrology', name: 'Signes' },
        })
      ).statusCode
    ).toBe(400);

    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/lists',
      headers: HEADERS,
      payload: { kind: 'poi', name: 'Magasins', nope: 1 },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 'validation_failed',
      params: { field: 'nope', rule: 'additionalProperties', location: 'body' },
    });
    expect(service.create).not.toHaveBeenCalled();
  });

  it('should refuse a kind change: a dimension references a list by what it holds', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'PATCH',
      url: `/lists/${LIST_ID}`,
      headers: HEADERS,
      payload: { kind: 'poi' },
    });

    expect(response.statusCode).toBe(400);
    expect(service.update).not.toHaveBeenCalled();
  });

  it('should relay a refusal of the service in the single error shape', async (): Promise<void> => {
    service.move.mockRejectedValue(
      httpError(409, 'This list is still used by a targeting of this Organization: duplicate it instead', {
        code: 'list_referenced',
        params: { listId: LIST_ID, references: 2 },
      })
    );

    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/lists/${LIST_ID}/move`,
      headers: HEADERS,
      payload: { organizationId: IDS.otherOrganization },
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 'list_referenced',
      params: { listId: LIST_ID, references: 2 },
    });
  });
});
