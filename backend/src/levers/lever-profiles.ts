import {
  BidStrategy,
  FieldRule,
  Lever,
  leverSchema,
  Objective,
  Platform,
  RuledField,
  TreeLevel,
  VolumeUnit,
} from '@src/types';
import { httpError } from '@utils';

/**
 * @module levers/lever-profiles
 *
 * What **the model** lets a lever express, lever by lever (`../../CADRAGE.md` § 5,
 * `backend/docs/leviers.md` § 4). The rest of the code **never tests a lever name**: it reads this
 * registry, so a rule that changes is a change in this file only.
 *
 * This is not `src/platforms/platform-rules.ts`, and the two do not replace each other (L2):
 *
 * |         | This profile                      | The platform registry                     |
 * | ------- | --------------------------------- | ----------------------------------------- |
 * | Key     | `lever`                           | `(platform, lever)`                       |
 * | Says    | what the **model** can express    | what the **platform** accepts             |
 * | Answers | a **400** at write time           | an error or a warning of the **preview**   |
 *
 * So `capping: forbidden` on `search` is here (no platform of the lever expresses it, so writing one
 * is a mistake), while "DV360 refuses any capping on its Demand Gen path" is the registry's, and
 * becomes a warning on a `dac` campaign that also runs elsewhere.
 *
 * A declaration left empty here is **absent**, not permissive: the phase that fills it fills it for
 * the six levers at once.
 */

/** The fields a profile rules on, at every level of the tree. */
type LevelRules = Readonly<Record<TreeLevel, FieldRule>>;

/**
 * Budget: mandatory on the campaign, inherited below (`../../CADRAGE.md` § 4). A level that is
 * `allowed` with a `null` value still has an effective budget — its share by division.
 */
const BUDGET_INHERITED: LevelRules = {
  campaign: 'required',
  lever: 'allowed',
  ad_group: 'allowed',
  targeting_group: 'allowed',
  line: 'allowed',
};

/**
 * Budget of the `search` lever: **forbidden on the Line** (D12). With no budget of their own, the N
 * Lines of a TargetingGroup become N RSA ads in a single Google ad group, which keeps Google's ad
 * rotation and optimisation — instead of N separate campaigns.
 */
const BUDGET_NOT_ON_LINE: LevelRules = { ...BUDGET_INHERITED, line: 'forbidden' };

/**
 * Dates: mandatory on the campaign, inherited below, and **never on the TargetingGroup** — it is a
 * targeting applied, not a period of delivery (`../../CADRAGE.md` § 3).
 */
const DATES_INHERITED: LevelRules = {
  campaign: 'required',
  lever: 'allowed',
  ad_group: 'allowed',
  targeting_group: 'forbidden',
  line: 'allowed',
};

/** Capping: optional at the five levels, `null` inheriting the parent's (D10). */
const CAPPING_EVERYWHERE: LevelRules = {
  campaign: 'allowed',
  lever: 'allowed',
  ad_group: 'allowed',
  targeting_group: 'allowed',
  line: 'allowed',
};

/**
 * Capping of the `search` lever: **forbidden everywhere** (L6). None of its platforms expresses a
 * frequency cap, so a capping on a Search campaign is refused at write time rather than warned about
 * in the preview — the user is told where the mistake is, not after the fact.
 */
const CAPPING_NOWHERE: LevelRules = {
  campaign: 'forbidden',
  lever: 'forbidden',
  ad_group: 'forbidden',
  targeting_group: 'forbidden',
  line: 'forbidden',
};

/**
 * What one lever lets the model express.
 *
 * @property label - Display name of the lever
 * @property rules - Per field, the rule at each level of the tree
 * @property platforms - The platforms eligible to the lever (`../../CADRAGE.md` § 6); being eligible
 *   is not having a connector, which `src/platforms/platform-rules.ts` says
 * @property bidStrategies - The bidding strategies permitted, the first being the default (L3)
 * @property objectives - The objectives permitted, the first being the default (L4)
 * @property objectivesComplete - Whether that list is the final one. `false` says the lever carries a
 *   single safe default until the study of its first platform gives the real list — an **incomplete**
 *   declaration, deliberately, rather than a permissive one
 * @property volumeUnits - The units a budget may be entered in; empty means money only (L25)
 * @property dealsPermitted - Whether deals may be attached (L7)
 * @property productsModePermitted - Whether a lever may run in Products mode (L13, L14)
 */
