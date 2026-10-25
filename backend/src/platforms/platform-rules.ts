import { httpError } from '@utils';

/**
 * What one advertising platform accepts **on one lever**, as far as the domain model is concerned.
 *
 * The rest of the code **never tests a platform name, and never tests a lever either**: it reads
 * these rules, so a new platform, a new lever of an existing one, or a changed limit is a change in
 * this file only. That is the shape the socle fixes; the fields themselves are added by the phase of
 * each capability (targeting, creatives, capping, reporting), and the entries by the phase of each
 * platform.
 *
 * @property label - Display name of the platform
 */
export type PlatformRules = {
  label: string;
};

/**
 * The rules of every platform that has a connector, by platform **then by lever** — the key is the
 * couple `(platform, lever)`, not the platform alone (`backend/docs/leviers.md` L2, confirmed
 * independently by F11 of `backend/docs/plateformes/faisabilite-search.md`).
 *
 * The couple is the key because the same platform accepts different things on different levers:
 * Hawk refuses `os`, `environment`, `ip` and `deviceType` on DOOH while taking them elsewhere,
 * resolves a creative type from the lever's family, and DV360 refuses any capping on its `dac` path
 * only. A registry keyed by platform alone cannot express any of that.
 *
 * This registry says what the **platform** accepts; what the **model** allows is the lever profile,
 * keyed by lever alone, which a later phase adds next to this file. The two do not replace each
 * other: the profile declares the permitted set and refuses in 400, the registry intersects it, and
 * the preview shows what was lost.
 *
 * Empty in the socle: the platforms of the matrix arrive in their own phases, each adding its
 * couples here and the fields its capabilities need.
 */
export const PLATFORM_RULES: Readonly<Record<string, Readonly<Record<string, PlatformRules>>>> = {};

/**
 * Ids of the platforms that have a connector, as the API names them.
 *
 * @returns The ids, sorted
 *
 * @example
 * ```typescript
 * supportedPlatforms(); // [] until the first platform phase
 * ```
 */
export function supportedPlatforms(): string[] {
  return Object.keys(PLATFORM_RULES).sort();
}

/**
 * The levers a platform has a connector for.
 *
 * @param platform - Its id
 * @returns The lever ids, sorted; empty for a platform no connector declares
 *
 * @example
 * ```typescript
 * leversOf('dv360'); // ['audio', 'ctv_tvs', 'dac'], once its phase has added them
 * ```
 */
export function leversOf(platform: string): string[] {
  return Object.keys(PLATFORM_RULES[platform] ?? {}).sort();
}

/**
 * The rules of one platform on one lever.
 *
 * @param platform - Its id
 * @param lever - The lever the campaign buys on
 * @returns The rules of the couple
 * @throws Error with status 400 coded `platform_unknown` when no connector declares the platform,
 *   or `platform_lever_unsupported` when it has one but not for that lever
 *
 * @example
 * ```typescript
 * rulesOf('google_ads', 'search').label; // 'Google Ads', once the Search phase has added it
 * ```
 */
export function rulesOf(platform: string, lever: string): PlatformRules {
  const levers: Readonly<Record<string, PlatformRules>> | undefined = PLATFORM_RULES[platform];
  if (!levers) {
    throw httpError(400, `Unknown platform ${platform}`, { code: 'platform_unknown', params: { platform } });
  }
  const rules: PlatformRules | undefined = levers[lever];
  if (!rules) {
    throw httpError(400, `${platform} has no connector for the ${lever} lever`, {
      code: 'platform_lever_unsupported',
      params: { platform, lever },
    });
  }
  return rules;
}
