import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { FastifyInstance, FastifyPluginAsync, LightMyRequestResponse } from 'fastify';

import AdGroupController from '@modules/ad-group/ad-group.controller';
import CampaignController from '@modules/campaign/campaign.controller';
import LeverController from '@modules/lever/lever.controller';
import LineController from '@modules/line/line.controller';
import TargetingGroupController from '@modules/targeting-group/targeting-group.controller';
import { ErrorResponse } from '@src/types';
import { IDS, JANE } from '@test/unit/mocks/auth.fixtures';
import { closeTestApp, setupRouteAppForTest } from '@test/utils/fastify-test-app.utils';
import { httpError } from '@utils';

/**
 * The four levels below the campaign are served the same way, and the campaign only differs by its
 * parent: one table describes the five, and one suite exercises every route of every one of them.
 *
 * What it proves, level by level: the parent's id reaches the service on a nested route, the
 * resource's id on a flat one, the body arrives parsed by its Zod schema, each route answers the
 * status its contract names, and a refusal of the service crosses untouched in the single error
 * shape (`docs/phase-3.md` § 7).
 */
type Level = {
  /** Name of the level, for the test titles. */
  name: string;
  /** Its controller. */
  controller: FastifyPluginAsync;
  /** The decorator its handlers reach. */
  service: string;
  /** URL of its parent, with the parent's id. */
  parentUrl: string;
  /** URL of the resource itself. */
  flatUrl: string;
  /** A body its creation accepts. */
  createBody: Record<string, unknown>;
  /** A body its update accepts. */
  updateBody: Record<string, unknown>;
  /** The resource as the API answers it, which its response schema must accept. */
  resource: Record<string, unknown>;
  /** Whether it serves the bulk routes. */
  bulk: boolean;
};

/** An id of the parent, and one of the resource: any uuid will do, the service is mocked. */
const PARENT_ID = IDS.advertiser;
const ID = 'f9000000-0000-4000-8000-000000000001';

/** An instant, as the API writes it. */
const ISO: string = new Date('2026-10-06T10:00:00.000Z').toISOString();

/**
 * The budget block every level answers.
 *
 * The response schemas are what makes this spec worth its length: a mock answering a shape the
 * schema does not accept makes Fastify refuse to serialize it, so these fixtures are checked against
 * the real contract rather than against a hand-written expectation.
 */
const BUDGET = {
  explicitCents: null,
  effectiveCents: 100_000,
  source: 'inherited',
  volume: null,
  perPlatform: [{ platform: 'hawk', shareBasisPoints: 10_000, cents: 100_000 }],
};

/** What every level carries, whatever it is. */
const COMMON = {
  id: ID,
  organizationId: IDS.organization,
  budget: BUDGET,
  capping: null,
  labels: [],
  createdAt: ISO,
  updatedAt: ISO,
  deletedAt: null,
};

/** The header every org-scoped route reads. */
const HEADERS: Record<string, string> = { 'x-organization-id': IDS.organization };

