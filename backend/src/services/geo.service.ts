import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource, In } from 'typeorm';

import { GeoLocationEntity } from '@src/database/entities';
import { ACTIVE_STATUS, normalizeSearchText, SEARCH_TEXT_SEPARATOR } from '@src/geo/google-geo-targets';
import { GEO_SEARCH_MIN_LENGTH, geoLevelSchema } from '@src/types';
import type { GeoLevel, GeoLocation, GeoLocationList, GeoLocationSearchQuery } from '@src/types';
import { escapeLike, httpError } from '@utils';

/** Levels a TargetingGroup targets places at. */
const OFFERED_LEVELS: readonly GeoLevel[] = geoLevelSchema.options;

/** Columns of a place as the reads below select them, with the name of its parent. */
const PLACE_COLUMNS = `g."id", g."level", g."name", g."canonical_name" AS "canonicalName",
  g."country_code" AS "countryCode", g."target_type" AS "targetType", g."status", p."name" AS "parentName"`;

/** The normalized name of a place: its search text up to the separator. */
const NAME_TEXT = `split_part(g."search_text", '${SEARCH_TEXT_SEPARATOR}', 1)`;

/** Most words of a search matched one by one (the rest of a longer text only counts in the fuzzy match). */
const MAX_SEARCH_WORDS = 8;

/**
 * Search of places: every word of the text somewhere in the name or the full name
 * (« rennes bretagne »), or the text close to a word of them (a typo); the GIN index
 * `IDX_geo_locations_search_trgm` serves both the substrings and the trigram word similarity. Ranked
 * by the place's own name: equal to the text, then starting with it, then with a word starting with
 * it, then the closest; among equals, the larger first (regions, departments, cities, postal codes: the
 * reach of a place is not in the catalog), then shorter names. A place found only through the names of
 * its parents (a city of « Bretagne ») comes after the places so named.
 *
 * Parameters: `$1` the normalized text, `$2` `text%`, `$3` `% text%`, `$4` levels, `$5` countries
 * (`NULL` for all), `$6` the limit, then `%word%` for each word.
 *
 * @param words - Number of words matched one by one (1 to {@link MAX_SEARCH_WORDS})
 * @returns The SQL
 */
function searchSql(words: number): string {
  const substrings: string = Array.from(
    { length: words },
    (_: unknown, index: number): string => `g."search_text" LIKE $${index + 7}`
  ).join(' AND ');
  return `SELECT ${PLACE_COLUMNS}
FROM "geo_locations" g
LEFT JOIN "geo_locations" p ON p."id" = g."parent_id"
WHERE g."status" = '${ACTIVE_STATUS}'
  AND g."level" = ANY($4::varchar[])
  AND g."country_code" IS NOT NULL
  AND ($5::bpchar[] IS NULL OR g."country_code" = ANY($5::bpchar[]))
  AND ((${substrings}) OR $1 <% g."search_text")
ORDER BY (${NAME_TEXT} = $1) DESC,
  (${NAME_TEXT} LIKE $2) DESC,
  ((' ' || ${NAME_TEXT}) LIKE $3) DESC,
  word_similarity($1, ${NAME_TEXT}) DESC,
  array_position(ARRAY['region', 'department', 'city', 'postal_code']::varchar[], g."level"),
  length(g."name"),
  g."name",
  g."id"
LIMIT $6`;
}

/** Places by id, offered levels only, in the order of the ids. `$1` the ids, `$2` the levels. */
const BY_IDS_SQL = `SELECT ${PLACE_COLUMNS}
FROM "geo_locations" g
LEFT JOIN "geo_locations" p ON p."id" = g."parent_id"
WHERE g."id" = ANY($1::varchar[])
  AND g."level" = ANY($2::varchar[])
  AND g."country_code" IS NOT NULL
ORDER BY array_position($1::varchar[], g."id")`;

/** A place as {@link searchSql} and {@link BY_IDS_SQL} select it. */
type PlaceRow = {
  id: string;
  level: GeoLevel;
  name: string;
  canonicalName: string;
  countryCode: string;
  targetType: string;
  status: string;
  parentName: string | null;
};

