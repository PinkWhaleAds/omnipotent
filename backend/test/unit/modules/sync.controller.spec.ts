import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { FastifyInstance, LightMyRequestResponse } from 'fastify';

import SyncController from '@modules/sync/sync.controller';
import { IDS, JANE } from '@test/unit/mocks/auth.fixtures';
import { closeTestApp, setupRouteAppForTest } from '@test/utils/fastify-test-app.utils';
import { httpError } from '@utils';

/** The campaign and the unit the routes name. */
const CAMPAIGN_ID = 'f1000000-0000-4000-8000-000000000001';
const UNIT_ID = 'fc000000-0000-4000-8000-000000000001';
const AD_GROUP_ID = 'f3000000-0000-4000-8000-000000000001';
const ACCOUNT_ID = 'ff000000-0000-4000-8000-000000000001';

/** Headers of every call: the Organization the caller acts in. */
const HEADERS: Record<string, string> = { 'x-organization-id': IDS.organization };

/** One unit, checked against its real response schema. */
const UNIT = {
  id: UNIT_ID,
  platform: 'hawk',
  lever: 'dooh',
  adGroupId: AD_GROUP_ID,
  adAccountId: ACCOUNT_ID,
  currency: 'EUR',
  fxRate: 1,
  state: 'error',
  objects: [
    {
      key: `ad_group:${AD_GROUP_ID}`,
      level: 'ad_group',
      nodeId: AD_GROUP_ID,
      keywordId: null,
      object: 'campaign',
      externalId: 'HAWK-1',
    },
  ],
  attempts: 2,
  nextAttemptAt: '2027-01-03T10:04:00.000Z',
  lastAttemptAt: '2027-01-03T10:00:00.000Z',
  lastSyncedAt: null,
  errorCode: 'hawk_unauthorized',
  errorParams: { account: 'A1' },
  errorMessage: 'Unauthorized',
};

/** What the status route answers. */
const STATUS = { campaignId: CAMPAIGN_ID, units: [UNIT], pending: 1 };

describe('Unit::Modules::SyncController', () => {
  let app: FastifyInstance;
  let service: Record<string, jest.Mock>;

  beforeEach(async (): Promise<void> => {
    jest.clearAllMocks();
    service = {
      platformStatus: jest.fn().mockResolvedValue(STATUS),
      requestSync: jest.fn().mockResolvedValue({ campaignId: CAMPAIGN_ID, units: 3 }),
      retry: jest.fn().mockResolvedValue({ ...UNIT, state: 'pending', attempts: 0, nextAttemptAt: null }),
    };
    app = await setupRouteAppForTest(SyncController, { syncService: service }, JANE);
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  it('should answer where the campaign stands on each platform', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: `/campaigns/${CAMPAIGN_ID}/platform-status`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(STATUS);
    expect(service.platformStatus).toHaveBeenCalledWith(JANE, IDS.organization, CAMPAIGN_ID);
  });

  it('should ask for a synchronization', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/campaigns/${CAMPAIGN_ID}/sync`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ campaignId: CAMPAIGN_ID, units: 3 });
    expect(service.requestSync).toHaveBeenCalledWith(JANE, IDS.organization, CAMPAIGN_ID);
  });

  it('should retry one unit', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/campaigns/${CAMPAIGN_ID}/platform-units/${UNIT_ID}/retry`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ id: UNIT_ID, state: 'pending' });
    expect(service.retry).toHaveBeenCalledWith(JANE, IDS.organization, CAMPAIGN_ID, UNIT_ID);
  });

  it('should refuse a unit id that is not one', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/campaigns/${CAMPAIGN_ID}/platform-units/not-a-uuid/retry`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(400);
    expect(service.retry).not.toHaveBeenCalled();
  });

  it('should relay the refusal of a draft in the single error shape', async (): Promise<void> => {
    service.requestSync.mockRejectedValue(
      httpError(400, 'This campaign has not been launched, so there is nothing to synchronize', {
        code: 'sync_campaign_not_launched',
      })
    );

    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/campaigns/${CAMPAIGN_ID}/sync`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({ code: 'sync_campaign_not_launched' });
  });
});
