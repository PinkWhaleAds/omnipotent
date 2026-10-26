import { CreativeFormat, CreativeSubtype, PlatformObject, TargetingDimension, TreeLevel } from '@src/types';
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
 * @property targeting - The targeting dimensions this couple accepts; what it is asked for and does
 *   not accept is **dropped for it**, and the preview names the loss (L2, `docs/phase-5.md` § 5)
 * @property creatives - The `(format, subtype)` couples it accepts, spelled `format:subtype`
 *   (D37, G6): a creative no platform of the lever accepts fails the preview, one some accept only
 *   warns there
 * @property projection - What each of our levels becomes there, and where it can hold a budget
 *   (`../../CADRAGE.md` § 7)
 * @property requiresClickThroughUrl - Whether it refuses a creative without one (G5: Hawk does,
 *   audio included)
 * @property requiresIabCategories - Whether it refuses a creative without content categories (L19)
 */
export type PlatformRules = {
  label: string;
  targeting: readonly TargetingDimension[];
  creatives: readonly `${CreativeFormat}:${CreativeSubtype}`[];
  projection: PlatformProjection;
  requiresClickThroughUrl: boolean;
  requiresIabCategories: boolean;
};

/**
 * What a platform makes of our tree (`../../CADRAGE.md` § 7).
 *
 * A **declaration, not code**: the preview counts the objects from this table and from the level that
 * holds the budget, so an adapter implements nothing for the preview to work, and two platforms that
 * project alike share the same engine (`docs/phase-8.md` § 2).
 *
 * @property levels - The object each of our levels becomes, `null` when it becomes none of its own
 * @property budgetLevel - The level of **ours** whose object can hold a budget there; a node below it
 *   carrying an explicit budget becomes its own object of that level — the split of § 7
 */
export type PlatformProjection = {
  levels: Readonly<Record<TreeLevel, PlatformObject | null>>;
  budgetLevel: TreeLevel;
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

/**
 * The dimensions a couple cannot express, among those a node asks for.
 *
 * This is the **platform's** answer, and it is never a refusal: the dimension was already permitted
 * by the lever profile, so the campaign is legitimate — this part of it simply will not reach that
 * platform, and the share bought there delivers without the restriction. Naming it is the whole
 * point of the preview, and the trap § 8 of `../../CADRAGE.md` describes
 * (`docs/phase-5.md` § 5).
 *
 * @param platform - Its id
 * @param lever - The lever the campaign buys on
 * @param asked - The dimensions the node carries
 * @returns Those the couple does not accept, sorted
 * @throws Error with status 400 when the platform has no connector, or none for that lever
 *
 * @example
 * ```typescript
 * unsupportedDimensions('hawk', 'dooh', ['browser', 'screen']); // ['browser'], once Hawk has landed
 * ```
 */
export function unsupportedDimensions(
  platform: string,
  lever: string,
  asked: readonly TargetingDimension[]
): TargetingDimension[] {
  const accepted: readonly TargetingDimension[] = rulesOf(platform, lever).targeting;
  return asked.filter((dimension: TargetingDimension): boolean => !accepted.includes(dimension)).sort();
}

/**
 * The projection of one couple.
 *
 * @param platform - Its id
 * @param lever - The lever the campaign buys on
 * @returns What that couple makes of our tree
 * @throws Error with status 400 when the platform has no connector, or none for that lever
 *
 * @example
 * ```typescript
 * projectionOf('google_ads', 'search').budgetLevel; // 'ad_group', once the Search phase has landed
 * ```
 */
export function projectionOf(platform: string, lever: string): PlatformProjection {
  return rulesOf(platform, lever).projection;
}

/**
 * Whether a couple accepts a creative of that shape.
 *
 * @param platform - Its id
 * @param lever - The lever the campaign buys on
 * @param format - The inventory the creative aims at
 * @param subtype - How it reaches the platform
 * @returns `true` when it accepts it
 * @throws Error with status 400 when the platform has no connector, or none for that lever
 *
 * @example
 * ```typescript
 * acceptsCreative('hawk', 'dooh', 'display', 'image');
 * ```
 */
export function acceptsCreative(
  platform: string,
  lever: string,
  format: CreativeFormat,
  subtype: CreativeSubtype
): boolean {
  return rulesOf(platform, lever).creatives.includes(`${format}:${subtype}`);
}

/**
 * Whether a couple has a connector at all.
 *
 * A **question**, where `rulesOf` is a demand: the preview asks it so that a couple no phase has
 * landed yet becomes a finding rather than an exception to catch (`docs/phase-8.md` § 2).
 *
 * @param platform - Its id
 * @param lever - The lever the campaign buys on
 * @returns `true` when the registry declares that couple
 *
 * @example
 * ```typescript
 * hasAdapter('hawk', 'dooh'); // false until the Hawk phase lands
 * ```
 */
export function hasAdapter(platform: string, lever: string): boolean {
  return PLATFORM_RULES[platform]?.[lever] !== undefined;
}
