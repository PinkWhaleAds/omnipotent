import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { FastifyInstance, LightMyRequestResponse } from 'fastify';

import CreativeController from '@modules/creative/creative.controller';
import { IDS, JANE } from '@test/unit/mocks/auth.fixtures';
import { closeTestApp, setupRouteAppForTest } from '@test/utils/fastify-test-app.utils';
import { httpError } from '@utils';

/** The ids the routes name. */
const CREATIVE_ID = 'fe000000-0000-4000-8000-000000000001';
const VERSION_ID = 'fd000000-0000-4000-8000-000000000001';
const ASSET_ID = 'fc000000-0000-4000-8000-000000000001';
const ADVERTISER_ID = IDS.advertiser;

/** Headers of every call: the Organization the caller acts in. */
const HEADERS: Record<string, string> = { 'x-organization-id': IDS.organization };

/** An instant, as the API writes it. */
const ISO: string = new Date('2026-10-06T10:00:00.000Z').toISOString();

/** What the version routes answer, checked against their real response schema. */
const VERSION = {
  id: VERSION_ID,
  creativeId: CREATIVE_ID,
  version: 1,
  payload: { altText: 'Bannière' },
  assets: [{ role: 'image', assetId: ASSET_ID }],
  trackers: [{ event: 'impression', url: 'https://tracker.test/i' }],
  active: true,
  createdAt: ISO,
};

/** What the creative routes answer. */
const CREATIVE = {
  id: CREATIVE_ID,
  organizationId: IDS.organization,
  advertiserId: ADVERTISER_ID,
  name: 'Bannière 300x250',
  format: 'display',
  subtype: 'image',
  iabCategories: ['IAB2-3'],
  iabTaxonomyVersion: '3.0',
  clickThroughUrl: 'https://herbea.test/automne',
  activeVersion: VERSION,
  versionCount: 1,
  labels: [],
  createdAt: ISO,
  updatedAt: ISO,
  deletedAt: null,
};

/** A first version, as a body sends it. */
const FIRST_VERSION = { payload: { altText: 'Bannière' }, assets: [{ role: 'image', assetId: ASSET_ID }] };

