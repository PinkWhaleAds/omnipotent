import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { FastifyInstance, LightMyRequestResponse } from 'fastify';

import AdAccountController from '@modules/ad-account/ad-account.controller';
import { IDS, JANE } from '@test/unit/mocks/auth.fixtures';
import { closeTestApp, setupRouteAppForTest } from '@test/utils/fastify-test-app.utils';
import { httpError } from '@utils';

/** The ids the routes name. */
const ACCOUNT_ID = 'ff000000-0000-4000-8000-000000000001';
const LINK_ID = 'ff000000-0000-4000-8000-000000000002';
const ADVERTISER_ID = IDS.advertiser;

/** Headers of every call: the Organization the caller acts in. */
const HEADERS: Record<string, string> = { 'x-organization-id': IDS.organization };

/** An instant, as the API writes it. */
const ISO: string = new Date('2026-10-06T10:00:00.000Z').toISOString();

/** What the account routes answer, checked against their real response schema. */
const ACCOUNT = {
  id: ACCOUNT_ID,
  organizationId: IDS.organization,
  platform: 'dv360',
  externalId: '123456',
  name: 'DV360 — Omnilor',
  currency: 'EUR',
  timezone: 'Europe/Paris',
  status: 'pending',
  statusReason: 'link_requested',
  scope: { partnerId: '987' },
  hasCredentials: false,
  createdAt: ISO,
  updatedAt: ISO,
  deletedAt: null,
};

/** What the link routes answer. */
const LINK = {
  id: LINK_ID,
  organizationId: IDS.organization,
  advertiserId: ADVERTISER_ID,
  platform: 'dv360',
  currency: 'EUR',
  adAccountId: ACCOUNT_ID,
  externalAdvertiserId: '555',
  createdAt: ISO,
  updatedAt: ISO,
};

