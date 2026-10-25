import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { FastifyInstance, LightMyRequestResponse } from 'fastify';

import TargetingController from '@modules/targeting/targeting.controller';
import KeywordController from '@modules/keyword/keyword.controller';
import { IDS, JANE } from '@test/unit/mocks/auth.fixtures';
import { closeTestApp, setupRouteAppForTest } from '@test/utils/fastify-test-app.utils';
import { httpError } from '@utils';

/** The TargetingGroup and the keyword the routes name. */
const NODE_ID = 'f4000000-0000-4000-8000-000000000001';
const KEYWORD_ID = 'fb000000-0000-4000-8000-000000000001';

/** Headers of every call: the Organization the caller acts in. */
const HEADERS: Record<string, string> = { 'x-organization-id': IDS.organization };

/** What the targeting routes answer, checked against their real response schema. */
const TARGETING = {
  targetingGroupId: NODE_ID,
  lever: 'dac',
  permittedDimensions: ['country'],
  targeting: { country: { include: ['FR'], exclude: [] } },
};

/** What the keyword routes answer. */
const KEYWORD = {
  id: KEYWORD_ID,
  targetingGroupId: NODE_ID,
  text: 'chaussures de rando',
  matchType: 'exact',
  negative: false,
  createdAt: new Date('2026-10-06T10:00:00.000Z').toISOString(),
};

describe('Unit::Modules::TargetingController', () => {
  let app: FastifyInstance;
  let service: Record<string, jest.Mock>;

  beforeEach(async (): Promise<void> => {
    jest.clearAllMocks();
    service = {
      get: jest.fn().mockResolvedValue(TARGETING),
      replace: jest.fn().mockResolvedValue(TARGETING),
      setDimension: jest.fn().mockResolvedValue(TARGETING),
      removeDimension: jest.fn().mockResolvedValue(TARGETING),
    };
    app = await setupRouteAppForTest(TargetingController, { targetingService: service }, JANE);
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  it('should answer the registry of dimensions without naming an Organization', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/targeting-dimensions' });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { dimensions: { dimension: string; criteriaSchema: object }[] };
    expect(body.dimensions.length).toBeGreaterThan(0);
    expect(body.dimensions[0]).toMatchObject({
      dimension: expect.any(String),
      label: expect.any(String),
      family: expect.any(String),
      criteriaSchema: expect.any(Object),
    });
  });

  it('should read the targeting of a node', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: `/targeting-groups/${NODE_ID}/targeting`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(TARGETING);
    expect(service.get).toHaveBeenCalledWith(JANE, IDS.organization, NODE_ID);
  });

  it('should replace the whole targeting, the body arriving parsed', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'PUT',
      url: `/targeting-groups/${NODE_ID}/targeting`,
      headers: HEADERS,
      payload: { targeting: { country: { include: ['FR'] } } },
    });

    expect(response.statusCode).toBe(200);
    expect(service.replace).toHaveBeenCalledWith(JANE, IDS.organization, NODE_ID, {
      country: { include: ['FR'], exclude: [] },
    });
  });

  it('should accept an empty targeting', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'PUT',
      url: `/targeting-groups/${NODE_ID}/targeting`,
      headers: HEADERS,
      payload: { targeting: {} },
    });

    expect(response.statusCode).toBe(200);
    expect(service.replace).toHaveBeenCalledWith(JANE, IDS.organization, NODE_ID, {});
  });

  it('should post and drop one dimension, naming it in the URL', async (): Promise<void> => {
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/targeting-groups/${NODE_ID}/targeting/country`,
          headers: HEADERS,
          payload: { criteria: { include: ['FR'] } },
        })
      ).statusCode
    ).toBe(200);
    expect(service.setDimension).toHaveBeenCalledWith(JANE, IDS.organization, NODE_ID, 'country', {
      include: ['FR'],
    });

    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/targeting-groups/${NODE_ID}/targeting/country`,
          headers: HEADERS,
        })
      ).statusCode
    ).toBe(200);
    expect(service.removeDimension).toHaveBeenCalledWith(JANE, IDS.organization, NODE_ID, 'country');
  });

  it('should refuse a dimension the registry does not know, before any service is called', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'DELETE',
      url: `/targeting-groups/${NODE_ID}/targeting/astrology`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(400);
    expect(service.removeDimension).not.toHaveBeenCalled();
  });

  it('should refuse a dimension the whole-object body does not declare', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'PUT',
      url: `/targeting-groups/${NODE_ID}/targeting`,
      headers: HEADERS,
      payload: { targeting: { astrology: { include: ['leo'] } } },
    });

    expect(response.statusCode).toBe(400);
    expect(service.replace).not.toHaveBeenCalled();
  });

  it('should relay a refusal of the service in the single error shape', async (): Promise<void> => {
    service.replace.mockRejectedValue(
      httpError(400, 'The dac lever has nothing to do with context_hints', {
        code: 'targeting_dimension_forbidden',
        params: { lever: 'dac', dimension: 'context_hints' },
      })
    );

    const response: LightMyRequestResponse = await app.inject({
      method: 'PUT',
      url: `/targeting-groups/${NODE_ID}/targeting`,
      headers: HEADERS,
      payload: { targeting: {} },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 'targeting_dimension_forbidden',
      params: { lever: 'dac', dimension: 'context_hints' },
    });
  });
});

