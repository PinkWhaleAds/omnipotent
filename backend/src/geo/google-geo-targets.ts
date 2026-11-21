/**
 * @module geo/google-geo-targets
 *
 * Google's catalog of places (`geotargets-<date>.csv`, https://developers.google.com/google-ads/api/data/geotargets),
 * the referential of the places a TargetingGroup targets and the pivot of every platform (D57): where
 * to download it, how to read it, and which of its places are offered at which level. Transcribed from
 * multi-search (`src/geo/google-geo-targets.ts`, our code).
 *
 * ## Levels
 *
 * Google gives every place a target type, whose meaning varies by country (« State » is a first-level
 * division in the United States, « District » a county in Germany and a city quarter in China). Four
 * levels are offered; each type maps to one of them, or to none — the place is kept, for its children's
 * parent names, but never offered:
 *
 * | Level         | Google target types                                                                        |
 * | ------------- | ------------------------------------------------------------------------------------------ |
 * | `country`     | Country (targeted through the `country` dimension, never as a place)                       |
 * | `region`      | Region, State, Province, Territory, Autonomous Community, Prefecture, Governorate, Union Territory; Canton in Switzerland |
 * | `department`  | Department, County; Canton elsewhere (Costa Rica, Luxembourg, Bosnia…)                     |
 * | `city`        | City, Municipality, District, Borough, Post town, Commune                                  |
 * | `postal_code` | Postal Code                                                                                |
 * | none          | Neighborhood, Sub District, Ward, Quarter, Airport, TV Region, and any new type            |
 *
 * France first, as multi-search read it in the catalog of 2026-08-12:
 * - its regions are `Region`s, the current ones and the older ones, both still targetable; its
 *   departments are `Department`s, and two arrondissements are typed so too. Overseas departments have
 *   their own country code (GP, MQ, GF, RE, YT) and are a `Region` there;
 * - `City` holds the communes; `Municipality` is mostly the arrondissements of the departments,
 *   `District` the arrondissements of Paris, Lyon and Marseille, merged communes and cantons, `Canton`
 *   the electoral cantons. In France and its overseas departments, a place named « Canton … » or
 *   « Arrondissement … » and every `Canton` are not offered: they are administrative or electoral
 *   divisions nobody targets. The arrondissements of Paris, Lyon and Marseille are offered as cities;
 * - `Neighborhood` is not offered: too small to be useful, and the postal codes cover the same need;
 * - a type that is a city in one country and a county in another (`District`) is offered as a city:
 *   most of its places are towns or city quarters.
 *
 * ## Search text
 *
 * The name, then {@link SEARCH_TEXT_SEPARATOR}, then the full name, lower-cased, without accents and
 * punctuation (« Saint-Étienne » and « saint etienne » match), searched with a trigram index; the
 * separator lets the search rank a match in the place's own name before a match in the names of its
 * parents. Google writes names in English: the French names of the French regions whose English name
 * differs (« Bretagne » for « Brittany ») are added to both parts, so a French user finds them, and the
 * places in them, too.
 */
import type { GeoLocationEntity } from '@src/database/entities/geo-location.entity';
import type { GeoLevel } from '@src/types/geo.types';

/** Level of a place of the catalog: one a TargetingGroup targets, or a country. */
export type GeoLocationLevel = GeoLevel | 'country';

/** A place of the catalog, as kept in `geo_locations`. */
export type GeoTargetRow = Pick<
  GeoLocationEntity,
  'id' | 'name' | 'canonicalName' | 'searchText' | 'parentId' | 'countryCode' | 'targetType' | 'level' | 'status'
>;

/** Columns of the catalog. */
export const GOOGLE_GEO_TARGET_COLUMNS: readonly string[] = [
  'Criteria ID',
  'Name',
  'Canonical Name',
  'Parent ID',
  'Country Code',
  'Target Type',
  'Status',
];

/** Status of a place Google offers; the other one is `Removal Planned`. */
export const ACTIVE_STATUS = 'Active';