/**
 * A place as the API returns it.
 *
 * @param row - The place read
 * @returns The place
 */
function toGeoLocation(row: PlaceRow): GeoLocation {
  return {
    id: row.id,
    level: row.level,
    name: row.name,
    canonicalName: row.canonicalName,
    countryCode: row.countryCode,
    targetType: row.targetType,
    parentName: row.parentName ?? null,
    active: row.status === ACTIVE_STATUS,
  };
}

/**
 * The referential of places: Google's catalog, the pivot of every platform (D57,
 * `docs/phase-10.md` § 8.9). Transcribed from multi-search (`src/services/geo.service.ts`).
 *
 * It belongs to no Organization, so reading it needs no role beyond being authenticated: the same
 * places are offered to everyone, as Google offers them.
 */
export class GeoService {
  /**
   * Create the service.
   *
   * @param dataSource - Application database
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Search the places a TargetingGroup can target by name: active places of the four levels (or those
   * asked), in the countries asked, whose name or full name holds every word of the text, or comes
   * close to it. Case, accents and punctuation are ignored.
   *
   * @param query - Text, countries, levels and limit
   * @returns The places found, best first
   * @throws Error with status 400 coded `geo_search_too_short` when the text has fewer than
   *   {@link GEO_SEARCH_MIN_LENGTH} letters or digits
   *
   * @example
   * ```typescript
   * await geoService.search({ q: 'Saint-Étienne', countries: ['FR'], levels: ['city'], limit: 20 });
   * ```
   */
  public async search(query: GeoLocationSearchQuery): Promise<GeoLocationList> {
    const text: string = normalizeSearchText(query.q);
    if (text.length < GEO_SEARCH_MIN_LENGTH) {
      throw httpError(400, `Search places with ${GEO_SEARCH_MIN_LENGTH} letters or digits at least`, {
        code: 'geo_search_too_short',
        params: { min: GEO_SEARCH_MIN_LENGTH },
      });
    }
    const escaped: string = escapeLike(text);
    const words: string[] = [...new Set(escaped.split(' '))].slice(0, MAX_SEARCH_WORDS);
    const rows: PlaceRow[] = await this.dataSource.query(searchSql(words.length), [
      text,
      `${escaped}%`,
      `% ${escaped}%`,
      query.levels ?? OFFERED_LEVELS,
      query.countries ?? null,
      query.limit,
      ...words.map((word: string): string => `%${word}%`),
    ]);
    return { items: rows.map(toGeoLocation) };
  }

  /**
   * Places a TargetingGroup can target, by id, whatever their status (`active` tells whether Google
   * still offers them). Unknown ids, countries and places of a level not offered are absent.
   *
   * @param ids - Ids of the referential
   * @returns The places, in the order of the ids
   */
  public async byIds(ids: readonly string[]): Promise<GeoLocationList> {
    const unique: string[] = [...new Set(ids)];
    if (unique.length === 0) return { items: [] };
    const rows: PlaceRow[] = await this.dataSource.query(BY_IDS_SQL, [unique, OFFERED_LEVELS]);
    return { items: rows.map(toGeoLocation) };
  }

  /**
   * Places of the referential, by id, whatever their level and status.
   *
   * @param ids - Ids of the referential
   * @returns The places found, by id (unknown ids are absent)
   */
  public async findByIds(ids: readonly string[]): Promise<Map<string, GeoLocationEntity>> {
    const unique: string[] = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows: GeoLocationEntity[] = await this.dataSource.getRepository(GeoLocationEntity).findBy({ id: In(unique) });
    return new Map(rows.map((row: GeoLocationEntity): [string, GeoLocationEntity] => [row.id, row]));
  }
}

/**
 * Fastify plugin that decorates the instance with a {@link GeoService}.
 *
 * Depends on `DatabasePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 * @returns A promise that resolves once decorated
 */
async function geoServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('geoService', new GeoService(fastify.db));
}

export default fastifyPlugin(geoServicePlugin, {
  name: 'GeoServicePlugin',
  dependencies: ['DatabasePlugin'],
});
