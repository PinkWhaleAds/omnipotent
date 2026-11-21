/**
 * @module geo/amazon-location
 *
 * Amazon Location Service (v2: Places and Maps), called with the AWS credentials of the process (the task's
 * IAM role on AWS; no API key). The services talk to {@link GeoPlaces} and {@link GeoMaps}, so that tests never
 * reach AWS.
 *
 * Results are kept — the circles of a TargetingGroup keep their coordinates and address —, so every
 * Places request says `IntendedUse: Storage`, as Amazon's terms require for stored results (the Stored
 * price applies). Transcribed from multi-search (`src/geo/amazon-location.ts`).
 */
import { GeoMapsClient, GetStaticMapCommand, GetStaticMapCommandOutput } from '@aws-sdk/client-geo-maps';
import {
  GeocodeCommand,
  GeocodeCommandOutput,
  GeocodeResultItem,
  GeoPlacesClient,
  ReverseGeocodeCommand,
  ReverseGeocodeCommandOutput,
  ReverseGeocodeResultItem,
} from '@aws-sdk/client-geo-places';

import type { GeoMapStyle } from '@configs/geo.config';
import { toAlpha2 } from './country-codes';

/**
 * A place found by a geocoding.
 *
 * @property latitude - WGS 84 degrees
 * @property longitude - WGS 84 degrees
 * @property label - Its address, written in full
 * @property countryCode - ISO 3166-1 alpha-2 country
 */
export type FoundPlace = { latitude: number; longitude: number; label: string; countryCode: string };

/** Geocoding of addresses and positions. */
export interface GeoPlaces {
  /**
   * The best place matching an address.
   *
   * @param query - The address, the countries it must be in (all when absent), the language of the label
   * @returns The place, or `null` when none matches
   */
  geocode(query: { address: string; countries?: string[]; language: string }): Promise<FoundPlace | null>;

  /**
   * The address nearest a position.
   *
   * @param query - The position and the language of the label
   * @returns The address, or `null` when none is near
   */
  reverseGeocode(query: { latitude: number; longitude: number; language: string }): Promise<FoundPlace | null>;
}

/**
 * A static map to draw.
 *
 * @property boundingBox - South-west and north-east corners, `lon,lat,lon,lat`
 * @property overlay - GeoJSON feature collection drawn on it
 * @property width - Width in pixels
 * @property height - Height in pixels
 * @property language - Language of the labels
 * @property style - Map style
 */
export type StaticMapRequest = {
  boundingBox: string;
  overlay: string;
  width: number;
  height: number;
  language: string;
  style: GeoMapStyle;
};

/**
 * An image.
 *
 * @property image - Its bytes
 * @property contentType - Its media type (`image/jpeg` for Amazon's static maps)
 */
export type MapImage = { image: Buffer; contentType: string };

/** Static map images. */
export interface GeoMaps {
  /**
   * Draw a static map.
   *
   * @param request - Frame, overlay, size, language and style
   * @returns The image
   */
  staticMap(request: StaticMapRequest): Promise<MapImage>;
}

/** Amazon Location: geocoding and maps. */
export type AmazonLocation = { places: GeoPlaces; maps: GeoMaps };

/** Errors meaning our own access to Amazon Location is refused or missing (never a fault of the request). */
const ACCESS_ERRORS: ReadonlySet<string> = new Set([
  'AccessDeniedException',
  'UnrecognizedClientException',
  'InvalidSignatureException',
  'ExpiredTokenException',
  'CredentialsProviderError',
]);

/**
 * Whether an AWS error means our access to Amazon Location is refused or missing (IAM, credentials).
 *
 * @param error - What a call threw
 * @returns `true` for an access error
 */
export function isAccessError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, $metadata } = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return ACCESS_ERRORS.has(name ?? '') || $metadata?.httpStatusCode === 401 || $metadata?.httpStatusCode === 403;
}

/**
 * A place of an Amazon answer.
 *
 * @param item - The first result item, if any
 * @returns The place, or `null` without position or without a known country
 */
function placeOf(item: GeocodeResultItem | ReverseGeocodeResultItem | undefined): FoundPlace | null {
  const position: number[] | undefined = item?.Position;
  const country = item?.Address?.Country;
  const countryCode: string | null = toAlpha2(country?.Code2 ?? country?.Code3 ?? '');
  if (!item || position?.length !== 2 || countryCode === null) return null;
  return {
    longitude: position[0],
    latitude: position[1],
    label: item.Address?.Label ?? item.Title ?? '',
    countryCode,
  };
}

/** {@link GeoPlaces} on Amazon Location Places v2. */
export class AmazonLocationPlaces implements GeoPlaces {
  /**
   * @param client - Places client of the region
   */
  constructor(private readonly client: GeoPlacesClient) {}

  /** @inheritdoc */
  public async geocode(query: { address: string; countries?: string[]; language: string }): Promise<FoundPlace | null> {
    const output: GeocodeCommandOutput = await this.client.send(
      new GeocodeCommand({
        QueryText: query.address,
        MaxResults: 1,
        Language: query.language,
        IntendedUse: 'Storage',
        ...(query.countries ? { Filter: { IncludeCountries: query.countries } } : {}),
      })
    );
    return placeOf(output.ResultItems?.[0]);
  }

  /** @inheritdoc */
  public async reverseGeocode(query: {
    latitude: number;
    longitude: number;
    language: string;
  }): Promise<FoundPlace | null> {
    const output: ReverseGeocodeCommandOutput = await this.client.send(
      new ReverseGeocodeCommand({
        QueryPosition: [query.longitude, query.latitude],
        MaxResults: 1,
        Language: query.language,
        IntendedUse: 'Storage',
      })
    );
    return placeOf(output.ResultItems?.[0]);
  }
}

/** {@link GeoMaps} on Amazon Location Maps v2. */
export class AmazonLocationMaps implements GeoMaps {
  /**
   * @param client - Maps client of the region
   */
  constructor(private readonly client: GeoMapsClient) {}

  /** @inheritdoc */
  public async staticMap(request: StaticMapRequest): Promise<MapImage> {
    const output: GetStaticMapCommandOutput = await this.client.send(
      new GetStaticMapCommand({
        FileName: 'map',
        Width: request.width,
        Height: request.height,
        BoundingBox: request.boundingBox,
        GeoJsonOverlay: request.overlay,
        Style: request.style,
        Language: request.language,
        ScaleBarUnit: 'Kilometers',
      })
    );
    return { image: Buffer.from(output.Blob ?? new Uint8Array()), contentType: output.ContentType ?? 'image/jpeg' };
  }
}

/**
 * Amazon Location of a region, with the default AWS credentials of the process.
 *
 * @param region - AWS region
 * @returns Its geocoding and maps
 */
export function createAmazonLocation(region: string): AmazonLocation {
  return {
    places: new AmazonLocationPlaces(new GeoPlacesClient({ region })),
    maps: new AmazonLocationMaps(new GeoMapsClient({ region })),
  };
}