/** Status of a place Google plans to remove, given too to a place missing from a newer catalog. */
export const REMOVAL_PLANNED_STATUS = 'Removal Planned';

/** Level of each Google target type, by lower-cased type (Google writes a few types in lower case too). */
const TARGET_TYPE_LEVELS: ReadonlyMap<string, GeoLocationLevel> = new Map<string, GeoLocationLevel>([
  ['country', 'country'],
  ['region', 'region'],
  ['state', 'region'],
  ['province', 'region'],
  ['territory', 'region'],
  ['autonomous community', 'region'],
  ['prefecture', 'region'],
  ['governorate', 'region'],
  ['union territory', 'region'],
  ['department', 'department'],
  ['county', 'department'],
  ['canton', 'department'],
  ['city', 'city'],
  ['municipality', 'city'],
  ['district', 'city'],
  ['borough', 'city'],
  ['post town', 'city'],
  ['commune', 'city'],
  ['postal code', 'postal_code'],
]);

/** France and its overseas departments and collectivities, which Google gives their own country codes. */
const FRANCE: ReadonlySet<string> = new Set(['FR', 'GP', 'MQ', 'GF', 'RE', 'YT', 'PM', 'BL', 'MF', 'NC', 'PF', 'WF']);

/** French administrative and electoral divisions nobody targets, by the start of their name. */
const FRENCH_DIVISION_NAME = /^(canton|arrondissement)\b/i;

/** French names of the French places whose English name differs, added to the search text. */
const FRENCH_NAMES: ReadonlyMap<string, string> = new Map([
  ['Brittany', 'Bretagne'],
  ['Burgundy', 'Bourgogne'],
  ['Corsica', 'Corse'],
  ['French Guiana', 'Guyane'],
  ['Lower Normandy', 'Basse-Normandie'],
  ['Normandy', 'Normandie'],
  ['Picardy', 'Picardie'],
  ['Upper Normandy', 'Haute-Normandie'],
]);

/** Between the name and the full name in a search text; normalized texts never hold it. */
export const SEARCH_TEXT_SEPARATOR = ' | ';

/** Longest text of each column, as `geo_locations` keeps it. */
const MAX_LENGTHS = { name: 255, canonicalName: 500, searchText: 800, targetType: 40, status: 20 } as const;

/**
 * The level a place is offered at.
 *
 * @param targetType - Google's target type
 * @param countryCode - ISO 3166-1 alpha-2 country of the place
 * @param name - Name of the place
 * @returns Its level, `country` for a country, `null` when it is not offered
 *
 * @example
 * ```typescript
 * levelOf('District', 'FR', '15th arrondissement'); // 'city'
 * levelOf('District', 'FR', 'Canton of Lille-1'); // null
 * ```
 */
export function levelOf(targetType: string, countryCode: string | null, name: string): GeoLocationLevel | null {
  const type: string = targetType.toLowerCase();
  const french: boolean = countryCode !== null && FRANCE.has(countryCode);
  if (type === 'canton') {
    if (french) return null;
    return countryCode === 'CH' ? 'region' : 'department';
  }
  if (french && FRENCH_DIVISION_NAME.test(name)) return null;
  return TARGET_TYPE_LEVELS.get(type) ?? null;
}

/**
 * A text as the search compares it: lower case, without accents, every run of characters other than
 * letters and digits turned into one space.
 *
 * @param text - A name, or what a user typed
 * @returns The normalized text
 *
 * @example
 * ```typescript
 * normalizeSearchText('Saint-Étienne, Auvergne'); // 'saint etienne auvergne'
 * ```
 */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * The search text of a place: its name, the separator, its full name; for a French place, each part
 * followed by the French names of its English parts.
 *
 * @param name - Its name
 * @param canonicalName - Its full name (« Rennes,Brittany,France »)
 * @param countryCode - Its country
 * @returns The text the search compares with (« rennes | rennes brittany france bretagne »)
 */
