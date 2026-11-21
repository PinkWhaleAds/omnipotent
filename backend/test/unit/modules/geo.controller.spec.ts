import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { FastifyInstance, LightMyRequestResponse } from 'fastify';

import GeoController from '@modules/geo/geo.controller';
import { GeoLocationList } from '@src/types';
import { JANE } from '@test/unit/mocks/auth.fixtures';
import { closeTestApp, setupRouteAppForTest } from '@test/utils/fastify-test-app.utils';

/** What the referential answers, checked against the real response schema. */
const PLACES: GeoLocationList = {
  items: [
    {
      id: '1006094',
      level: 'city',
      name: 'Paris',
      canonicalName: 'Paris,Paris,Ile-de-France,France',
      countryCode: 'FR',
      targetType: 'City',
      parentName: 'Paris',
      active: true,
    },
  ],
};

describe('Unit::Modules::GeoController', () => {
  let app: FastifyInstance;
  let service: Record<string, jest.Mock>;

  beforeEach(async (): Promise<void> => {
    jest.clearAllMocks();
    service = { search: jest.fn().mockResolvedValue(PLACES), byIds: jest.fn().mockResolvedValue(PLACES) };
    app = await setupRouteAppForTest(GeoController, { geoService: service }, JANE);
  });

  afterEach(async (): Promise<void> => {
    await closeTestApp(app);
  });

  it('should search the places without naming an Organization, the lists as repeated parameters', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/geo/locations?q=Paris&countries=FR&countries=BE&levels=city&limit=5',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(PLACES);
    expect(service.search).toHaveBeenCalledWith({ q: 'Paris', countries: ['FR', 'BE'], levels: ['city'], limit: 5 });
  });

  it('should take one value of a list, and answer 20 places by default', async (): Promise<void> => {
    await app.inject({ method: 'GET', url: '/geo/locations?q=75001&levels=postal_code' });

    expect(service.search).toHaveBeenCalledWith({ q: '75001', levels: ['postal_code'], limit: 20 });
  });

  it.each([
    ['a text of one character', '/geo/locations?q=P'],
    ['an unknown level', '/geo/locations?q=Paris&levels=neighborhood'],
    ['a country that is not a code', '/geo/locations?q=Paris&countries=France'],
    ['a parameter the route does not declare', '/geo/locations?q=Paris&sort=name'],
    ['more than 50 places', '/geo/locations?q=Paris&limit=51'],
  ])('should refuse %s', async (_label: string, url: string): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({ method: 'GET', url });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({ code: 'validation_failed' });
    expect(service.search).not.toHaveBeenCalled();
  });

  it('should read places by id, one id or several', async (): Promise<void> => {
    const one: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/geo/locations/by-ids?ids=1006094' });
    await app.inject({ method: 'GET', url: '/geo/locations/by-ids?ids=1006094&ids=9040871' });

    expect(one.statusCode).toBe(200);
    expect(JSON.parse(one.body)).toEqual(PLACES);
    expect(service.byIds).toHaveBeenNthCalledWith(1, ['1006094']);
    expect(service.byIds).toHaveBeenNthCalledWith(2, ['1006094', '9040871']);
  });

  it('should refuse an id that is not one of the referential', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/geo/locations/by-ids?ids=Paris',
    });

    expect(response.statusCode).toBe(400);
    expect(service.byIds).not.toHaveBeenCalled();
  });
});