describe('Unit::Modules::AdAccountController', () => {
  let app: FastifyInstance;
  let service: Record<string, jest.Mock>;

  beforeEach(async (): Promise<void> => {
    jest.clearAllMocks();
    service = {
      list: jest.fn().mockResolvedValue({ items: [ACCOUNT], total: 1, page: 1, limit: 50 }),
      get: jest.fn().mockResolvedValue(ACCOUNT),
      connect: jest.fn().mockResolvedValue(ACCOUNT),
      update: jest.fn().mockResolvedValue(ACCOUNT),
      setStatus: jest.fn().mockResolvedValue({ ...ACCOUNT, status: 'active', statusReason: null }),
      setCredentials: jest.fn().mockResolvedValue({ ...ACCOUNT, hasCredentials: true }),
      deleteCredentials: jest.fn().mockResolvedValue(ACCOUNT),
      disconnect: jest.fn().mockResolvedValue({ id: ACCOUNT_ID, deletedAt: ISO }),
      restore: jest.fn().mockResolvedValue({ id: ACCOUNT_ID, deletedAt: null }),
      listForAdvertiser: jest.fn().mockResolvedValue([LINK]),
      link: jest.fn().mockResolvedValue(LINK),
      updateLink: jest.fn().mockResolvedValue(LINK),
      unlink: jest.fn().mockResolvedValue({ id: LINK_ID, deletedAt: ISO }),
    };
    app = await setupRouteAppForTest(AdAccountController, { adAccountService: service }, JANE);
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  it('should list the accounts, filtered by platform and state', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/ad-accounts?platform=hawk&status=active',
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(service.list).toHaveBeenCalledWith(
      JANE,
      IDS.organization,
      expect.objectContaining({ platform: 'hawk', status: 'active' })
    );
  });

  it('should connect an account and answer 201', async (): Promise<void> => {
    const body = {
      platform: 'dv360',
      externalId: '123456',
      name: 'DV360 — Omnilor',
      currency: 'EUR',
      timezone: 'Europe/Paris',
      scope: { partnerId: '987' },
    };

    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/ad-accounts',
      headers: HEADERS,
      payload: body,
    });

    expect(response.statusCode).toBe(201);
    expect(service.connect).toHaveBeenCalledWith(JANE, IDS.organization, body);
  });

  it('should refuse a currency, a timezone or a platform the model does not know', async (): Promise<void> => {
    for (const payload of [
      { platform: 'myspace', externalId: '1', name: 'X', currency: 'EUR', timezone: 'Europe/Paris' },
      { platform: 'dv360', externalId: '1', name: 'X', currency: 'euro', timezone: 'Europe/Paris' },
      { platform: 'dv360', externalId: '1', name: 'X', currency: 'EUR', timezone: 'Mars/Olympus' },
    ]) {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/ad-accounts',
        headers: HEADERS,
        payload,
      });

      expect(response.statusCode).toBe(400);
    }
    expect(service.connect).not.toHaveBeenCalled();
  });

  it('should refuse a change of currency: another currency is another account', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'PATCH',
      url: `/ad-accounts/${ACCOUNT_ID}`,
      headers: HEADERS,
      payload: { currency: 'USD' },
    });

    expect(response.statusCode).toBe(400);
    expect(service.update).not.toHaveBeenCalled();
  });

  it('should read, update, disconnect and reconnect an account', async (): Promise<void> => {
    expect((await app.inject({ method: 'GET', url: `/ad-accounts/${ACCOUNT_ID}`, headers: HEADERS })).statusCode).toBe(
      200
    );
    expect(service.get).toHaveBeenCalledWith(JANE, IDS.organization, ACCOUNT_ID);

    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/ad-accounts/${ACCOUNT_ID}`,
          headers: HEADERS,
          payload: { name: 'DV360 — production' },
        })
      ).statusCode
    ).toBe(200);
    expect(service.update).toHaveBeenCalledWith(JANE, IDS.organization, ACCOUNT_ID, {
      name: 'DV360 — production',
    });

    expect(
      (await app.inject({ method: 'DELETE', url: `/ad-accounts/${ACCOUNT_ID}`, headers: HEADERS })).statusCode
    ).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: `/ad-accounts/${ACCOUNT_ID}/restore`, headers: HEADERS })).statusCode
    ).toBe(200);
    expect(service.restore).toHaveBeenCalledWith(JANE, IDS.organization, ACCOUNT_ID);
  });

  it('should record a transition, and refuse a reason where none belongs', async (): Promise<void> => {
    const accepted: LightMyRequestResponse = await app.inject({
      method: 'PUT',
      url: `/ad-accounts/${ACCOUNT_ID}/status`,
      headers: HEADERS,
      payload: { status: 'active' },
    });
    expect(accepted.statusCode).toBe(200);
    expect(service.setStatus).toHaveBeenCalledWith(JANE, IDS.organization, ACCOUNT_ID, { status: 'active' });

    for (const payload of [{ status: 'active', reason: 'link_revoked' }, { status: 'invalid' }]) {
      const response: LightMyRequestResponse = await app.inject({
        method: 'PUT',
        url: `/ad-accounts/${ACCOUNT_ID}/status`,
        headers: HEADERS,
        payload,
      });

      expect(response.statusCode).toBe(400);
    }
  });

  it('should take a secret and answer only that there is one', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'PUT',
      url: `/ad-accounts/${ACCOUNT_ID}/credentials`,
      headers: HEADERS,
      payload: { secret: 'ya29.a0AfH-very-secret' },
    });

    expect(response.statusCode).toBe(200);
    expect(service.setCredentials).toHaveBeenCalledWith(JANE, IDS.organization, ACCOUNT_ID, {
      secret: 'ya29.a0AfH-very-secret',
    });
    // The answer carries a boolean, never the value.
    expect(JSON.parse(response.body)).toMatchObject({ hasCredentials: true });
    expect(response.body).not.toContain('ya29');
  });

  it('should erase a secret', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'DELETE',
      url: `/ad-accounts/${ACCOUNT_ID}/credentials`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(service.deleteCredentials).toHaveBeenCalledWith(JANE, IDS.organization, ACCOUNT_ID);
  });

  it('should list, create, change and undo the links of a brand', async (): Promise<void> => {
    const listed: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: `/advertisers/${ADVERTISER_ID}/ad-accounts`,
      headers: HEADERS,
    });
    expect(listed.statusCode).toBe(200);
    expect(JSON.parse(listed.body)).toEqual({ items: [LINK] });

    const linked: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/advertisers/${ADVERTISER_ID}/ad-accounts`,
      headers: HEADERS,
      payload: { adAccountId: ACCOUNT_ID, externalAdvertiserId: '555' },
    });
    expect(linked.statusCode).toBe(201);
    expect(service.link).toHaveBeenCalledWith(JANE, IDS.organization, ADVERTISER_ID, {
      adAccountId: ACCOUNT_ID,
      externalAdvertiserId: '555',
    });

    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/advertiser-ad-accounts/${LINK_ID}`,
          headers: HEADERS,
          payload: { externalAdvertiserId: '666' },
        })
      ).statusCode
    ).toBe(200);
    expect(service.updateLink).toHaveBeenCalledWith(JANE, IDS.organization, LINK_ID, {
      externalAdvertiserId: '666',
    });

    expect(
      (await app.inject({ method: 'DELETE', url: `/advertiser-ad-accounts/${LINK_ID}`, headers: HEADERS })).statusCode
    ).toBe(200);
    expect(service.unlink).toHaveBeenCalledWith(JANE, IDS.organization, LINK_ID);
  });

  it('should relay a refusal of the service in the single error shape', async (): Promise<void> => {
    service.link.mockRejectedValue(
      httpError(400, 'This account cannot be used: its access is not valid', {
        code: 'ad_account_unusable',
        params: { status: 'invalid', statusReason: 'link_revoked' },
      })
    );

    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/advertisers/${ADVERTISER_ID}/ad-accounts`,
      headers: HEADERS,
      payload: { adAccountId: ACCOUNT_ID, externalAdvertiserId: '555' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 'ad_account_unusable',
      params: { status: 'invalid', statusReason: 'link_revoked' },
    });
  });
});