describe('Unit::Modules::KeywordController', () => {
  let app: FastifyInstance;
  let service: Record<string, jest.Mock>;

  beforeEach(async (): Promise<void> => {
    jest.clearAllMocks();
    service = {
      list: jest.fn().mockResolvedValue({ items: [KEYWORD], total: 1, page: 1, limit: 50 }),
      add: jest.fn().mockResolvedValue({ items: [KEYWORD], failed: [] }),
      update: jest.fn().mockResolvedValue(KEYWORD),
      remove: jest.fn().mockResolvedValue({ id: KEYWORD_ID, deleted: true }),
    };
    app = await setupRouteAppForTest(KeywordController, { keywordService: service }, JANE);
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  it('should list the keywords of a node, with the polarity filter', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: `/targeting-groups/${NODE_ID}/keywords?negative=true`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(service.list).toHaveBeenCalledWith(
      JANE,
      IDS.organization,
      NODE_ID,
      expect.objectContaining({ negative: true, page: 1, limit: 50 })
    );
  });

  it('should post keywords and answer 200 with what failed, as every bulk does', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/targeting-groups/${NODE_ID}/keywords`,
      headers: HEADERS,
      payload: { keywords: [{ text: 'chaussures de rando', matchType: 'exact' }] },
    });

    expect(response.statusCode).toBe(200);
    expect(service.add).toHaveBeenCalledWith(JANE, IDS.organization, NODE_ID, {
      mode: 'atomic',
      keywords: [{ text: 'chaussures de rando', matchType: 'exact', negative: false }],
    });
  });

  it('should change and remove one keyword, flat on its id', async (): Promise<void> => {
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/keywords/${KEYWORD_ID}`,
          headers: HEADERS,
          payload: { negative: true },
        })
      ).statusCode
    ).toBe(200);
    expect(service.update).toHaveBeenCalledWith(JANE, IDS.organization, KEYWORD_ID, { negative: true });

    const removal: LightMyRequestResponse = await app.inject({
      method: 'DELETE',
      url: `/keywords/${KEYWORD_ID}`,
      headers: HEADERS,
    });
    expect(removal.statusCode).toBe(200);
    expect(JSON.parse(removal.body)).toEqual({ id: KEYWORD_ID, deleted: true });
  });

  it('should refuse more keywords than one request accepts', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/targeting-groups/${NODE_ID}/keywords`,
      headers: HEADERS,
      payload: { keywords: Array.from({ length: 501 }, (): object => ({ text: 'chaussures' })) },
    });

    expect(response.statusCode).toBe(400);
    expect(service.add).not.toHaveBeenCalled();
  });

  it('should relay a refusal of the service in the single error shape', async (): Promise<void> => {
    service.add.mockRejectedValue(
      httpError(400, 'The dooh lever does not buy keywords', {
        code: 'keywords_not_permitted',
        params: { lever: 'dooh' },
      })
    );

    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `/targeting-groups/${NODE_ID}/keywords`,
      headers: HEADERS,
      payload: { keywords: [{ text: 'chaussures' }] },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({ code: 'keywords_not_permitted', params: { lever: 'dooh' } });
  });
});