export type LeverProfile = {
  label: string;
  rules: Readonly<Record<RuledField, LevelRules>>;
  platforms: readonly Platform[];
  bidStrategies: readonly [BidStrategy, ...BidStrategy[]];
  objectives: readonly [Objective, ...Objective[]];
  objectivesComplete: boolean;
  volumeUnits: readonly VolumeUnit[];
  dealsPermitted: boolean;
  productsModePermitted: boolean;
};

/**
 * The profile of each lever.
 *
 * The platforms come from the matrix of `../../CADRAGE.md` § 6, GAM removed (L26) and Amazon DSP out
 * of `audio` (L27). The objectives of the programmatic and social levers are a single safe default
 * each: what Meta, TikTok and Snap open to conversion bidding is a reading to take on a real account
 * (`../../A-FAIRE.md`), and what DV360 and Amazon derive from the lever belongs to their adapter.
 */
export const LEVER_PROFILES: Readonly<Record<Lever, LeverProfile>> = {
  search: {
    label: 'Search',
    rules: { budget: BUDGET_NOT_ON_LINE, dates: DATES_INHERITED, capping: CAPPING_NOWHERE },
    platforms: ['google_ads', 'microsoft', 'openai', 'thrad', 'amazon_search'],
    bidStrategies: ['max_cpc', 'maximize_clicks', 'maximize_conversions', 'cpm'],
    objectives: ['traffic', 'conversions', 'sales', 'leads'],
    objectivesComplete: true,
    volumeUnits: [],
    dealsPermitted: false,
    productsModePermitted: true,
  },
  dooh: {
    label: 'DOOH',
    rules: { budget: BUDGET_INHERITED, dates: DATES_INHERITED, capping: CAPPING_EVERYWHERE },
    platforms: ['hawk'],
    bidStrategies: ['fixed_cpm', 'from_deal'],
    objectives: ['awareness'],
    objectivesComplete: false,
    volumeUnits: ['impressions', 'plays'],
    dealsPermitted: true,
    productsModePermitted: false,
  },
  audio: {
    label: 'Audio',
    rules: { budget: BUDGET_INHERITED, dates: DATES_INHERITED, capping: CAPPING_EVERYWHERE },
    platforms: ['hawk', 'dv360'],
    bidStrategies: ['fixed_cpm', 'target_cpcv', 'maximize_reach', 'from_deal'],
    objectives: ['awareness'],
    objectivesComplete: false,
    volumeUnits: ['impressions', 'completions'],
    dealsPermitted: true,
    productsModePermitted: false,
  },
  social: {
    label: 'Social',
    rules: { budget: BUDGET_INHERITED, dates: DATES_INHERITED, capping: CAPPING_EVERYWHERE },
    platforms: ['meta', 'tiktok', 'snap'],
    bidStrategies: ['maximize_reach', 'cpm', 'max_cpc', 'maximize_clicks', 'maximize_conversions'],
    objectives: ['awareness'],
    objectivesComplete: false,
    volumeUnits: [],
    dealsPermitted: false,
    productsModePermitted: false,
  },
  ctv_tvs: {
    label: 'CTV & TVS',
    rules: { budget: BUDGET_INHERITED, dates: DATES_INHERITED, capping: CAPPING_EVERYWHERE },
    platforms: ['hawk', 'dv360', 'amazon_dsp'],
    bidStrategies: ['fixed_cpm', 'target_cpcv', 'maximize_reach', 'from_deal'],
    objectives: ['awareness'],
    objectivesComplete: false,
    volumeUnits: ['impressions', 'completions'],
    dealsPermitted: true,
    productsModePermitted: false,
  },
  dac: {
    label: 'Display & video on the web and in apps',
    rules: { budget: BUDGET_INHERITED, dates: DATES_INHERITED, capping: CAPPING_EVERYWHERE },
    platforms: ['hawk', 'dv360'],
    bidStrategies: ['fixed_cpm', 'target_cpc', 'maximize_reach', 'from_deal'],
    objectives: ['awareness'],
    objectivesComplete: false,
    volumeUnits: ['impressions'],
    dealsPermitted: true,
    productsModePermitted: false,
  },
};

