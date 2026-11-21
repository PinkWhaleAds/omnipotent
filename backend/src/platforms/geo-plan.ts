/**
 * @module platforms/geo-plan
 *
 * Where a TargetingGroup shows on one platform, country by country (D57, `docs/phase-10.md` § 8.9).
 * Transcribed from multi-search (`src/platforms/geo-plan.ts`, our code), for the dimensions of
 * Omnipotent: `country`, `location` and `proximity`.
 *
 * The countries are the limit of the TargetingGroup. An included country with no place nor circle in it
 * is served whole; one with places or circles is **replaced** by them — unless the platform cannot
 * target one of them, and then the whole country is served instead, never a part of what was asked,
 * which would be narrower. A country is never sent with one of its places: Google adds up its places,
 * so it would serve the whole country. Excluded places are sent where the platform excludes their
 * level, ignored elsewhere. Places and circles outside the included countries are left out, and the
 * preview refuses them.
 *
 * Pure: the preview and the adapters share it.
 */
import type { GeoLevel, GeoPlace, Targeting, TargetingDimension } from '@src/types';

/**
 * The dimensions the plan judges, platform by platform: what a platform cannot do with them widens a
 * country, which the preview says with the country, rather than dropping them as other dimensions are.
 */
export const PLANNED_DIMENSIONS: readonly TargetingDimension[] = ['location', 'proximity'];

/**
 * What a platform targets finer than the country, as its couple declares it in the registry.
 *
 * @property levels - Levels of the places it includes
 * @property excludedLevels - Levels of the places it excludes
 * @property maxRadii - Most circles one of its objects takes, `null` when it takes none
 */
export type GeoRules = {
  levels: readonly GeoLevel[];
  excludedLevels: readonly GeoLevel[];
  maxRadii: number | null;
};

/**
 * A circle of the `proximity` dimension.
 *
 * @property latitude - WGS 84 degrees
 * @property longitude - WGS 84 degrees
 * @property radiusKm - Its radius
 * @property countryCode - The country it replaces; absent only on a circle written before D57
 * @property label - Its name in the interface
 * @property address - The address it was geocoded from
 */
export type GeoRadius = {
  latitude: number;
  longitude: number;
  radiusKm: number;
  countryCode?: string;
  label?: string;
  address?: string;
};

/**
 * Why a platform serves a whole country rather than the places and circles asked in it:
 *
 * - `level`: it cannot target places of the level of one of them
 * - `radius`: it cannot target circles
 */
export type GeoWidenReason = 'level' | 'radius';

/**
 * A country a platform serves whole, instead of the places and circles asked in it.
 *
 * @property country - ISO 3166-1 alpha-2 code
 * @property reasons - Why, each once, sorted
 */
export type GeoWidening = { country: string; reasons: GeoWidenReason[] };

/**
 * The places and circles of a TargetingGroup outside its countries: neither sent nor ignored, they
 * block the launch.
 *
 * @property places - Places, included or excluded, of a country that is not included, or is excluded
 * @property radii - Circles whose country is such a one, or that have none
 */
export type GeoOutside = { places: GeoPlace[]; radii: GeoRadius[] };

/**
 * The geographic targets of a TargetingGroup on one platform, and what the preview reports of them.
 *
 * @property countries - Included countries served whole
 * @property excludedCountries - Excluded countries, each once
 * @property places - Included places, which replace their countries
 * @property excludedPlaces - Excluded places the platform excludes
 * @property radii - Circles, which replace their countries
 * @property widened - Countries served whole instead of their places and circles
 * @property ignoredExclusions - Excluded places the platform cannot exclude
 * @property tooManyRadii - The circles sent and the most the platform takes, when there are more
 * @property outside - Places and circles outside the countries, left out
 */
export type GeoPlan = {
  countries: string[];
  excludedCountries: string[];
  places: GeoPlace[];
  excludedPlaces: GeoPlace[];
  radii: GeoRadius[];
  widened: GeoWidening[];
  ignoredExclusions: GeoPlace[];
  tooManyRadii: { count: number; max: number } | null;
  outside: GeoOutside;
};

/**
 * The geographic dimensions of a targeting, each read as its schema parses it, empty when absent.
 *
 * @param targeting - A node's targeting
 * @returns Its countries, places and circles
 */
