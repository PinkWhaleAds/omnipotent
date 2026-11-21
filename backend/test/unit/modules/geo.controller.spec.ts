import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { FastifyInstance, LightMyRequestResponse } from 'fastify';

import GeoController from '@modules/geo/geo.controller';
import { GeoLocationList } from '@src/types';
import { IDS, JANE } from '@test/unit/mocks/auth.fixtures';
import { httpError } from '@utils';
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
  let geocoding: Record<string, jest.Mock>;

  beforeEach(async (): Promise<void> => {
    jest.clearAllMocks();
    service = { search: jest.fn().mockResolvedValue(PLACES), byIds: jest.fn().mockResolvedValue(PLACES) };
    geocoding = {
      status: jest.fn().mockReturnValue({ geocoding: true }),
      geocode: jest.fn().mockResolvedValue({
        items: [
          {
            address: '1 rue de Rivoli',
            latitude: 48.86,
            longitude: 2.34,
            label: '1 Rue de Rivoli, 75001 Paris, France',
            countryCode: 'FR',
            errorCode: null,
          },
        ],
      }),
      reverseGeocode: jest.fn().mockResolvedValue({
        items: [
          { latitude: 48.86, longitude: 2.34, label: null, countryCode: null, errorCode: 'geo_position_not_found' },
        ],
      }),
      staticMap: jest.fn().mockResolvedValue({ image: Buffer.from([0xff, 0xd8, 0xff]), contentType: 'image/jpeg' }),
    };
    app = await setupRouteAppForTest(GeoController, { geoService: service, geocodingService: geocoding }, JANE);
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

  describe('the geocoding', () => {
    /** Headers of an org-scoped call: the hourly limit is the Organization's. */
    const HEADERS: Record<string, string> = { 'x-organization-id': IDS.organization };

    it('should say whether geocoding works here, without naming an Organization', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/geo/status' });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ geocoding: true });
    });

    it('should geocode addresses for the Organization, in French by default', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/geo/geocode',
        headers: HEADERS,
        payload: { addresses: [' 1 rue de Rivoli '], countries: ['FR'] },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).items[0]).toMatchObject({ countryCode: 'FR', errorCode: null });
      expect(geocoding.geocode).toHaveBeenCalledWith(JANE, IDS.organization, {
        addresses: ['1 rue de Rivoli'],
        countries: ['FR'],
        language: 'fr',
      });
    });

    it('should reverse geocode positions, a position found nowhere answering its own code', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/geo/reverse-geocode',
        headers: HEADERS,
        payload: { points: [{ latitude: 48.86, longitude: 2.34 }], language: 'en' },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).items[0].errorCode).toBe('geo_position_not_found');
      expect(geocoding.reverseGeocode).toHaveBeenCalledWith(JANE, IDS.organization, {
        points: [{ latitude: 48.86, longitude: 2.34 }],
        language: 'en',
      });
    });

    it('should answer the image of a map of circles', async (): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/geo/map',
        headers: HEADERS,
        payload: { circles: [{ latitude: 48.86, longitude: 2.34, radiusKm: 5 }] },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/jpeg');
      expect(response.rawPayload).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      expect(geocoding.staticMap).toHaveBeenCalledWith(JANE, IDS.organization, {
        circles: [{ latitude: 48.86, longitude: 2.34, radiusKm: 5 }],
        width: 640,
        height: 400,
        language: 'fr',
      });
    });

    it('should answer the error of the service, as it is', async (): Promise<void> => {
      geocoding.geocode.mockRejectedValue(
        httpError(503, 'Geocoding and maps are not available', { code: 'geo_service_unavailable' })
      );

      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/geo/geocode',
        headers: HEADERS,
        payload: { addresses: ['Paris'] },
      });

      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.body)).toMatchObject({ code: 'geo_service_unavailable' });
    });

    it('should refuse a geocoding without its Organization, or with a field it does not declare', async (): Promise<void> => {
      const anonymous: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/geo/geocode',
        payload: { addresses: ['Paris'] },
      });
      const extra: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/geo/map',
        headers: HEADERS,
        payload: { circles: [{ latitude: 48.86, longitude: 2.34, radiusKm: 5, countryCode: 'FR' }] },
      });

      expect(anonymous.statusCode).toBe(400);
      expect(extra.statusCode).toBe(400);
      expect(geocoding.geocode).not.toHaveBeenCalled();
      expect(geocoding.staticMap).not.toHaveBeenCalled();
    });
  });
});