/**
 * Every lever, in the order the API lists them.
 *
 * @returns The lever ids
 *
 * @example
 * ```typescript
 * allLevers(); // ['search', 'dooh', 'audio', 'social', 'ctv_tvs', 'dac']
 * ```
 */
export function allLevers(): Lever[] {
  return [...leverSchema.options];
}

/**
 * The profile of one lever.
 *
 * @param lever - The lever
 * @returns Its profile
 *
 * @example
 * ```typescript
 * profileOf('search').productsModePermitted; // true
 * ```
 */
export function profileOf(lever: Lever): LeverProfile {
  return LEVER_PROFILES[lever];
}

/**
 * The rule a lever sets for one field at one level.
 *
 * @param lever - The lever
 * @param level - The level of the tree
 * @param field - The field
 * @returns `required`, `allowed` or `forbidden`
 *
 * @example
 * ```typescript
 * fieldRuleOf('search', 'line', 'budget'); // 'forbidden'
 * ```
 */
export function fieldRuleOf(lever: Lever, level: TreeLevel, field: RuledField): FieldRule {
  return LEVER_PROFILES[lever].rules[field][level];
}

/**
 * Whether a level of a lever can hold a budget at all — explicit or by division.
 *
 * The budget algebra reads this: a level whose budget is `forbidden` has **no** effective budget, so
 * it does not take part in the division between its siblings and can never carry a daily curve.
 *
 * @param lever - The lever
 * @param level - The level of the tree
 * @returns Whether a budget reaches that level
 *
 * @example
 * ```typescript
 * carriesBudget('search', 'line'); // false
 * carriesBudget('dooh', 'line'); // true
 * ```
 */
export function carriesBudget(lever: Lever, level: TreeLevel): boolean {
  return fieldRuleOf(lever, level, 'budget') !== 'forbidden';
}

/**
 * Refuse a field the lever forbids at that level.
 *
 * Only a **present** value is refused: an absent field is the normal case of a level that inherits,
 * and a `required` field missing is the preview's business, not a refusal at entry
 * (`../../CADRAGE.md` § 13 — rigour at publication, permissive at entry).
 *
 * @param lever - The lever
 * @param level - The level being written
 * @param field - The field being written
 * @param present - Whether the caller sent a value for it
 * @returns Nothing
 * @throws Error with status 400 coded `lever_field_forbidden`
 *
 * @example
 * ```typescript
 * assertFieldAllowed('search', 'line', 'budget', body.budgetCents !== undefined);
 * ```
 */
export function assertFieldAllowed(lever: Lever, level: TreeLevel, field: RuledField, present: boolean): void {
  if (!present || fieldRuleOf(lever, level, field) !== 'forbidden') return;
  throw httpError(400, `The ${lever} lever does not accept a ${field} on a ${level}`, {
    code: 'lever_field_forbidden',
    params: { lever, level, field },
  });
}

/**
 * Refuse a platform the lever is not eligible to.
 *
 * Eligibility is the matrix of `../../CADRAGE.md` § 6, which the model knows without calling anyone.
 * Whether that platform has a connector yet is `src/platforms/platform-rules.ts`, and whether it
 * accepts what the node asks for is its registry — both of which the preview reads.
 *
 * @param lever - The lever
 * @param platform - The platform asked for
 * @returns Nothing
 * @throws Error with status 400 coded `platform_not_eligible`
 *
 * @example
 * ```typescript
 * assertPlatformEligible('dooh', 'google_ads'); // throws
 * ```
 */