function geoOf(targeting: Targeting | null): {
  countries: { include: string[]; exclude: string[] };
  places: { include: GeoPlace[]; exclude: GeoPlace[] };
  radii: GeoRadius[];
} {
  const countries = (targeting?.country ?? {}) as { include?: string[]; exclude?: string[] };
  const places = (targeting?.location ?? {}) as { include?: GeoPlace[]; exclude?: GeoPlace[] };
  const proximity = (targeting?.proximity ?? {}) as { points?: GeoRadius[] };
  return {
    countries: { include: countries.include ?? [], exclude: countries.exclude ?? [] },
    places: { include: places.include ?? [], exclude: places.exclude ?? [] },
    radii: proximity.points ?? [],
  };
}

/**
 * The included countries of a targeting, without the excluded ones, each once.
 *
 * @param targeting - A node's targeting
 * @returns ISO 3166-1 alpha-2 codes, in the TargetingGroup's order
 */
function insideCountries(targeting: Targeting | null): string[] {
  const { include, exclude } = geoOf(targeting).countries;
  return [...new Set(include)].filter((country: string): boolean => !exclude.includes(country));
}

/**
 * The places and circles of a targeting outside its countries — included and not excluded.
 *
 * @param targeting - A node's targeting
 * @returns The places, included or excluded, and the circles left out
 *
 * @example
 * ```typescript
 * outsideCountries(targeting).places.map((place: GeoPlace) => place.name);
 * // ['Brussels'] for a TargetingGroup targeting France with Brussels
 * ```
 */
export function outsideCountries(targeting: Targeting | null): GeoOutside {
  const inside = new Set<string>(insideCountries(targeting));
  const geo = geoOf(targeting);
  const isOutside = (countryCode: string | undefined): boolean => countryCode === undefined || !inside.has(countryCode);
  return {
    places: [...geo.places.include, ...geo.places.exclude].filter((place: GeoPlace): boolean =>
      isOutside(place.countryCode)
    ),
    radii: geo.radii.filter((radius: GeoRadius): boolean => isOutside(radius.countryCode)),
  };
}

/**
 * Plan where a TargetingGroup shows on one platform.
 *
 * @param targeting - Its targeting, its places filled from the referential
 * @param rules - What the platform targets finer than the country
 * @returns The targets, and the facts the preview reports
 *
 * @example
 * ```typescript
 * // France and Belgium, with Paris: Paris and the whole of Belgium.
 * planGeo(targeting, rulesOf('google_ads', 'search').geo);
 * ```
 */
export function planGeo(targeting: Targeting | null, rules: GeoRules): GeoPlan {
  const geo = geoOf(targeting);
  const plan: GeoPlan = {
    countries: [],
    excludedCountries: [...new Set(geo.countries.exclude)],
    places: [],
    excludedPlaces: [],
    radii: [],
    widened: [],
    ignoredExclusions: [],
    tooManyRadii: null,
    outside: outsideCountries(targeting),
  };

  const inside: string[] = insideCountries(targeting);
  for (const country of inside) {
    const places: GeoPlace[] = geo.places.include.filter((place: GeoPlace): boolean => place.countryCode === country);
    const radii: GeoRadius[] = geo.radii.filter((radius: GeoRadius): boolean => radius.countryCode === country);
    if (places.length === 0 && radii.length === 0) {
      plan.countries.push(country);
      continue;
    }
    const reasons = new Set<GeoWidenReason>();
    if (places.some((place: GeoPlace): boolean => !rules.levels.includes(place.level as GeoLevel)))
      reasons.add('level');
    if (radii.length > 0 && rules.maxRadii === null) reasons.add('radius');
    if (reasons.size > 0) {
      plan.countries.push(country);
      plan.widened.push({ country, reasons: [...reasons].sort() });
      continue;
    }
    plan.places.push(...places);
    plan.radii.push(...radii);
  }

  for (const place of geo.places.exclude) {
    // A place outside the countries is reported as such.
    if (place.countryCode === undefined || !inside.includes(place.countryCode)) continue;
    if (rules.excludedLevels.includes(place.level as GeoLevel)) plan.excludedPlaces.push(place);
    else plan.ignoredExclusions.push(place);
  }

  if (rules.maxRadii !== null && plan.radii.length > rules.maxRadii) {
    plan.tooManyRadii = { count: plan.radii.length, max: rules.maxRadii };
  }
  return plan;
}

/**
 * What a place or a circle is called in a finding: its name, or where it is.
 *
 * @param target - The place or the circle
 * @returns A name a person recognizes
 */
export function geoNameOf(target: GeoPlace | GeoRadius): string {
  if ('id' in target) return target.name ?? target.id;
  return target.label ?? target.address ?? `${target.latitude}, ${target.longitude}`;
}