/** The five levels of the tree, in order. */
const LEVELS: Level[] = [
  {
    name: 'Campaign',
    controller: CampaignController,
    service: 'campaignService',
    parentUrl: `/advertisers/${PARENT_ID}/campaigns`,
    flatUrl: '/campaigns',
    createBody: {
      name: 'Herbéa — Automne',
      currency: 'EUR',
      startsOn: '2026-11-05',
      endsOn: '2026-11-20',
      budgetCents: 100_000,
      containsPoliticalAdvertising: false,
    },
    updateBody: { name: 'Herbéa — Hiver' },
    resource: {
      ...COMMON,
      advertiserId: PARENT_ID,
      name: 'Herbéa — Automne',
      status: 'draft',
      currency: 'EUR',
      timezone: null,
      startsOn: '2026-11-05',
      startTime: null,
      endsOn: '2026-11-20',
      capping: [],
      insertionOrderNumber: null,
      containsPoliticalAdvertising: false,
      budget: { ...BUDGET, source: 'explicit', explicitCents: 100_000, perPlatform: [] },
    },
    bulk: true,
  },
  {
    name: 'Lever',
    controller: LeverController,
    service: 'leverService',
    parentUrl: `/campaigns/${PARENT_ID}/levers`,
    flatUrl: '/levers',
    createBody: { lever: 'dac', platformShares: [{ platform: 'hawk', shareBasisPoints: 10_000 }] },
    updateBody: { productsMode: false },
    resource: {
      ...COMMON,
      campaignId: PARENT_ID,
      lever: 'dac',
      status: 'active',
      productsMode: false,
      platformShares: [{ platform: 'hawk', shareBasisPoints: 10_000 }],
      platformSettings: {},
      extensions: null,
      startsOn: null,
      endsOn: null,
    },
    bulk: false,
  },
  {
    name: 'AdGroup',
    controller: AdGroupController,
    service: 'adGroupService',
    parentUrl: `/levers/${PARENT_ID}/ad-groups`,
    flatUrl: '/ad-groups',
    createBody: { name: 'Prospection' },
    updateBody: { name: 'Retargeting' },
    resource: {
      ...COMMON,
      campaignId: 'f1000000-0000-4000-8000-000000000001',
      leverId: PARENT_ID,
      lever: 'dac',
      name: 'Prospection',
      status: 'active',
      objective: 'awareness',
      bidStrategy: 'fixed_cpm',
      bidAmountCents: 450,
      platformShares: null,
      locationIntent: null,
      startsOn: null,
      endsOn: null,
    },
    bulk: true,
  },
  {
    name: 'TargetingGroup',
    controller: TargetingGroupController,
    service: 'targetingGroupService',
    parentUrl: `/ad-groups/${PARENT_ID}/targeting-groups`,
    flatUrl: '/targeting-groups',
    createBody: { name: 'Île-de-France' },
    updateBody: { bidAmountCents: 300 },
    resource: {
      ...COMMON,
      campaignId: 'f1000000-0000-4000-8000-000000000001',
      adGroupId: PARENT_ID,
      lever: 'dac',
      name: 'Île-de-France',
      status: 'active',
      bidAmountCents: null,
    },
    bulk: true,
  },
  {
    name: 'Line',
    controller: LineController,
    service: 'lineService',
    parentUrl: `/targeting-groups/${PARENT_ID}/lines`,
    flatUrl: '/lines',
    createBody: { name: 'Bannière 300x250' },
    updateBody: { landingPageUrl: 'https://herbea.test/automne' },
    resource: {
      ...COMMON,
      campaignId: 'f1000000-0000-4000-8000-000000000001',
      targetingGroupId: PARENT_ID,
      lever: 'dac',
      name: 'Bannière 300x250',
      status: 'active',
      landingPageUrl: null,
      startsOn: null,
      endsOn: null,
    },
    bulk: true,
  },
];

/** What a mocked service of a level answers. */
type ServiceMock = Record<string, jest.Mock>;

/**
 * Build a service answering, for each method, the shape that method's response schema describes.
 *
 * @param level - The level being served
 * @returns The mock
 */
function serviceMock(level: Level): ServiceMock {
  const resource: Record<string, unknown> = level.resource;
  const deletion = { id: ID, deletedAt: ISO };
  return {
    list: jest.fn().mockResolvedValue({ items: [resource], total: 1, page: 1, limit: 50 }),
    get: jest.fn().mockResolvedValue(resource),
    create: jest.fn().mockResolvedValue(resource),
    update: jest.fn().mockResolvedValue(resource),
    delete: jest.fn().mockResolvedValue(deletion),
    restore: jest.fn().mockResolvedValue({ id: ID, deletedAt: null }),
    setLabels: jest.fn().mockResolvedValue(resource),
    bulkCreate: jest.fn().mockResolvedValue({ items: [resource], failed: [] }),
    bulkUpdate: jest.fn().mockResolvedValue({ items: [resource], failed: [] }),
    bulkDelete: jest.fn().mockResolvedValue({ items: [deletion], failed: [] }),
    bulkRestore: jest.fn().mockResolvedValue({ items: [{ id: ID, deletedAt: null }], failed: [] }),
  };
}