export function assertPlatformEligible(lever: Lever, platform: Platform): void {
  if (LEVER_PROFILES[lever].platforms.includes(platform)) return;
  throw httpError(400, `${platform} does not serve the ${lever} lever`, {
    code: 'platform_not_eligible',
    params: { platform, lever },
  });
}

/**
 * Refuse a bidding strategy the lever does not permit.
 *
 * @param lever - The lever
 * @param strategy - The strategy asked for
 * @returns Nothing
 * @throws Error with status 400 coded `bid_strategy_not_permitted`
 *
 * @example
 * ```typescript
 * assertBidStrategyPermitted('search', 'target_cpcv'); // throws
 * ```
 */
export function assertBidStrategyPermitted(lever: Lever, strategy: BidStrategy): void {
  if (LEVER_PROFILES[lever].bidStrategies.includes(strategy)) return;
  throw httpError(400, `The ${lever} lever does not bid with ${strategy}`, {
    code: 'bid_strategy_not_permitted',
    params: { strategy, lever },
  });
}

/**
 * Refuse an objective the lever does not permit.
 *
 * @param lever - The lever
 * @param objective - The objective asked for
 * @returns Nothing
 * @throws Error with status 400 coded `objective_not_permitted`
 *
 * @example
 * ```typescript
 * assertObjectivePermitted('search', 'app_installs'); // throws
 * ```
 */
export function assertObjectivePermitted(lever: Lever, objective: Objective): void {
  if (LEVER_PROFILES[lever].objectives.includes(objective)) return;
  throw httpError(400, `The ${lever} lever does not run for ${objective}`, {
    code: 'objective_not_permitted',
    params: { objective, lever },
  });
}

/**
 * Refuse a volume unit the lever does not permit (L25).
 *
 * @param lever - The lever
 * @param unit - The unit the caller entered a volume in
 * @returns Nothing
 * @throws Error with status 400 coded `volume_not_permitted`
 *
 * @example
 * ```typescript
 * assertVolumeUnitPermitted('search', 'impressions'); // throws: the Search buys clicks
 * ```
 */
export function assertVolumeUnitPermitted(lever: Lever, unit: VolumeUnit): void {
  if (LEVER_PROFILES[lever].volumeUnits.includes(unit)) return;
  throw httpError(400, `A budget of the ${lever} lever cannot be entered in ${unit}`, {
    code: 'volume_not_permitted',
    params: { unit, lever },
  });
}

/**
 * The bidding strategy a node of this lever takes when the caller names none.
 *
 * @param lever - The lever
 * @returns Its default strategy
 */
export function defaultBidStrategyOf(lever: Lever): BidStrategy {
  return LEVER_PROFILES[lever].bidStrategies[0];
}

/**
 * The objective an AdGroup of this lever takes when the caller names none.
 *
 * @param lever - The lever
 * @returns Its default objective
 */
export function defaultObjectiveOf(lever: Lever): Objective {
  return LEVER_PROFILES[lever].objectives[0];
}

/**
 * Refuse a field that **any** of several levers forbids at that level.
 *
 * The campaign sits above the channels, so a value written on it applies to every lever it carries:
 * a capping on a campaign that also runs `search` would be a value no Search platform can express
 * (L6). The rule is therefore the union — the first lever that forbids it refuses the write, naming
 * itself, so the user knows which channel to move the value to.
 *
 * A campaign with no lever yet forbids nothing: there is nothing it cannot express.
 *
 * @param levers - The levers the node spans
 * @param level - The level being written
 * @param field - The field being written
 * @param present - Whether the caller sent a value for it
 * @returns Nothing
 * @throws Error with status 400 coded `lever_field_forbidden`
 *
 * @example
 * ```typescript
 * assertFieldAllowedForLevers(['dac', 'search'], 'campaign', 'capping', true); // throws, naming search
 * ```
 */
export function assertFieldAllowedForLevers(
  levers: Lever[],
  level: TreeLevel,
  field: RuledField,
  present: boolean
): void {
  for (const lever of levers) assertFieldAllowed(lever, level, field, present);
}
