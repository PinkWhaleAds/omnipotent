import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { FastifyInstance, LightMyRequestResponse } from 'fastify';

import BudgetDayController from '@modules/budget-day/budget-day.controller';
import { TreeLevel } from '@src/types';
import { IDS, JANE } from '@test/unit/mocks/auth.fixtures';
import { closeTestApp, setupRouteAppForTest } from '@test/utils/fastify-test-app.utils';
import { httpError } from '@utils';

/**
 * The five levels serve the same five curve routes, over one table and one service: one table
 * describes them, and one suite exercises every route of every one of them.
 *
 * What it proves, level by level: the node's id and **its level** reach the service, the body
 * arrives parsed by its Zod schema, each route answers the status its contract names, and a refusal
 * of the service crosses untouched in the single error shape (`docs/phase-4.md` § 6).
 */
type CurveLevel = {
  /** Name of the level, for the test titles. */
  name: string;
  /** The level the service must receive. */
  level: TreeLevel;
  /** URL of the resource, without its id. */
  url: string;
};

/** An id of the node: any uuid will do, the service is mocked. */
const ID = 'f9000000-0000-4000-8000-000000000001';

/** Headers of every call: the Organization the caller acts in. */
const HEADERS: Record<string, string> = { 'x-organization-id': IDS.organization };

/** The five levels carrying a curve, in the order the controller registers them. */
const LEVELS: CurveLevel[] = [
  { name: 'Campaign', level: 'campaign', url: '/campaigns' },
  { name: 'Lever', level: 'lever', url: '/levers' },
  { name: 'AdGroup', level: 'ad_group', url: '/ad-groups' },
  { name: 'TargetingGroup', level: 'targeting_group', url: '/targeting-groups' },
  { name: 'Line', level: 'line', url: '/lines' },
];

/**
 * The curve the mocked service answers.
 *
 * Checked against the real response schema rather than against a hand-written expectation: a shape
 * the schema does not accept makes Fastify refuse to serialize it, and the test fails.
 *
 * @param level - The level of the node
 * @returns The curve, as the API answers it
 */
function curveOf(level: TreeLevel): Record<string, unknown> {
  return {
    level,
    nodeId: ID,
    source: 'own',
    totalCents: 70_000,
    days: [
      { day: '2027-01-01', cents: 40_000, locked: true, weekend: false },
      { day: '2027-01-02', cents: 30_000, locked: false, weekend: true },
    ],
  };
}

/** The pacing the mocked service answers. */
const PACING: Record<string, unknown> = {
  plannedCents: 70_000,
  plannedToDateCents: 40_000,
  remainingCents: 70_000,
  todayCents: 30_000,
  budgetReached: false,
  status: 'underspending',
};

/** What a mocked budget curve service answers. */
type ServiceMock = Record<string, jest.Mock>;

describe.each(LEVELS)('Unit::Modules::$name BudgetDayController', (level: CurveLevel) => {
  let app: FastifyInstance;
  let service: ServiceMock;

  beforeEach(async (): Promise<void> => {
    jest.clearAllMocks();
    const curve: Record<string, unknown> = curveOf(level.level);
    service = {
      get: jest.fn().mockResolvedValue(curve),
      update: jest.fn().mockResolvedValue(curve),
      applyPreset: jest.fn().mockResolvedValue(curve),
      reset: jest.fn().mockResolvedValue(curve),
      pacing: jest.fn().mockResolvedValue(PACING),
    };
    app = await setupRouteAppForTest(BudgetDayController, { budgetCurveService: service }, JANE);
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  it('should read the curve of the node, handing the service its level', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: `${level.url}/${ID}/budget-days`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ level: level.level, nodeId: ID, source: 'own' });
    expect(service.get).toHaveBeenCalledWith(JANE, IDS.organization, level.level, ID);
  });

  it('should edit days of the curve, handing the service the body parsed', async (): Promise<void> => {
    const days = [{ day: '2027-01-01', cents: 40_000, locked: true }];

    const response: LightMyRequestResponse = await app.inject({
      method: 'PUT',
      url: `${level.url}/${ID}/budget-days`,
      headers: HEADERS,
      payload: { days },
    });

    expect(response.statusCode).toBe(200);
    expect(service.update).toHaveBeenCalledWith(JANE, IDS.organization, level.level, ID, { days });
  });

  it('should apply a preset, with the weekdays and the days that must not deliver', async (): Promise<void> => {
    const body = { preset: 'selected_days', weekdays: ['monday'], excludedDays: ['2027-01-04'] };

    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `${level.url}/${ID}/budget-days/preset`,
      headers: HEADERS,
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(service.applyPreset).toHaveBeenCalledWith(JANE, IDS.organization, level.level, ID, body);
  });

  it('should reset the curve and answer the flat one it now carries', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'DELETE',
      url: `${level.url}/${ID}/budget-days`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(service.reset).toHaveBeenCalledWith(JANE, IDS.organization, level.level, ID);
  });

  it('should answer the pacing of the day', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: `${level.url}/${ID}/pacing`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(PACING);
    expect(service.pacing).toHaveBeenCalledWith(JANE, IDS.organization, level.level, ID);
  });

  it('should refuse a preset naming weekdays it does not shape', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: `${level.url}/${ID}/budget-days/preset`,
      headers: HEADERS,
      payload: { preset: 'flat', weekdays: ['monday'] },
    });

    expect(response.statusCode).toBe(400);
    expect(service.applyPreset).not.toHaveBeenCalled();
  });

  it('should refuse a field the body does not declare, naming it', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'PUT',
      url: `${level.url}/${ID}/budget-days`,
      headers: HEADERS,
      payload: { days: [{ day: '2027-01-01', cents: 1_000 }], shape: 'flat' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 'validation_failed',
      params: { field: 'shape', rule: 'additionalProperties', location: 'body' },
    });
    expect(service.update).not.toHaveBeenCalled();
  });

  it('should refuse an id that is not a uuid', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: `${level.url}/not-a-uuid/budget-days`,
      headers: HEADERS,
    });

    expect(response.statusCode).toBe(400);
    expect(service.get).not.toHaveBeenCalled();
  });

  it('should relay a refusal of the service in the single error shape', async (): Promise<void> => {
    service.update.mockRejectedValue(
      httpError(400, 'A day already past no longer changes', {
        code: 'budget_day_past',
        params: { day: '2027-01-01' },
      })
    );

    const response: LightMyRequestResponse = await app.inject({
      method: 'PUT',
      url: `${level.url}/${ID}/budget-days`,
      headers: HEADERS,
      payload: { days: [{ day: '2027-01-01', cents: 1 }] },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 'budget_day_past',
      params: { day: '2027-01-01' },
    });
  });
});
