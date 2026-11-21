import { GeoMapsClient, GetStaticMapCommand } from '@aws-sdk/client-geo-maps';
import { GeocodeCommand, GeoPlacesClient, ReverseGeocodeCommand } from '@aws-sdk/client-geo-places';

import {
  AmazonLocation,
  AmazonLocationMaps,
  AmazonLocationPlaces,
  createAmazonLocation,
  isAccessError,
} from '@src/geo/amazon-location';

/** A result item of Amazon Location Places, at the Louvre. */
const LOUVRE = {
  PlaceType: 'PointAddress',
  Title: 'Rue de Rivoli, 75001 Paris',
  Position: [2.33764, 48.86056],
  Address: { Label: 'Rue de Rivoli, 75001 Paris, France', Country: { Code2: 'FR', Code3: 'FRA', Name: 'France' } },
};

describe('Unit::Geo::AmazonLocation', () => {
  describe('AmazonLocationPlaces', () => {
    let send: jest.Mock;
    let places: AmazonLocationPlaces;

    beforeEach((): void => {
      send = jest.fn().mockResolvedValue({ ResultItems: [LOUVRE] });
      places = new AmazonLocationPlaces({ send } as unknown as GeoPlacesClient);
    });

    it('should geocode an address, for storage, within the countries asked', async (): Promise<void> => {
      await expect(
        places.geocode({ address: 'rue de rivoli paris', countries: ['FR', 'BE'], language: 'fr' })
      ).resolves.toEqual({
        latitude: 48.86056,
        longitude: 2.33764,
        label: 'Rue de Rivoli, 75001 Paris, France',
        countryCode: 'FR',
      });

      const command: GeocodeCommand = send.mock.calls[0][0];
      expect(command).toBeInstanceOf(GeocodeCommand);
      expect(command.input).toEqual({
        QueryText: 'rue de rivoli paris',
        MaxResults: 1,
        Language: 'fr',
        IntendedUse: 'Storage',
        Filter: { IncludeCountries: ['FR', 'BE'] },
      });
    });

    it('should geocode anywhere without countries, and take the alpha-3 code and the title when needed', async (): Promise<void> => {
      send.mockResolvedValue({
        ResultItems: [{ Title: 'Brussels', Position: [4.35, 50.85], Address: { Country: { Code3: 'BEL' } } }],
      });

      await expect(places.geocode({ address: 'Bruxelles', language: 'en' })).resolves.toEqual({
        latitude: 50.85,
        longitude: 4.35,
        label: 'Brussels',
        countryCode: 'BE',
      });
      expect(send.mock.calls[0][0].input.Filter).toBeUndefined();
    });

    it.each([
      ['no result', {}],
      ['an empty list', { ResultItems: [] }],
      ['a result without position', { ResultItems: [{ ...LOUVRE, Position: undefined }] }],
      ['a result without country', { ResultItems: [{ ...LOUVRE, Address: { Label: 'Somewhere' } }] }],
      ['a result of an unknown country', { ResultItems: [{ ...LOUVRE, Address: { Country: { Code3: 'ZZZ' } } }] }],
    ])('should find nothing for %s', async (_label: string, output: object): Promise<void> => {
      send.mockResolvedValue(output);

      await expect(places.geocode({ address: 'nowhere', language: 'fr' })).resolves.toBeNull();
    });

    it('should give an empty label when Amazon gives none', async (): Promise<void> => {
      send.mockResolvedValue({ ResultItems: [{ Position: [1, 2], Address: { Country: { Code2: 'FR' } } }] });

      await expect(places.geocode({ address: 'x', language: 'fr' })).resolves.toMatchObject({ label: '' });
    });

    it('should reverse geocode a position, for storage', async (): Promise<void> => {
      await expect(places.reverseGeocode({ latitude: 48.86, longitude: 2.34, language: 'fr' })).resolves.toEqual({
        latitude: 48.86056,
        longitude: 2.33764,
        label: 'Rue de Rivoli, 75001 Paris, France',
        countryCode: 'FR',
      });

      const command: ReverseGeocodeCommand = send.mock.calls[0][0];
      expect(command).toBeInstanceOf(ReverseGeocodeCommand);
      expect(command.input).toEqual({
        QueryPosition: [2.34, 48.86],
        MaxResults: 1,
        Language: 'fr',
        IntendedUse: 'Storage',
      });
    });

    it('should find no address in the middle of the sea', async (): Promise<void> => {
      send.mockResolvedValue({ ResultItems: [] });

      await expect(places.reverseGeocode({ latitude: 40, longitude: -30, language: 'fr' })).resolves.toBeNull();
    });
  });

  describe('AmazonLocationMaps', () => {
    it('should draw a static map of the overlay, framed on the box', async (): Promise<void> => {
      const send: jest.Mock = jest
        .fn()
        .mockResolvedValue({ Blob: new Uint8Array([0xff, 0xd8]), ContentType: 'image/jpeg', PricingBucket: 'Core' });
      const maps = new AmazonLocationMaps({ send } as unknown as GeoMapsClient);

      await expect(
        maps.staticMap({
          boundingBox: '2,48,3,49',
          overlay: '{"type":"FeatureCollection","features":[]}',
          width: 640,
          height: 400,
          language: 'fr',
          style: 'Standard',
        })
      ).resolves.toEqual({ image: Buffer.from([0xff, 0xd8]), contentType: 'image/jpeg' });

      const command: GetStaticMapCommand = send.mock.calls[0][0];
      expect(command).toBeInstanceOf(GetStaticMapCommand);
      expect(command.input).toEqual({
        FileName: 'map',
        Width: 640,
        Height: 400,
        BoundingBox: '2,48,3,49',
        GeoJsonOverlay: '{"type":"FeatureCollection","features":[]}',
        Style: 'Standard',
        Language: 'fr',
        ScaleBarUnit: 'Kilometers',
      });
    });

    it('should answer an empty JPEG when Amazon sends no image', async (): Promise<void> => {
      const maps = new AmazonLocationMaps({ send: jest.fn().mockResolvedValue({}) } as unknown as GeoMapsClient);

      await expect(
        maps.staticMap({ boundingBox: '', overlay: '', width: 64, height: 64, language: 'en', style: 'Satellite' })
      ).resolves.toEqual({ image: Buffer.alloc(0), contentType: 'image/jpeg' });
    });
  });

  describe('isAccessError', () => {
    it.each([
      ['AccessDeniedException', { name: 'AccessDeniedException' }],
      ['UnrecognizedClientException', { name: 'UnrecognizedClientException' }],
      ['CredentialsProviderError', { name: 'CredentialsProviderError' }],
      ['a 403', { name: 'Unknown', $metadata: { httpStatusCode: 403 } }],
      ['a 401', { $metadata: { httpStatusCode: 401 } }],
    ])('should take %s for our access refused', (_label: string, error: object): void => {
      expect(isAccessError(error)).toBe(true);
    });

    it.each([
      ['a throttling', { name: 'ThrottlingException', $metadata: { httpStatusCode: 429 } }],
      ['a validation error', { name: 'ValidationException', $metadata: {} }],
      ['a plain error', new Error('socket hang up')],
      ['null', null],
      ['a string', 'boom'],
    ])('should not take %s for our access refused', (_label: string, error: unknown): void => {
      expect(isAccessError(error)).toBe(false);
    });
  });

  describe('createAmazonLocation', () => {
    it('should build the Places and Maps clients of the region', async (): Promise<void> => {
      const location: AmazonLocation = createAmazonLocation('eu-north-1');

      expect(location.places).toBeInstanceOf(AmazonLocationPlaces);
      expect(location.maps).toBeInstanceOf(AmazonLocationMaps);
      const client: GeoPlacesClient = (location.places as unknown as { client: GeoPlacesClient }).client;
      await expect(client.config.region()).resolves.toBe('eu-north-1');
    });
  });
});
