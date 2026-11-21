import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { geoConfig, GeoMapStyle } from '@configs/geo.config';
import { AmazonLocation, createAmazonLocation, FoundPlace, isAccessError, MapImage } from '@src/geo/amazon-location';
import { staticMapView, StaticMapView } from '@src/geo/static-map';
import type {
  AuthContext,
  GeocodeBody,
  GeoStatus,
  GeocodeResult,
  GeocodeResultList,
  GeoLookupErrorCode,
  GeoMapBody,
  GeoPosition,
  ReverseGeocodeBody,
  ReverseGeocodeResult,
  ReverseGeocodeResultList,
} from '@src/types';
import { httpError, Logger, LoggerBuilder } from '@utils';
import { AccessService } from './access.service';

/** Amazon Location requests of one call in flight at once. */
export const GEOCODE_CONCURRENCY = 5;

/** One hour, in milliseconds: the window of the per-Organization limit. */
const HOUR_MS = 3_600_000;

/**
 * Settings of the geocoding.
 *
 * @property hourlyLimitPerOrganization - Addresses, positions and maps an Organization may ask for in one clock
 *   hour, in this process
 * @property mapStyle - Style of the static maps
 */
export type GeocodingSettings = { hourlyLimitPerOrganization: number; mapStyle: GeoMapStyle };

/**
 * Run a function on items, a few at a time, keeping their order.
 *
 * @typeParam T - Item type
 * @typeParam R - Result type
 * @param items - The items
 * @param limit - Calls in flight at once
 * @param run - The function
 * @returns The results, in the order of the items
 */
