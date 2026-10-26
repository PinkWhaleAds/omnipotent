import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { FastifyInstance, LightMyRequestResponse } from 'fastify';

import PreviewController from '@modules/preview/preview.controller';
import { IDS, JANE } from '@test/unit/mocks/auth.fixtures';
import { closeTestApp, setupRouteAppForTest } from '@test/utils/fastify-test-app.utils';
import { httpError } from '@utils';

/** The campaign the routes name. */
const CAMPAIGN_ID = 'f1000000-0000-4000-8000-000000000001';

/** Headers of every call: the Organization the caller acts in. */
const HEADERS: Record<string, string> = { 'x-organization-id': IDS.organization };

/** An instant, as the API writes it. */
const ISO: string = new Date('2026-10-06T10:00:00.000Z').toISOString();

/** What the preview answers, checked against its real response schema. */
const PREVIEW = {
  campaignId: CAMPAIGN_ID,
  status: 'draft',
  launchable: false,
  platforms: [
    {
      platform: 'hawk',
      lever: 'dooh',
      adAccountId: 'ff000000-0000-4000-8000-000000000001',
      accountCurrency: 'EUR',
      fxRate: null,
      effectiveCents: 100_000,
      objects: { media_plan: 1, campaign: 1, ad_group: 2, ad: 2 },
    },
  ],
  errors: [
    {
      code: 'preview_creative_missing',
      params: { name: 'Bannière' },
      level: 'line',
      nodeId: 'f5000000-0000-4000-8000-000000000001',
      platform: null,
    },
  ],
  warnings: [
    {
      code: 'preview_targeting_dropped',
      params: { dimension: 'viewability', cents: 100_000 },
      level: 'targeting_group',
      nodeId: 'f4000000-0000-4000-8000-000000000001',
      platform: 'hawk',
    },
  ],
};

/** What the lifecycle routes answer: the campaign, in its API shape. */
const CAMPAIGN = {
  id: CAMPAIGN_ID,
  organizationId: IDS.organization,
  advertiserId: IDS.advertiser,
  name: 'Automne',
  status: 'active',
  currency: 'EUR',
  timezone: null,
  startsOn: '2027-01-01',
  endsOn: '2027-01-07',
  budget: {
    explicitCents: 100_000,
    effectiveCents: 100_000,
    source: 'explicit',
    volume: null,
    perPlatform: [{ platform: 'hawk', shareBasisPoints: 10_000, cents: 100_000 }],
  },
  capping: null,
  insertionOrderNumber: null,
  labels: [],
  createdAt: ISO,
  updatedAt: ISO,
  deletedAt: null,
};

describe('Unit::Modules::PreviewController', () => {
  let app: FastifyInstance;
  let service: Record<string, jest.Mock>;

  beforeEach(async (): Promise<void> => {
    jest.clearAllMocks();
    service = {
      preview: jest.fn().mockResolvedValue(PREVIEW),
      launch: jest.fn().mockResolvedValue(CAMPAIGN),
      setStatus: jest.fn().mockResolvedValue(CAMPAIGN),
    };
    app = await setupRouteAppForTest(PreviewController, { previewService: service }, JANE);
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  it('should answer the preview, findings included', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: `/campaigns/${CAMPAIGN_ID}/preview`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(PREVIEW);
    expect(service.preview).toHaveBeenCalledWith(JANE, IDS.organization, CAMPAIGN_ID);
  });

  it('should launch a campaign', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/campaigns/${CAMPAIGN_ID}/launch`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ id: CAMPAIGN_ID, status: 'active' });
    expect(service.launch).toHaveBeenCalledWith(JANE, IDS.organization, CAMPAIGN_ID);
  });

  it('should pause, resume, end and archive through one route', async (): Promise<void> => {
    for (const status of ['paused', 'active', 'ended', 'archived'] as const) {
      const response: LightMyRequestResponse = await app.inject({
        method: 'PUT',
        url: `/campaigns/${CAMPAIGN_ID}/status`,
        headers: HEADERS,
        payload: { status },
      });

      expect(response.statusCode).toBe(200);
      expect(service.setStatus).toHaveBeenCalledWith(JANE, IDS.organization, CAMPAIGN_ID, { status });
    }
  });

  it('should refuse to set a campaign back to draft: a draft is launched', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'PUT',
      url: `/campaigns/${CAMPAIGN_ID}/status`,
      headers: HEADERS,
      payload: { status: 'draft' },
    });

    expect(response.statusCode).toBe(400);
    expect(service.setStatus).not.toHaveBeenCalled();
  });

  it('should relay the refusal of a launch in the single error shape', async (): Promise<void> => {
    service.launch.mockRejectedValue(
      httpError(400, 'The preview of this campaign reports errors: fix them before launching', {
        code: 'campaign_preview_failed',
        params: { errors: 2 },
      })
    );

    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/campaigns/${CAMPAIGN_ID}/launch`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({ code: 'campaign_preview_failed', params: { errors: 2 } });
  });
});