describe.each(LEVELS)('Unit::Modules::$name Controller', (level: Level) => {
  let app: FastifyInstance;
  let service: ServiceMock;

  beforeEach(async (): Promise<void> => {
    jest.clearAllMocks();
    service = serviceMock(level);
    app = await setupRouteAppForTest(level.controller, { [level.service]: service }, JANE);
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  it('should list under the parent, handing the service the parent id and the page', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: level.parentUrl,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(service.list).toHaveBeenCalledWith(
      JANE,
      IDS.organization,
      PARENT_ID,
      expect.objectContaining({ page: 1, limit: 50 })
    );
  });

  it('should create under the parent and answer 201', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: level.parentUrl,
      headers: HEADERS,
      payload: level.createBody,
    });

    expect(response.statusCode).toBe(201);
    expect(service.create).toHaveBeenCalledWith(
      JANE,
      IDS.organization,
      PARENT_ID,
      expect.objectContaining({ ...level.createBody })
    );
  });

  it('should read, update and delete flat on the resource', async (): Promise<void> => {
    expect((await app.inject({ method: 'GET', url: `${level.flatUrl}/${ID}`, headers: HEADERS })).statusCode).toBe(200);
    expect(service.get).toHaveBeenCalledWith(JANE, IDS.organization, ID);

    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `${level.flatUrl}/${ID}`,
          headers: HEADERS,
          payload: level.updateBody,
        })
      ).statusCode
    ).toBe(200);
    expect(service.update).toHaveBeenCalledWith(JANE, IDS.organization, ID, expect.objectContaining(level.updateBody));

    expect((await app.inject({ method: 'DELETE', url: `${level.flatUrl}/${ID}`, headers: HEADERS })).statusCode).toBe(
      200
    );
    expect(service.delete).toHaveBeenCalledWith(JANE, IDS.organization, ID);
  });

  it('should restore the resource and post its Labels', async (): Promise<void> => {
    expect(
      (await app.inject({ method: 'POST', url: `${level.flatUrl}/${ID}/restore`, headers: HEADERS })).statusCode
    ).toBe(200);
    expect(service.restore).toHaveBeenCalledWith(JANE, IDS.organization, ID);

    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `${level.flatUrl}/${ID}/labels`,
          headers: HEADERS,
          payload: { labelIds: [] },
        })
      ).statusCode
    ).toBe(200);
    expect(service.setLabels).toHaveBeenCalledWith(JANE, IDS.organization, ID, { labelIds: [] });
  });

  it('should refuse an id that is not a uuid', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: `${level.flatUrl}/not-a-uuid`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(400);
    expect((JSON.parse(response.body) as ErrorResponse).code).toBe('validation_failed');
    expect(service.get).not.toHaveBeenCalled();
  });

  it('should refuse a field the body does not declare, naming it', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: level.parentUrl,
      headers: HEADERS,
      payload: { ...level.createBody, nope: 1 },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 'validation_failed',
      params: { field: 'nope', rule: 'additionalProperties', location: 'body' },
    });
  });

  it('should refuse a request without the Organization header', async (): Promise<void> => {
    expect((await app.inject({ method: 'GET', url: level.parentUrl })).statusCode).toBe(400);
  });

  it('should relay a refusal of the service in the single error shape', async (): Promise<void> => {
    service.get.mockRejectedValue(httpError(404, 'Gone', { code: 'nope_not_found' }));

    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: `${level.flatUrl}/${ID}`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toMatchObject({ code: 'nope_not_found', params: {} });
  });

  if (level.bulk) {
    it('should create a bulk under the parent, the mode defaulting to atomic', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: `${level.parentUrl}/bulk`,
        headers: HEADERS,
        payload: { items: [level.createBody] },
      });

      expect(response.statusCode).toBe(200);
      expect(service.bulkCreate).toHaveBeenCalledWith(
        JANE,
        IDS.organization,
        PARENT_ID,
        expect.objectContaining({ mode: 'atomic' })
      );
    });

    it('should update, delete and restore a bulk flat on the resource', async (): Promise<void> => {
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: `${level.flatUrl}/bulk`,
            headers: HEADERS,
            payload: { items: [{ id: ID, ...level.updateBody }] },
          })
        ).statusCode
      ).toBe(200);
      expect(service.bulkUpdate).toHaveBeenCalledWith(
        JANE,
        IDS.organization,
        expect.objectContaining({ mode: 'atomic' })
      );

      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `${level.flatUrl}/bulk`,
            headers: HEADERS,
            payload: { ids: [ID] },
          })
        ).statusCode
      ).toBe(200);
      expect(service.bulkDelete).toHaveBeenCalledWith(JANE, IDS.organization, { mode: 'atomic', ids: [ID] });

      expect(
        (
          await app.inject({
            method: 'POST',
            url: `${level.flatUrl}/bulk/restore`,
            headers: HEADERS,
            payload: { mode: 'partial', ids: [ID] },
          })
        ).statusCode
      ).toBe(200);
      expect(service.bulkRestore).toHaveBeenCalledWith(JANE, IDS.organization, { mode: 'partial', ids: [ID] });
    });
  } else {
    it('should serve no bulk route: one channel of each per campaign', async (): Promise<void> => {
      for (const [method, url] of [
        ['POST', `${level.parentUrl}/bulk`],
        ['PATCH', `${level.flatUrl}/bulk`],
        ['DELETE', `${level.flatUrl}/bulk`],
        ['POST', `${level.flatUrl}/bulk/restore`],
      ] as const) {
        const response: LightMyRequestResponse = await app.inject({ method, url, headers: HEADERS, payload: {} });

        // `/levers/bulk` matches no route; `/campaigns/:id/levers/bulk` is not declared either.
        expect([400, 404]).toContain(response.statusCode);
        expect(service.bulkCreate).not.toHaveBeenCalled();
      }
    });
  }
});