export function searchTextOf(name: string, canonicalName: string, countryCode: string | null): string {
  const french: boolean = countryCode !== null && FRANCE.has(countryCode);
  const withFrenchNames = (text: string): string =>
    normalizeSearchText(
      [
        text,
        ...(french ? text.split(',').map((part: string): string => FRENCH_NAMES.get(part.trim()) ?? '') : []),
      ].join(' ')
    );
  return `${withFrenchNames(name)}${SEARCH_TEXT_SEPARATOR}${withFrenchNames(canonicalName)}`.slice(
    0,
    MAX_LENGTHS.searchText
  );
}

/**
 * A place of the catalog from one of its lines.
 *
 * @param record - The line, by column ({@link GOOGLE_GEO_TARGET_COLUMNS})
 * @returns The place, or `null` for a line that does not fit `geo_locations` (no id, a text too long)
 */
export function parseGoogleGeoTarget(record: Record<string, string>): GeoTargetRow | null {
  const id: string = record['Criteria ID'];
  const name: string = record.Name;
  const canonicalName: string = record['Canonical Name'] || name;
  const parentId: string = record['Parent ID'];
  const countryCode: string | null = /^[A-Z]{2}$/.test(record['Country Code']) ? record['Country Code'] : null;
  const targetType: string = record['Target Type'];
  const status: string = record.Status;
  if (
    !/^\d{1,12}$/.test(id) ||
    !/^(\d{1,12})?$/.test(parentId) ||
    !name ||
    !targetType ||
    !status ||
    name.length > MAX_LENGTHS.name ||
    canonicalName.length > MAX_LENGTHS.canonicalName ||
    targetType.length > MAX_LENGTHS.targetType ||
    status.length > MAX_LENGTHS.status
  ) {
    return null;
  }
  return {
    id,
    name,
    canonicalName,
    searchText: searchTextOf(name, canonicalName, countryCode),
    parentId: parentId || null,
    countryCode,
    targetType,
    level: levelOf(targetType, countryCode, name),
    status,
  };
}

/**
 * Whether a URL is a file of the catalog rather than the page listing them.
 *
 * @param url - The configured URL
 * @returns `true` for a `.csv` or `.zip` path
 */
export function isGeoTargetsFile(url: string): boolean {
  return /\.(csv|zip)$/i.test(new URL(url).pathname);
}

/**
 * The latest version of the catalog linked from Google's page: links to
 * `geotargets-<YYYY-MM-DD>.csv(.zip)` on the page's own site.
 *
 * @param page - HTML of the page
 * @param pageUrl - URL of the page, to resolve relative links
 * @returns The URL of the most recent file, or `null` when the page links none
 */
export function latestGeoTargetsUrl(page: string, pageUrl: string): string | null {
  const base: URL = new URL(pageUrl);
  let latest: { date: string; url: string } | null = null;
  for (const match of page.matchAll(/href="([^"]*geotargets-(\d{4}-\d{2}-\d{2})\.csv(?:\.zip)?)"/g)) {
    const url: URL = new URL(match[1], base);
    if (url.origin === base.origin && (latest === null || match[2] > latest.date)) {
      latest = { date: match[2], url: url.href };
    }
  }
  return latest?.url ?? null;
}

/** Downloads a configured URL (never one a client sent). */
export type GeoFileFetcher = (url: string) => Promise<Buffer>;

/**
 * Download the catalog: the configured file, or the latest one Google's page links.
 *
 * @param url - The configured URL (`Geo.googleTargetsUrl`)
 * @param fetch - Downloads a URL
 * @returns The URL of the file read and its content, as downloaded (maybe zipped)
 * @throws Error when the page links no file
 */
export async function downloadGeoTargets(
  url: string,
  fetch: GeoFileFetcher
): Promise<{ url: string; content: Buffer }> {
  if (isGeoTargetsFile(url)) return { url, content: await fetch(url) };
  const fileUrl: string | null = latestGeoTargetsUrl((await fetch(url)).toString('utf8'), url);
  if (!fileUrl) throw new Error(`No geo targets file is linked from ${url}`);
  return { url: fileUrl, content: await fetch(fileUrl) };
}
