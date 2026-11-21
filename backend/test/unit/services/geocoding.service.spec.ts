import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

const GEO_CONFIG = {
  enabled: false,
  region: 'eu-north-1',
  googleTargetsUrl: 'https://developers.google.com/google-ads/api/data/geotargets',
  hourlyLimitPerOrganization: 1000,
  mapStyle: 'Standard',
};
jest.mock('@configs/geo.config', () => ({
  ...jest.requireActual('@configs/geo.config'),
  geoConfig: GEO_CONFIG,
}));

import Fastify, { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { AmazonLocation, AmazonLocationPlaces, FoundPlace } from '@src/geo/amazon-location';
import { AccessService } from '@src/services/access.service';
import GeocodingServicePlugin, { GEOCODE_CONCURRENCY, GeocodingService } from '@src/services/geocoding.service';
import { httpError } from '@utils';
import { IDS, JANE, NOW } from '@test/unit/mocks/auth.fixtures';
import { closeTestApp } from '@test/utils/fastify-test-app.utils';

/** The Louvre, as Amazon Location finds it. */
const LOUVRE: FoundPlace = {
  latitude: 48.86056,
  longitude: 2.33764,
  label: 'Rue de Rivoli, 75001 Paris, France',
  countryCode: 'FR',
};

/** Amazon refusing our IAM role. */
const ACCESS_DENIED = Object.assign(new Error('User is not authorized'), { name: 'AccessDeniedException' });

describe('Unit::Services::GeocodingService', () => {
  let access: { assertOrganizationRole: jest.Mock };
  let places: { geocode: jest.Mock; reverseGeocode: jest.Mock };
  let maps: { staticMap: jest.Mock };
  let clock: Date;
  let service: GeocodingService;

  /**
   * The service with an hourly limit.
   *
   * @param limit - Requests per Organization and hour
   * @returns The service
   */
  function build(limit = 1000): GeocodingService {
    return new GeocodingService(
      access as unknown as AccessService,
      { places, maps } as unknown as AmazonLocation,
      { hourlyLimitPerOrganization: limit, mapStyle: 'Standard' },
      (): Date => clock
    );
  }

  beforeEach((): void => {
    jest.clearAllMocks();
    clock = NOW;
    access = { assertOrganizationRole: jest.fn().mockResolvedValue({}) };
    places = { geocode: jest.fn().mockResolvedValue(LOUVRE), reverseGeocode: jest.fn().mockResolvedValue(LOUVRE) };
    maps = { staticMap: jest.fn().mockResolvedValue({ image: Buffer.from([0xff, 0xd8]), contentType: 'image/jpeg' }) };
    service = build();
  });

  describe('status', () => {
    it('should offer geocoding with Amazon Location, and not without', (): void => {
      expect(service.status()).toEqual({ geocoding: true });
      expect(
        new GeocodingService(access as unknown as AccessService, null, {
          hourlyLimitPerOrganization: 1000,
          mapStyle: 'Standard',
        }).status()
      ).toEqual({ geocoding: false });
    });
  });

  describe('geocode', () => {
    it('should geocode each address in the countries asked, in order, for any member', async (): Promise<void> => {
      places.geocode.mockImplementation(async ({ address }: { address: string }): Promise<FoundPlace | null> =>
        address === 'nowhere' ? null : LOUVRE
      );

      await expect(
        service.geocode(JANE, IDS.organization, {
          addresses: ['rue de rivoli', 'nowhere'],
          countries: ['FR'],
          language: 'fr',
        })
      ).resolves.toEqual({
        items: [
          { address: 'rue de rivoli', ...LOUVRE, errorCode: null },
          {
            address: 'nowhere',
            latitude: null,
            longitude: null,
            label: null,
            countryCode: null,
            errorCode: 'geo_address_not_found',
          },
        ],
      });

      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
      expect(places.geocode).toHaveBeenCalledWith({ address: 'rue de rivoli', countries: ['FR'], language: 'fr' });
    });

    it(`should keep ${GEOCODE_CONCURRENCY} lookups in flight at most, and the order of the addresses`, async (): Promise<void> => {
      let inFlight = 0;
      let most = 0;
      places.geocode.mockImplementation(async ({ address }: { address: string }): Promise<FoundPlace> => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise<void>((resolve: () => void): NodeJS.Immediate => setImmediate(resolve));
        inFlight -= 1;
        return { ...LOUVRE, label: address };
      });
      const addresses: string[] = Array.from({ length: 12 }, (_: unknown, index: number): string => `address ${index}`);

      const result = await service.geocode(JANE, IDS.organization, { addresses, language: 'en' });

      expect(result.items.map((item) => item.label)).toEqual(addresses);
      expect(most).toBe(GEOCODE_CONCURRENCY);
    });

    it('should trim the addresses, and find nothing for a blank one without asking Amazon', async (): Promise<void> => {
      const result = await service.geocode(JANE, IDS.organization, { addresses: ['  Paris ', '   '], language: 'fr' });

      expect(result.items).toEqual([
        { address: 'Paris', ...LOUVRE, errorCode: null },
        {
          address: '',
          latitude: null,
          longitude: null,
          label: null,
          countryCode: null,
          errorCode: 'geo_address_not_found',
        },
      ]);
      expect(places.geocode).toHaveBeenCalledTimes(1);
      expect(places.geocode).toHaveBeenCalledWith({ address: 'Paris', countries: undefined, language: 'fr' });
    });

    it('should report a lookup Amazon failed on as its error, and log it', async (): Promise<void> => {
      const throttled = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
      places.geocode.mockRejectedValueOnce(throttled);

      const result = await service.geocode(JANE, IDS.organization, { addresses: ['a', 'b'], language: 'fr' });

      expect(result.items.map((item) => item.errorCode)).toEqual(['geo_lookup_failed', null]);
      expect(loggerMock.warn).toHaveBeenCalledWith('An Amazon Location lookup failed', { error: throttled });
    });

    it('should answer 503 when Amazon refuses our access', async (): Promise<void> => {
      places.geocode.mockRejectedValue(ACCESS_DENIED);

      await expect(service.geocode(JANE, IDS.organization, { addresses: ['a'], language: 'fr' })).rejects.toMatchObject(
        {
          statusCode: 503,
          errorCode: 'geo_service_unavailable',
          cause: ACCESS_DENIED,
        }
      );
    });

    it('should answer 503 without Amazon Location', async (): Promise<void> => {
      service = new GeocodingService(access as unknown as AccessService, null, {
        hourlyLimitPerOrganization: 1000,
        mapStyle: 'Standard',
      });

      await expect(service.geocode(JANE, IDS.organization, { addresses: ['a'], language: 'fr' })).rejects.toMatchObject(
        {
          statusCode: 503,
          errorCode: 'geo_service_unavailable',
          message: 'Geocoding and maps are not available: enter the coordinates by hand',
        }
      );
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
    });

    it('should answer the 404 of an Organization the caller cannot see before anything else', async (): Promise<void> => {
      access.assertOrganizationRole.mockRejectedValue(
        httpError(404, 'Organization not found', { code: 'organization_not_found' })
      );

      await expect(service.geocode(JANE, IDS.organization, { addresses: ['a'], language: 'fr' })).rejects.toMatchObject(
        {
          statusCode: 404,
        }
      );
      expect(places.geocode).not.toHaveBeenCalled();
    });
  });

  describe('reverseGeocode', () => {
    it('should find the address and country of each position, in order', async (): Promise<void> => {
      places.reverseGeocode.mockResolvedValueOnce(LOUVRE).mockResolvedValueOnce(null);

      await expect(
        service.reverseGeocode(JANE, IDS.organization, {
          points: [
            { latitude: 48.86, longitude: 2.34 },
            { latitude: 40, longitude: -30 },
          ],
          language: 'en',
        })
      ).resolves.toEqual({
        items: [
          { latitude: 48.86, longitude: 2.34, label: LOUVRE.label, countryCode: 'FR', errorCode: null },
          { latitude: 40, longitude: -30, label: null, countryCode: null, errorCode: 'geo_position_not_found' },
        ],
      });
      expect(places.reverseGeocode).toHaveBeenCalledWith({ latitude: 48.86, longitude: 2.34, language: 'en' });
    });
  });

  describe('hourly limit', () => {
    it('should count addresses, positions and maps per Organization and clock hour', async (): Promise<void> => {
      service = build(3);
      await service.geocode(JANE, IDS.organization, { addresses: ['a', 'b'], language: 'fr' });
      await service.staticMap(JANE, IDS.organization, {
        circles: [{ latitude: 48.86, longitude: 2.34, radiusKm: 5 }],
        width: 640,
        height: 400,
        language: 'fr',
      });

      await expect(
        service.reverseGeocode(JANE, IDS.organization, { points: [{ latitude: 1, longitude: 2 }], language: 'fr' })
      ).rejects.toMatchObject({
        statusCode: 429,
        errorCode: 'geo_hourly_limit_reached',
        errorParams: { limit: 3 },
        message: 'The Organization asked for 3 addresses, positions or maps this hour',
      });
      await expect(
        service.geocode(JANE, IDS.otherOrganization, { addresses: ['a', 'b', 'c'], language: 'fr' })
      ).resolves.toMatchObject({ items: expect.any(Array) });

      clock = new Date(NOW.getTime() + 3_600_000);
      await expect(
        service.geocode(JANE, IDS.organization, { addresses: ['a', 'b', 'c'], language: 'fr' })
      ).resolves.toMatchObject({ items: expect.any(Array) });
    });

    it('should count with the real clock by default', async (): Promise<void> => {
      service = new GeocodingService(
        access as unknown as AccessService,
        { places, maps } as unknown as AmazonLocation,
        { hourlyLimitPerOrganization: 1, mapStyle: 'Satellite' }
      );

      await expect(
        service.geocode(JANE, IDS.organization, { addresses: ['a'], language: 'fr' })
      ).resolves.toMatchObject({ items: [{ address: 'a', errorCode: null }] });
      expect((service as unknown as { usage: Map<string, object> }).usage.get(IDS.organization)).toEqual({
        hour: expect.any(Number),
        count: 1,
      });
    });

    it('should refuse a call that alone exceeds the limit, without counting it', async (): Promise<void> => {
      service = build(2);

      await expect(
        service.geocode(JANE, IDS.organization, { addresses: ['a', 'b', 'c'], language: 'fr' })
      ).rejects.toMatchObject({ statusCode: 429 });
      await expect(
        service.geocode(JANE, IDS.organization, { addresses: ['a', 'b'], language: 'fr' })
      ).resolves.toMatchObject({ items: expect.any(Array) });
      expect(places.geocode).toHaveBeenCalledTimes(2);
    });
  });

  describe('staticMap', () => {
    it('should draw the circles framed on them, in the configured style', async (): Promise<void> => {
      await expect(
        service.staticMap(JANE, IDS.organization, {
          circles: [{ latitude: 48.86, longitude: 2.34, radiusKm: 5 }],
          width: 800,
          height: 600,
          language: 'en',
        })
      ).resolves.toEqual({ image: Buffer.from([0xff, 0xd8]), contentType: 'image/jpeg' });

      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
      expect(maps.staticMap).toHaveBeenCalledWith({
        boundingBox: expect.stringMatching(/^2\.\d+,48\.\d+,2\.\d+,48\.\d+$/),
        overlay: expect.stringContaining('"MultiPolygon"'),
        width: 800,
        height: 600,
        language: 'en',
        style: 'Standard',
      });
    });

    it('should answer 503 when Amazon refuses our access', async (): Promise<void> => {
      maps.staticMap.mockRejectedValue(ACCESS_DENIED);

      await expect(
        service.staticMap(JANE, IDS.organization, {
          circles: [{ latitude: 48.86, longitude: 2.34, radiusKm: 5 }],
          width: 640,
          height: 400,
          language: 'fr',
        })
      ).rejects.toMatchObject({ statusCode: 503, errorCode: 'geo_service_unavailable' });
    });

    it('should answer 502 when Amazon fails to draw the map', async (): Promise<void> => {
      const failure = Object.assign(new Error('Internal'), { name: 'InternalServerException' });
      maps.staticMap.mockRejectedValue(failure);

      await expect(
        service.staticMap(JANE, IDS.organization, {
          circles: [{ latitude: 48.86, longitude: 2.34, radiusKm: 5 }],
          width: 640,
          height: 400,
          language: 'fr',
        })
      ).rejects.toMatchObject({
        statusCode: 502,
        errorCode: 'geo_map_failed',
        message: 'Amazon Location could not draw the map',
        cause: failure,
      });
    });
  });

  describe('plugin', () => {
    let app: FastifyInstance;

    /**
     * An app with the plugin and a stand-in access service.
     *
     * @returns The app, ready
     */
    async function buildApp(): Promise<FastifyInstance> {
      const instance: FastifyInstance = Fastify();
      await instance.register(
        fastifyPlugin(
          async (target: FastifyInstance): Promise<void> => {
            target.decorate('accessService', access as unknown as AccessService);
          },
          { name: 'AccessServicePlugin' }
        )
      );
      await instance.register(GeocodingServicePlugin);
      await instance.ready();
      return instance;
    }

    afterEach(async (): Promise<void> => {
      GEO_CONFIG.enabled = false;
      await closeTestApp(app);
    });

    it('should decorate the instance with a service without Amazon Location by default', async (): Promise<void> => {
      app = await buildApp();

      expect(app.geocodingService).toBeInstanceOf(GeocodingService);
      await expect(
        app.geocodingService.geocode(JANE, IDS.organization, { addresses: ['a'], language: 'fr' })
      ).rejects.toMatchObject({ statusCode: 503 });
    });

    it('should use Amazon Location of the configured region when enabled', async (): Promise<void> => {
      GEO_CONFIG.enabled = true;

      app = await buildApp();

      const location: AmazonLocation = (app.geocodingService as unknown as { location: AmazonLocation }).location;
      expect(location.places).toBeInstanceOf(AmazonLocationPlaces);
      expect((app.geocodingService as unknown as { settings: object }).settings).toEqual({
        hourlyLimitPerOrganization: 1000,
        mapStyle: 'Standard',
      });
    });
  });
});
