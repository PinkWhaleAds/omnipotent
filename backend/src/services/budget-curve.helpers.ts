/**
 * @module services/budget-curve.helpers
 *
 * The algebra of the daily curve: one day, one amount, and the days always add up to **exactly** the
 * budget of the node (`../../CADRAGE.md` § 4, `docs/phase-4.md` § 3).
 *
 * Transcribed from `~/OmniAd/multi-search/backend/src/services/budget-curve.helpers.ts`, where
 * thirty-six phases hardened it — it is our code (D1). Two deliberate differences: amounts stay in
 * **integer cents** end to end rather than being converted at the edge, and a fourth shape,
 * `selected_days`, says which weekdays deliver at all.
 *
 * Pure functions, like the budget algebra they extend: no database, no request.
 */
import {
  ApplyBudgetPresetBody,
  BudgetDay,
  BudgetPreset,
  DEFAULT_WEEKEND_FACTOR,
  MAX_CURVE_DAYS,
  UpdateBudgetDaysBody,
  Weekday,
} from '@src/types';
import { httpError } from '@utils';
import { assertWindowOrdered } from './tree.helpers';

/** One day of a curve while it is being computed. */
export type CurveDay = {
  /** `YYYY-MM-DD`. */
  day: string;
  /** Budget of the day, in cents. */
  cents: number;
  /** Whether the day keeps its amount when the others are recalculated. */
  locked: boolean;
};

/** Number of milliseconds in a day. */
const DAY_IN_MS = 86_400_000;

