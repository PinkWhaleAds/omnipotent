import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { FastifyInstance, LightMyRequestResponse } from 'fastify';

import ConversionGoalController from '@modules/conversion-goal/conversion-goal.controller';
import TrackingController from '@modules/tracking/tracking.controller';
import { AdvertiserTracking, ConversionGoal } from '@src/types';
import { IDS, JANE } from '@test/unit/mocks/auth.fixtures';
import { closeTestApp, setupRouteAppForTest } from '@test/utils/fastify-test-app.utils';

/** The goal the specs work with. */
const GOAL_ID = 'f0000000-0000-4000-8000-000000000001';

/** The Organization every route acts on. */
const HEADERS: Record<string, string> = { 'x-organization-id': IDS.organization };

/** A goal, checked against the real response schema. */
const ACHAT: ConversionGoal = {
  id: GOAL_ID,
  advertiserId: IDS.advertiser,
  key: 'achat',
  name: 'Achat',
  category: 'purchase',
  valueMode: 'fixed',
  defaultValueCents: 8_900,
  currency: 'EUR',
  counting: 'every',
  status: 'active',
  createdAt: '2027-01-03T10:00:00.000Z',
  updatedAt: '2027-01-03T10:00:00.000Z',
};

/** The tracking of an Advertiser, checked against the real response schema. */
const TRACKING: AdvertiserTracking = {
  advertiserId: IDS.advertiser,
  snippet: '<script></script>',
  scriptUrl: 'https://api.omnipotent.test/t/k3yK3yK3yK3yK3yK3yK3yK3y.js',
  cspDomains: ['api.omnipotent.test'],
  lastSeenAt: null,
  platforms: [
    {
      platform: 'google_ads',
      adAccountId: 'ff000000-0000-4000-8000-000000000001',
      adAccountName: null,
      status: 'manual_required',
      message: 'Tracked by another manager account',
      messageCode: 'google_conversion_tracking_by_other_manager',
      messageParams: { account: '555-000-1111' },
      goals: [
        {
          goalId: GOAL_ID,
          key: 'achat',
          status: 'pending',
          message: null,
          messageCode: null,
          messageParams: null,
          biddable: false,
        },
      ],
    },
  ],
};

describe('Unit::Modules::ConversionGoalController', () => {
  let app: FastifyInstance;
  let service: Record<string, jest.Mock>;

  beforeEach(async (): Promise<void> => {
    service = {
      list: jest.fn().mockResolvedValue({ items: [ACHAT], total: 1, page: 1, limit: 50 }),
      create: jest.fn().mockResolvedValue(ACHAT),
      get: jest.fn().mockResolvedValue(ACHAT),
      update: jest.fn().mockResolvedValue(ACHAT),
    };
    app = await setupRouteAppForTest(ConversionGoalController, { conversionGoalService: service }, JANE);
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  it('should list the goals of an Advertiser, filtered by status', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: `/advertisers/${IDS.advertiser}/conversion-goals?status=active`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ items: [ACHAT], total: 1, page: 1, limit: 50 });
    expect(service.list).toHaveBeenCalledWith(JANE, IDS.organization, IDS.advertiser, {
      page: 1,
      limit: 50,
      status: 'active',
    });
  });

  it('should create a goal with the defaults of its body, and answer 201', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/advertisers/${IDS.advertiser}/conversion-goals`,
      headers: HEADERS,
      payload: { key: 'achat', name: 'Achat', category: 'purchase', currency: 'eur' },
    });

    expect(response.statusCode).toBe(201);
    expect(service.create).toHaveBeenCalledWith(JANE, IDS.organization, IDS.advertiser, {
      key: 'achat',
      name: 'Achat',
      category: 'purchase',
      valueMode: 'none',
      currency: 'EUR',
      counting: 'every',
    });
  });

  it.each([
    ['a key starting with a digit', { key: '1achat', name: 'Achat', category: 'purchase' }],
    ['a key in capitals', { key: 'Achat', name: 'Achat', category: 'purchase' }],
    ['an unknown category', { key: 'achat', name: 'Achat', category: 'sale' }],
    ['a value in units', { key: 'achat', name: 'Achat', category: 'purchase', defaultValueCents: 89.5 }],
    ['a field the route does not declare', { key: 'achat', name: 'Achat', category: 'purchase', defaultValue: 89 }],
  ])('should refuse %s', async (_label: string, payload: object): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/advertisers/${IDS.advertiser}/conversion-goals`,
      headers: HEADERS,
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({ code: 'validation_failed' });
    expect(service.create).not.toHaveBeenCalled();
  });

  it('should read a goal', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: `/conversion-goals/${GOAL_ID}`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(service.get).toHaveBeenCalledWith(JANE, IDS.organization, GOAL_ID);
  });

  it('should change a goal, its key never', async (): Promise<void> => {
    const changed: LightMyRequestResponse = await app.inject({
      method: 'PATCH',
      url: `/conversion-goals/${GOAL_ID}`,
      headers: HEADERS,
      payload: { status: 'archived' },
    });
    const refused: LightMyRequestResponse = await app.inject({
      method: 'PATCH',
      url: `/conversion-goals/${GOAL_ID}`,
      headers: HEADERS,
      payload: { key: 'vente' },
    });

    expect(changed.statusCode).toBe(200);
    expect(service.update).toHaveBeenCalledWith(JANE, IDS.organization, GOAL_ID, { status: 'archived' });
    expect(refused.statusCode).toBe(400);
  });
});

describe('Unit::Modules::TrackingController', () => {
  let app: FastifyInstance;
  let service: Record<string, jest.Mock>;

  beforeEach(async (): Promise<void> => {
    service = {
      get: jest.fn().mockResolvedValue(TRACKING),
      loaderConfig: jest.fn().mockResolvedValue({ googleTagIds: ['AW-111'], goals: {} }),
    };
    app = await setupRouteAppForTest(TrackingController, { trackingService: service }, JANE);
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  it('should give the tracking of an Advertiser', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: `/advertisers/${IDS.advertiser}/tracking`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(TRACKING);
    expect(service.get).toHaveBeenCalledWith(JANE, IDS.organization, IDS.advertiser);
  });

  it('should serve the script of a key as cross-origin JavaScript, cached five minutes', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/t/k3yK3yK3yK3yK3yK3yK3yK3y.js',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
      'x-content-type-options': 'nosniff',
    });
    expect(response.body).toContain('/* Omnipotent tracking script */');
    expect(response.body).toContain('"googleTagIds":["AW-111"]');
    expect(service.loaderConfig).toHaveBeenCalledWith('k3yK3yK3yK3yK3yK3yK3yK3y');
  });

  it('should answer 404 for an unknown key', async (): Promise<void> => {
    service.loaderConfig.mockResolvedValue(null);

    const response: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/t/k3yK3yK3yK3yK3yK3yK3yK3y.js' });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toMatchObject({ code: 'tracking_key_unknown' });
  });

  it('should refuse a malformed key before asking anything', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/t/short.js' });

    expect(response.statusCode).toBe(400);
    expect(service.loaderConfig).not.toHaveBeenCalled();
  });
});