describe('Unit::Modules::CreativeController', () => {
  let app: FastifyInstance;
  let service: Record<string, jest.Mock>;

  beforeEach(async (): Promise<void> => {
    jest.clearAllMocks();
    const deletion = { id: CREATIVE_ID, deletedAt: ISO };
    service = {
      list: jest.fn().mockResolvedValue({ items: [CREATIVE], total: 1, page: 1, limit: 50 }),
      get: jest.fn().mockResolvedValue(CREATIVE),
      create: jest.fn().mockResolvedValue(CREATIVE),
      update: jest.fn().mockResolvedValue(CREATIVE),
      delete: jest.fn().mockResolvedValue(deletion),
      restore: jest.fn().mockResolvedValue({ id: CREATIVE_ID, deletedAt: null }),
      setLabels: jest.fn().mockResolvedValue(CREATIVE),
      listVersions: jest.fn().mockResolvedValue({ items: [VERSION], total: 1, page: 1, limit: 50 }),
      createVersion: jest.fn().mockResolvedValue(VERSION),
      getVersion: jest.fn().mockResolvedValue(VERSION),
      activateVersion: jest.fn().mockResolvedValue(VERSION),
      bulkCreate: jest.fn().mockResolvedValue({ items: [CREATIVE], failed: [] }),
      bulkUpdate: jest.fn().mockResolvedValue({ items: [CREATIVE], failed: [] }),
      bulkDelete: jest.fn().mockResolvedValue({ items: [deletion], failed: [] }),
      bulkRestore: jest.fn().mockResolvedValue({ items: [{ id: CREATIVE_ID, deletedAt: null }], failed: [] }),
    };
    app = await setupRouteAppForTest(CreativeController, { creativeService: service }, JANE);
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  it('should answer the registry of couples without naming an Organization', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/creative-formats' });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { couples: { format: string; subtype: string }[] };
    expect(body.couples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          format: 'display',
          subtype: 'image',
          requiredRoles: ['image'],
          payloadSchema: expect.any(Object),
        }),
      ])
    );
  });

  it('should list the creatives of an Advertiser, filtered by couple', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: `/advertisers/${ADVERTISER_ID}/creatives?format=video&subtype=vast_url`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(service.list).toHaveBeenCalledWith(
      JANE,
      IDS.organization,
      ADVERTISER_ID,
      expect.objectContaining({ format: 'video', subtype: 'vast_url' })
    );
  });

  it('should create a creative with its first version and answer 201', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/advertisers/${ADVERTISER_ID}/creatives`,
      headers: HEADERS,
      payload: { name: 'Bannière 300x250', format: 'display', subtype: 'image', version: FIRST_VERSION },
    });

    expect(response.statusCode).toBe(201);
    expect(service.create).toHaveBeenCalledWith(JANE, IDS.organization, ADVERTISER_ID, {
      name: 'Bannière 300x250',
      format: 'display',
      subtype: 'image',
      version: { ...FIRST_VERSION, trackers: [] },
    });
  });

  it('should read, update, delete and restore flat on the creative', async (): Promise<void> => {
    expect((await app.inject({ method: 'GET', url: `/creatives/${CREATIVE_ID}`, headers: HEADERS })).statusCode).toBe(
      200
    );
    expect(service.get).toHaveBeenCalledWith(JANE, IDS.organization, CREATIVE_ID);

    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/creatives/${CREATIVE_ID}`,
          headers: HEADERS,
          payload: { name: 'Bannière automne', clickThroughUrl: null },
        })
      ).statusCode
    ).toBe(200);
    expect(service.update).toHaveBeenCalledWith(JANE, IDS.organization, CREATIVE_ID, {
      name: 'Bannière automne',
      clickThroughUrl: null,
    });

    expect(
      (await app.inject({ method: 'DELETE', url: `/creatives/${CREATIVE_ID}`, headers: HEADERS })).statusCode
    ).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: `/creatives/${CREATIVE_ID}/restore`, headers: HEADERS })).statusCode
    ).toBe(200);
    expect(service.restore).toHaveBeenCalledWith(JANE, IDS.organization, CREATIVE_ID);
  });

  it('should refuse a change of format or subtype: that is a new creative', async (): Promise<void> => {
    for (const payload of [{ format: 'video' }, { subtype: 'vast_url' }]) {
      const response: LightMyRequestResponse = await app.inject({
        method: 'PATCH',
        url: `/creatives/${CREATIVE_ID}`,
        headers: HEADERS,
        payload,
      });

      expect(response.statusCode).toBe(400);
    }
    expect(service.update).not.toHaveBeenCalled();
  });

  it('should post the labels of a creative', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'PUT',
      url: `/creatives/${CREATIVE_ID}/labels`,
      headers: HEADERS,
      payload: { labelIds: [] },
    });

    expect(response.statusCode).toBe(200);
    expect(service.setLabels).toHaveBeenCalledWith(JANE, IDS.organization, CREATIVE_ID, { labelIds: [] });
  });

  it('should list the versions of a creative and add one, answering 201', async (): Promise<void> => {
    expect(
      (await app.inject({ method: 'GET', url: `/creatives/${CREATIVE_ID}/versions`, headers: HEADERS })).statusCode
    ).toBe(200);
    expect(service.listVersions).toHaveBeenCalledWith(
      JANE,
      IDS.organization,
      CREATIVE_ID,
      expect.objectContaining({ page: 1, limit: 50 })
    );

    const added: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/creatives/${CREATIVE_ID}/versions`,
      headers: HEADERS,
      payload: { payload: { altText: 'Automne' }, trackers: [{ event: 'click', url: 'https://tracker.test/c' }] },
    });
    expect(added.statusCode).toBe(201);
    expect(service.createVersion).toHaveBeenCalledWith(JANE, IDS.organization, CREATIVE_ID, {
      payload: { altText: 'Automne' },
      assets: [],
      trackers: [{ event: 'click', url: 'https://tracker.test/c' }],
    });
  });

  it('should read and activate a version by its own id', async (): Promise<void> => {
    expect(
      (await app.inject({ method: 'GET', url: `/creative-versions/${VERSION_ID}`, headers: HEADERS })).statusCode
    ).toBe(200);
    expect(service.getVersion).toHaveBeenCalledWith(JANE, IDS.organization, VERSION_ID);

    const activated: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/creative-versions/${VERSION_ID}/activate`,
      headers: HEADERS,
    });
    expect(activated.statusCode).toBe(200);
    expect(JSON.parse(activated.body)).toMatchObject({ id: VERSION_ID, active: true });
  });

  it('should serve no route updating a version: a version is immutable', async (): Promise<void> => {
    for (const method of ['PATCH', 'PUT', 'DELETE'] as const) {
      const response: LightMyRequestResponse = await app.inject({
        method,
        url: `/creative-versions/${VERSION_ID}`,
        headers: HEADERS,
        payload: { payload: {} },
      });

      expect(response.statusCode).toBe(404);
    }
  });

  it('should serve the four bulk routes, the mode defaulting to atomic', async (): Promise<void> => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/advertisers/${ADVERTISER_ID}/creatives/bulk`,
          headers: HEADERS,
          payload: { items: [{ name: 'Bannière', format: 'display', subtype: 'image', version: FIRST_VERSION }] },
        })
      ).statusCode
    ).toBe(200);
    expect(service.bulkCreate).toHaveBeenCalledWith(
      JANE,
      IDS.organization,
      ADVERTISER_ID,
      expect.objectContaining({ mode: 'atomic' })
    );

    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/creatives/bulk',
          headers: HEADERS,
          payload: { items: [{ id: CREATIVE_ID, name: 'Automne' }] },
        })
      ).statusCode
    ).toBe(200);
    expect(service.bulkUpdate).toHaveBeenCalled();

    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/creatives/bulk',
          headers: HEADERS,
          payload: { ids: [CREATIVE_ID] },
        })
      ).statusCode
    ).toBe(200);
    expect(service.bulkDelete).toHaveBeenCalledWith(JANE, IDS.organization, { mode: 'atomic', ids: [CREATIVE_ID] });

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/creatives/bulk/restore',
          headers: HEADERS,
          payload: { mode: 'partial', ids: [CREATIVE_ID] },
        })
      ).statusCode
    ).toBe(200);
    expect(service.bulkRestore).toHaveBeenCalledWith(JANE, IDS.organization, {
      mode: 'partial',
      ids: [CREATIVE_ID],
    });
  });

  it('should refuse a field the body does not declare, naming it', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/advertisers/${ADVERTISER_ID}/creatives`,
      headers: HEADERS,
      payload: { name: 'Bannière', format: 'display', subtype: 'image', version: FIRST_VERSION, nope: 1 },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 'validation_failed',
      params: { field: 'nope', rule: 'additionalProperties', location: 'body' },
    });
    expect(service.create).not.toHaveBeenCalled();
  });

  it('should relay a refusal of the service in the single error shape', async (): Promise<void> => {
    service.create.mockRejectedValue(
      httpError(400, 'A video creative arriving as vast_url needs its thumbnail', {
        code: 'creative_asset_role_missing',
        params: { role: 'thumbnail', format: 'video', subtype: 'vast_url' },
      })
    );

    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/advertisers/${ADVERTISER_ID}/creatives`,
      headers: HEADERS,
      payload: { name: 'Spot', format: 'video', subtype: 'vast_url', version: { payload: {} } },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 'creative_asset_role_missing',
      params: { role: 'thumbnail', format: 'video', subtype: 'vast_url' },
    });
  });
});