/** The days of the week, in the order `Date.getUTCDay` numbers them. */
const WEEKDAYS: Weekday[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Every day from `start` to `end`, both included.
 *
 * The computation runs in UTC, so no timezone and no daylight-saving change can skip or repeat a day.
 *
 * @param start - First day, `YYYY-MM-DD`
 * @param end - Last day, `YYYY-MM-DD`
 * @returns The days in order; none when `end` is before `start`
 *
 * @example
 * ```typescript
 * listDays('2027-01-30', '2027-02-01'); // ['2027-01-30', '2027-01-31', '2027-02-01']
 * ```
 */
export function listDays(start: string, end: string): string[] {
  const days: string[] = [];
  const last: number = Date.parse(`${end}T00:00:00Z`);
  for (let time: number = Date.parse(`${start}T00:00:00Z`); time <= last; time += DAY_IN_MS) {
    days.push(new Date(time).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * The weekday of a day.
 *
 * @param day - `YYYY-MM-DD`
 * @returns Its weekday
 *
 * @example
 * ```typescript
 * weekdayOf('2026-11-07'); // 'saturday'
 * ```
 */
export function weekdayOf(day: string): Weekday {
  return WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()];
}

/**
 * Whether a day is a Saturday or a Sunday.
 *
 * @param day - `YYYY-MM-DD`
 * @returns `true` on weekends
 */
export function isWeekend(day: string): boolean {
  const weekday: Weekday = weekdayOf(day);
  return weekday === 'saturday' || weekday === 'sunday';
}

/**
 * Whether a day of a curve is frozen: a launched campaign has already delivered its days before
 * today, so they keep their amount and their lock — rewriting them would rewrite history.
 *
 * @param day - `YYYY-MM-DD`
 * @param today - Today in the campaign's timezone once it is launched; `null` for a draft, which has
 *   no frozen day
 * @returns `true` for a day before today of a launched campaign
 *
 * @example
 * ```typescript
 * isPast('2027-01-01', '2027-01-02'); // true
 * isPast('2027-01-01', null); // false: a draft
 * ```
 */
export function isPast(day: string, today: string | null): boolean {
  return today !== null && day < today;
}

/**
 * The sum of some days, in cents.
 *
 * @param days - The days
 * @returns Their total
 */
export function sumCents(days: CurveDay[]): number {
  return days.reduce((total: number, day: CurveDay): number => total + day.cents, 0);
}

/**
 * Refuse a budget smaller than what the days already past hold.
 *
 * @param curve - The curve
 * @param totalCents - The budget the days must add up to
 * @param today - See {@link isPast}
 * @returns What the past days hold, in cents
 * @throws Error with status 400 coded `budget_below_past_days`
 */
function assertPastFits(curve: CurveDay[], totalCents: number, today: string | null): number {
  const pastCents: number = sumCents(curve.filter((day: CurveDay): boolean => isPast(day.day, today)));
  if (pastCents > totalCents) {
    throw httpError(400, `The days already past hold ${pastCents} cents, more than the budget of ${totalCents}`, {
      code: 'budget_below_past_days',
      params: { pastCents, budgetCents: totalCents },
    });
  }
  return pastCents;
}

/**
 * Split an amount between weights, exactly.
 *
 * The largest remainder method, as in the per-platform split of phase 3: each share is floored, then
 * the cents left over go one by one to the largest fractional parts, earliest first on ties. The
 * result always adds up to `totalCents`.
 *
 * @param totalCents - The amount to split
 * @param weights - Non-negative weights, one per share
 * @returns One amount per weight
 * @throws Error with status 400 coded `budget_no_free_day` when every weight is zero and there is
 *   still something to place
 *
 * @example
 * ```typescript
 * distributeOverDays(1000, [1, 1, 1]); // [334, 333, 333]
 * ```
 */
export function distributeOverDays(totalCents: number, weights: number[]): number[] {
  const sum: number = weights.reduce((total: number, weight: number): number => total + weight, 0);
  if (sum === 0) {
    if (totalCents === 0) return weights.map((): number => 0);
    throw httpError(400, 'No day can take the remaining budget: unlock a day, or let one deliver', {
      code: 'budget_no_free_day',
      params: { remainingCents: totalCents },
    });
  }

  const exact: number[] = weights.map((weight: number): number => (totalCents * weight) / sum);
  const shares: number[] = exact.map((value: number): number => Math.floor(value));
  let left: number = totalCents - shares.reduce((total: number, share: number): number => total + share, 0);
  const order: number[] = exact
    .map((value: number, index: number): [number, number] => [value - Math.floor(value), index])
    .sort((a: [number, number], b: [number, number]): number => b[0] - a[0] || a[1] - b[1])
    .map(([, index]: [number, number]): number => index);
  for (const index of order) {
    if (left === 0) break;
    shares[index] += 1;
    left -= 1;
  }
  return shares;
}

/**
 * The weights of a shape over a list of days.
 *
 * @param days - The days, in order
 * @param preset - The shape
 * A day named in `excludedDays` weighs **0** whatever the shape: that is « pas le 26 octobre », and
 * it composes with « pas le samedi » rather than competing with it.
 *
 * @param days - The days, in order
 * @param preset - The shape
 * @param options - What the shape needs
 * @param options.factor - `weekend_boost`: the weight of a weekend day against a weekday
 * @param options.weekdays - `selected_days`: the weekdays that deliver; the others weigh 0
 * @param options.excludedDays - Named days that must not deliver, whatever the shape
 * @returns One weight per day
 *
 * @example
 * ```typescript
 * presetWeights(days, 'flat', { excludedDays: ['2026-10-26'] }); // 1 everywhere, 0 that day
 * ```
 */
export function presetWeights(
  days: string[],
  preset: BudgetPreset,
  options: { factor?: number; weekdays?: Weekday[]; excludedDays?: string[] } = {}
): number[] {
  const excluded = new Set<string>(options.excludedDays ?? []);
  const shaped: number[] = shapeWeights(days, preset, options);
  return shaped.map((weight: number, index: number): number => (excluded.has(days[index]) ? 0 : weight));
}

/**
 * The weights of a shape alone, before the named days are taken out.
 *
 * @param days - The days, in order
 * @param preset - The shape
 * @param options - What the shape needs
 * @param options.factor - `weekend_boost`: the weight of a weekend day against a weekday
 * @param options.weekdays - `selected_days`: the weekdays that deliver
 * @returns One weight per day
 */
function shapeWeights(
  days: string[],
  preset: BudgetPreset,
  options: { factor?: number; weekdays?: Weekday[] }
): number[] {
  if (preset === 'weekend_boost') {
    const factor: number = options.factor ?? DEFAULT_WEEKEND_FACTOR;
    return days.map((day: string): number => (isWeekend(day) ? factor : 1));
  }
  if (preset === 'ramp_up') {
    const ramp: number = Math.max(1, Math.ceil(days.length / 4));
    return days.map((_day: string, index: number): number => (index < ramp ? (index + 1) / ramp : 1));
  }
  if (preset === 'selected_days') {
    const delivering = new Set<Weekday>(options.weekdays ?? []);
    return days.map((day: string): number => (delivering.has(weekdayOf(day)) ? 1 : 0));
  }
  return days.map((): number => 1);
}

/**
 * Build a curve from weights, every day unlocked.
 *
 * @param days - The days, in order
 * @param totalCents - The budget of the period
 * @param weights - One weight per day
 * @returns The curve
 */
export function curveFromWeights(days: string[], totalCents: number, weights: number[]): CurveDay[] {
  const cents: number[] = distributeOverDays(totalCents, weights);
  return days.map((day: string, index: number): CurveDay => ({ day, cents: cents[index], locked: false }));
}

/**
 * Recalculate the free days of a curve so the days add up to the budget again.
 *
 * Three sorts of day keep their amount: the **locked** ones, the ones **pinned** by the request being
 * handled, and the ones **already past**. The rest share what is left **in proportion to what they
 * held**, so the shape of the curve survives a change of budget — and a day at 0 stays at 0, because
 * a zero is an intention, not a gap.
 *
 * @param curve - The curve to recalculate
 * @param totalCents - The budget the days must add up to
 * @param pinned - Days that keep their amount this once, without being locked
 * @param today - See {@link isPast}
 * @returns A new curve adding up to `totalCents`
 * @throws Error with status 400 coded `budget_below_past_days`, `budget_fixed_days_exceed` or
 *   `budget_no_free_day`
 *
 * @example
 * ```typescript
 * rebalance(curve, 120_000, new Set(['2027-01-06']), '2027-01-03');
 * ```
 */
export function rebalance(
  curve: CurveDay[],
  totalCents: number,
  pinned: Set<string> = new Set<string>(),
  today: string | null = null
): CurveDay[] {
  assertPastFits(curve, totalCents, today);
  const fixed = (day: CurveDay): boolean => day.locked || pinned.has(day.day) || isPast(day.day, today);
  const fixedCents: number = sumCents(curve.filter(fixed));
  if (fixedCents > totalCents) {
    throw httpError(400, `Locked, edited and past days add up to ${fixedCents} cents of a budget of ${totalCents}`, {
      code: 'budget_fixed_days_exceed',
      params: { fixedCents, budgetCents: totalCents },
    });
  }

  const free: CurveDay[] = curve.filter((day: CurveDay): boolean => !fixed(day));
  const shares: number[] = distributeOverDays(
    totalCents - fixedCents,
    free.map((day: CurveDay): number => day.cents)
  );
  const recalculated = new Map<string, number>(
    free.map((day: CurveDay, index: number): [string, number] => [day.day, shares[index]])
  );
  return curve.map((day: CurveDay): CurveDay => ({ ...day, cents: recalculated.get(day.day) ?? day.cents }));
}

/**
 * Rebuild a curve for a new period: the days already past and the locked days still inside it keep
 * their amount, every other day shares the rest evenly.
 *
 * @param previous - The curve as it stands
 * @param days - The days of the new period
 * @param totalCents - The budget of the period
 * @param today - See {@link isPast}
 * @returns The new curve
 * @throws Error with status 400 when the past days exceed the budget, or no day can take the rest
 *
 * @example
 * ```typescript
 * rebuildCurve(curve, listDays('2027-01-01', '2027-01-31'), 310_000, null);
 * ```
 */
export function rebuildCurve(
  previous: CurveDay[],
  days: string[],
  totalCents: number,
  today: string | null = null
): CurveDay[] {
  const before = new Map<string, CurveDay>(previous.map((day: CurveDay): [string, CurveDay] => [day.day, day]));
  const curve: CurveDay[] = days.map((day: string): CurveDay => {
    const kept: CurveDay | undefined = before.get(day);
    if (isPast(day, today)) return kept ? { ...kept } : { day, cents: 0, locked: false };
    return kept?.locked ? { ...kept } : { day, cents: 1, locked: false };
  });
  return rebalance(curve, totalCents, new Set<string>(), today);
}

/**
 * Reshape a curve to a preset.
 *
 * The days from today on take the shape over the whole period and lose their lock — a preset is a
 * decision about the shape, so it releases what was pinned to the old one. The days already past keep
 * their amount.
 *
 * @param previous - The curve as it stands
 * @param days - The days of the period
 * @param totalCents - The budget of the period
 * @param body - The shape, and what it needs
 * @param today - See {@link isPast}; `null` (a draft) reshapes every day
 * @returns The new curve
 * @throws Error with status 400 when the past days exceed the budget, or the shape leaves no day able
 *   to deliver — a `selected_days` naming weekdays the period does not contain, or an exclusion list
 *   covering it whole
 *
 * @example
 * ```typescript
 * presetCurve(curve, days, 100_000, { preset: 'selected_days', weekdays: ['monday'] }, '2027-01-03');
 * ```
 */
export function presetCurve(
  previous: CurveDay[],
  days: string[],
  totalCents: number,
  body: ApplyBudgetPresetBody,
  today: string | null
): CurveDay[] {
  const before = new Map<string, CurveDay>(previous.map((day: CurveDay): [string, CurveDay] => [day.day, day]));
  const past: CurveDay[] = days
    .filter((day: string): boolean => isPast(day, today))
    .map((day: string): CurveDay => ({ ...(before.get(day) ?? { day, cents: 0, locked: false }) }));
  const pastCents: number = assertPastFits(past, totalCents, today);

  const weights: number[] = presetWeights(days, body.preset, {
    factor: body.factor,
    weekdays: body.weekdays,
    excludedDays: body.excludedDays,
  });
  const open: number[] = days.flatMap((day: string, index: number): number[] => (isPast(day, today) ? [] : [index]));
  const shares: number[] = distributeOverDays(
    totalCents - pastCents,
    open.map((index: number): number => weights[index])
  );
  return [
    ...past,
    ...open.map((index: number, rank: number): CurveDay => ({ day: days[index], cents: shares[rank], locked: false })),
  ];
}

/**
 * Follow the shape of a reference curve — its parent's — over a sub-period, for another budget.
 *
 * This is what a node with no explicit budget answers: it has no curve of its own, so it takes the
 * shape of the one above it, pro rata (`../../CADRAGE.md` § 4). When the reference says nothing over
 * that period, the budget is spread evenly rather than refused: a node must always be able to show a
 * curve.
 *
 * @param reference - The reference curve
 * @param days - The days of the sub-period
 * @param totalCents - The budget to spread
 * @returns A curve with the proportions of the reference, every day unlocked
 *
 * @example
 * ```typescript
 * followShape(campaignCurve, listDays('2027-01-10', '2027-01-20'), 50_000);
 * ```
 */
export function followShape(reference: CurveDay[], days: string[], totalCents: number): CurveDay[] {
  const amounts = new Map<string, number>(reference.map((day: CurveDay): [string, number] => [day.day, day.cents]));
  const weights: number[] = days.map((day: string): number => amounts.get(day) ?? 0);
  const usable: number[] = weights.some((weight: number): boolean => weight > 0) ? weights : days.map((): number => 1);
  return curveFromWeights(days, totalCents, usable);
}

/**
 * Map a computed curve to the days the API answers.
 *
 * @param curve - The curve
 * @returns Its days, with the weekend flag an interface needs
 */
export function toBudgetDays(curve: CurveDay[]): BudgetDay[] {
  return curve.map((day: CurveDay): BudgetDay => ({
    day: day.day,
    cents: day.cents,
    locked: day.locked,
    weekend: isWeekend(day.day),
  }));
}

/**
 * Check a period and give its days: ordered, and no longer than {@link MAX_CURVE_DAYS}.
 *
 * The order is checked by `assertWindowOrdered` of the tree, so a reversed window answers the same
 * `dates_reversed` whatever asked for it.
 *
 * @param startsOn - First day
 * @param endsOn - Last day
 * @returns The days of the period
 * @throws Error with status 400 coded `dates_reversed` or `budget_period_too_long`
 *
 * @example
 * ```typescript
 * assertCurvePeriod('2027-01-01', '2027-01-31'); // 31 days
 * ```
 */
export function assertCurvePeriod(startsOn: string, endsOn: string): string[] {
  assertWindowOrdered({ startsOn, endsOn });
  const days: string[] = listDays(startsOn, endsOn);
  if (days.length > MAX_CURVE_DAYS) {
    throw httpError(400, `A curve cannot cover more than ${MAX_CURVE_DAYS} days`, {
      code: 'budget_period_too_long',
      params: { days: days.length, max: MAX_CURVE_DAYS },
    });
  }
  return days;
}

/**
 * Apply the edits of a request to a curve, then rebalance the free days.
 *
 * A day already past may be listed with what it already holds — an interface sending the whole curve
 * back is not making a mistake — but changing it is refused.
 *
 * @param curve - The curve as it stands
 * @param body - The edits
 * @param totalCents - The budget the days must add up to
 * @param today - See {@link isPast}
 * @returns The new curve
 * @throws Error with status 400 coded `budget_day_outside_window`, `budget_day_past`, or one of the
 *   three of {@link rebalance}
 *
 * @example
 * ```typescript
 * applyEdits(curve, { days: [{ day: '2027-01-06', cents: 0, locked: true }] }, 100_000, '2027-01-03');
 * ```
 */
export function applyEdits(
  curve: CurveDay[],
  body: UpdateBudgetDaysBody,
  totalCents: number,
  today: string | null = null
): CurveDay[] {
  const byDay = new Map<string, CurveDay>(curve.map((day: CurveDay): [string, CurveDay] => [day.day, { ...day }]));
  const pinned = new Set<string>();

  for (const edit of body.days) {
    const day: CurveDay | undefined = byDay.get(edit.day);
    if (!day) {
      throw httpError(400, `${edit.day} is outside the window of this node`, {
        code: 'budget_day_outside_window',
        params: { day: edit.day },
      });
    }
    const amountChanges: boolean = edit.cents !== undefined && edit.cents !== day.cents;
    const lockChanges: boolean = edit.locked !== undefined && edit.locked !== day.locked;
    if (isPast(edit.day, today) && (amountChanges || lockChanges)) {
      throw httpError(400, `${edit.day} is past: its amount and its lock no longer change`, {
        code: 'budget_day_past',
        params: { day: edit.day },
      });
    }
    if (edit.cents !== undefined) {
      day.cents = edit.cents;
      pinned.add(edit.day);
    }
    if (edit.locked !== undefined) day.locked = edit.locked;
  }
  return rebalance([...byDay.values()], totalCents, pinned, today);
}