async function mapConcurrently<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index: number = next;
      next += 1;
      results[index] = await run(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Geocoding of addresses and positions, and static maps of circles, by Amazon Location Service
 * (`docs/phase-10.md` § 8.9): what an interface uses to place the circles of a TargetingGroup. Any member
 * of an Organization uses them. Transcribed from multi-search (`src/services/geo-coding.service.ts`).
 *
 * A result only ever becomes a **circle** — never a place of the referential, nor a postal code: its
 * country is the `countryCode` the circle needs (D57).
 *
 * Without Amazon Location (local development, `Geo.enabled` off) every call answers 503
 * `geo_service_unavailable`: a circle is then placed by its coordinates. Each Organization may ask for
 * `Geo.hourlyLimitPerOrganization` addresses, positions and maps per clock hour, counted in memory by
 * each process — a guard of the bill against a loop, not a quota: several API tasks allow that much each
 * (§ 8.9, point 6).
 */
export class GeocodingService {
  /** Logger of the failed lookups. */
  private readonly logger: Logger = LoggerBuilder.getChildLogger('GeocodingService');

  /** Requests of the current hour, by Organization. */
  private readonly usage = new Map<string, { hour: number; count: number }>();

  /**
   * @param access - Permission checks
   * @param location - Amazon Location, `null` when it is not available
   * @param settings - Hourly limit and map style
   * @param now - Clock
   */
  constructor(
    private readonly access: AccessService,
    private readonly location: AmazonLocation | null,
    private readonly settings: GeocodingSettings,
    private readonly now: () => Date = (): Date => new Date()
  ) {}

  /**
   * What the geo services can do here, so the interface offers address search and maps only where they work.
   *
   * @returns Whether geocoding and maps are available
   */
  public status(): GeoStatus {
    return { geocoding: this.location !== null };
  }

  /**
   * Geocode addresses: for each, the best place (in the countries asked), or why there is none. Addresses are
   * trimmed; a blank one finds nothing.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param body - Addresses, countries and language
   * @returns One result per address, in order
   * @throws Error with status 404 for an Organization the caller cannot see, 429 past the hourly limit, 503 when
   *   Amazon Location is not available or refuses our access
   */
  public async geocode(actor: AuthContext, organizationId: string, body: GeocodeBody): Promise<GeocodeResultList> {
    const location: AmazonLocation = await this.authorize(actor, organizationId, body.addresses.length);
    const items: GeocodeResult[] = await mapConcurrently(
      body.addresses,
      GEOCODE_CONCURRENCY,
      async (sent: string): Promise<GeocodeResult> => {
        const address: string = sent.trim();
        const found: FoundPlace | GeoLookupErrorCode = address
          ? await this.lookup(() =>
              location.places.geocode({ address, countries: body.countries, language: body.language })
            )
          : 'geo_address_not_found';
        if (typeof found === 'string') {
          return { address, latitude: null, longitude: null, label: null, countryCode: null, errorCode: found };
        }
        return { address, ...found, errorCode: null };
      }
    );
    return { items };
  }

  /**
   * Reverse geocode positions: for each, the nearest address and its country, or why there is none.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param body - Positions and language
   * @returns One result per position, in order
   * @throws Error with status 404 for an Organization the caller cannot see, 429 past the hourly limit, 503 when
   *   Amazon Location is not available or refuses our access
   */
  public async reverseGeocode(
    actor: AuthContext,
    organizationId: string,
    body: ReverseGeocodeBody
  ): Promise<ReverseGeocodeResultList> {
    const location: AmazonLocation = await this.authorize(actor, organizationId, body.points.length);
    const items: ReverseGeocodeResult[] = await mapConcurrently(
      body.points,
      GEOCODE_CONCURRENCY,
      async (point: GeoPosition): Promise<ReverseGeocodeResult> => {
        const found: FoundPlace | GeoLookupErrorCode = await this.lookup(
          () => location.places.reverseGeocode({ ...point, language: body.language }),
          'geo_position_not_found'
        );
        if (typeof found === 'string') return { ...point, label: null, countryCode: null, errorCode: found };
        return { ...point, label: found.label, countryCode: found.countryCode, errorCode: null };
      }
    );
    return { items };
  }

  /**
   * Draw circles on a static map framed on them.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param body - Circles, size and language
   * @returns The image (Amazon's static maps are JPEG)
   * @throws Error with status 404 for an Organization the caller cannot see, 429 past the hourly limit, 503 when
   *   Amazon Location is not available or refuses our access, 502 when it fails to draw the map
   */
  public async staticMap(actor: AuthContext, organizationId: string, body: GeoMapBody): Promise<MapImage> {
    const location: AmazonLocation = await this.authorize(actor, organizationId, 1);
    const view: StaticMapView = staticMapView(body.circles, body.width, body.height);
    try {
      return await location.maps.staticMap({
        ...view,
        width: body.width,
        height: body.height,
        language: body.language,
        style: this.settings.mapStyle,
      });
    } catch (error: unknown) {
      if (isAccessError(error)) throw this.unavailable(error);
      throw httpError(502, 'Amazon Location could not draw the map', { code: 'geo_map_failed', cause: error });
    }
  }

  /**
   * Check the caller, the availability of Amazon Location and the hourly limit, and count the requests.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param requests - Addresses, positions or maps asked
   * @returns Amazon Location
   * @throws Error with status 404 for an Organization the caller cannot see, 503 without Amazon Location, 429
   *   past the hourly limit
   */
  private async authorize(actor: AuthContext, organizationId: string, requests: number): Promise<AmazonLocation> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    if (!this.location) throw this.unavailable();
    const hour: number = Math.floor(this.now().getTime() / HOUR_MS);
    const used: { hour: number; count: number } = this.usage.get(organizationId) ?? { hour, count: 0 };
    const count: number = used.hour === hour ? used.count : 0;
    const limit: number = this.settings.hourlyLimitPerOrganization;
    if (count + requests > limit) {
      throw httpError(429, `The Organization asked for ${limit} addresses, positions or maps this hour`, {
        code: 'geo_hourly_limit_reached',
        params: { limit },
      });
    }
    for (const [key, entry] of this.usage) if (entry.hour !== hour) this.usage.delete(key);
    this.usage.set(organizationId, { hour, count: count + requests });
    return this.location;
  }

  /**
   * Look one address or position up; a failure of that item becomes its error code, our access refused fails the
   * whole call.
   *
   * @param find - The lookup
   * @param notFound - Code of a lookup that finds nothing
   * @returns The place, or why there is none
   * @throws Error with status 503 when Amazon Location refuses our access
   */
  private async lookup(
    find: () => Promise<FoundPlace | null>,
    notFound: GeoLookupErrorCode = 'geo_address_not_found'
  ): Promise<FoundPlace | GeoLookupErrorCode> {
    try {
      return (await find()) ?? notFound;
    } catch (error: unknown) {
      if (isAccessError(error)) throw this.unavailable(error);
      this.logger.warn('An Amazon Location lookup failed', { error });
      return 'geo_lookup_failed';
    }
  }

  /**
   * The error of an unavailable geocoding.
   *
   * @param cause - What Amazon answered, when it refused our access
   * @returns The error, 503 `geo_service_unavailable`
   */
  private unavailable(cause?: unknown): Error {
    return httpError(503, 'Geocoding and maps are not available: enter the coordinates by hand', {
      code: 'geo_service_unavailable',
      cause,
    });
  }
}

/**
 * Fastify plugin that decorates the instance with a {@link GeocodingService} on Amazon Location of `Geo.region`
 * when `Geo.enabled`, without it otherwise.
 *
 * Depends on `AccessServicePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function geocodingServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate(
    'geocodingService',
    new GeocodingService(fastify.accessService, geoConfig.enabled ? createAmazonLocation(geoConfig.region) : null, {
      hourlyLimitPerOrganization: geoConfig.hourlyLimitPerOrganization,
      mapStyle: geoConfig.mapStyle,
    })
  );
}

export default fastifyPlugin(geocodingServicePlugin, {
  name: 'GeocodingServicePlugin',
  dependencies: ['AccessServicePlugin'],
});
