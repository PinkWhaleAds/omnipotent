/**
 * @module services/pacing.helpers
 *
 * What to spend today, and how a plan made of our days reads in a platform's timezone
 * (`../../CADRAGE.md` § 4, `docs/phase-4.md` § 4 and § 5).
 *
 * The pacing is **not a job**. It is a pure function, computed inside the synchronization as part of
 * the desired state: a job that "pushed budgets" would be a second source of truth beside the sync,
 * and there is none. The spend it compares against is an **argument**, which is what makes it
 * testable before the reporting phase exists — and what means nothing changes the day real spend
 * arrives.
 *
 * Transcribed from `~/OmniAd/multi-search/backend/src/platforms/pacing.ts`, amounts in cents.
 */
import { AuthContext, Pacing, PacingStatus, SnapshotOrganization } from '@src/types';
import { distributeOverDays } from './budget-curve.helpers';

/** One hour, in milliseconds. */
const HOUR_IN_MS = 3_600_000;

/** How far spend may drift from the plan before it stops being on track. */
const TOLERANCE = 0.1;

/** The timezone a campaign with no timezone of its own, under an Organization with none, counts in. */
const DEFAULT_TIMEZONE = 'UTC';

/** An amount planned for one day. */
export type PlannedDay = {
  /** `YYYY-MM-DD`. */
  day: string;
  /** Amount planned, in cents. */
  cents: number;
};

/**
 * The offset of a timezone at an instant: local wall-clock time minus UTC.
 *
 * Read from the runtime's own timezone data rather than from a table of our own, so a rule that
 * changes — and they do — changes with a Node upgrade instead of with a migration.
 *
 * @param instant - Epoch milliseconds
 * @param timezone - IANA timezone
 * @returns The offset, in milliseconds
 */
function offsetAt(instant: number, timezone: string): number {
  const parts: Intl.DateTimeFormatPart[] = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((entry: Intl.DateTimeFormatPart): boolean => entry.type === type)?.value);
  const local: number = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second')
  );
  return local - Math.floor(instant / 1000) * 1000;
}

/**
 * The calendar day an instant falls on, in a timezone.
 *
 * @param instant - Epoch milliseconds
 * @param timezone - IANA timezone
 * @returns `YYYY-MM-DD`
 */
export function dayAt(instant: number, timezone: string): string {
  return new Date(instant + offsetAt(instant, timezone)).toISOString().slice(0, 10);
}

/**
 * The instant a calendar day starts in a timezone.
 *
 * Guessed twice, because the offset of midnight is not always the offset of the instant before it:
 * where the clocks jump from 23:59 to 01:00 the second guess lands on the day before, and the first
 * is the right one.
 *
 * @param day - `YYYY-MM-DD`
 * @param timezone - IANA timezone
 * @returns Epoch milliseconds of local midnight, or of the first instant of the day when midnight is
 *   skipped
 *
 * @example
 * ```typescript
 * dayStart('2027-03-28', 'Europe/Paris'); // the night the clocks go forward
 * ```
 */
export function dayStart(day: string, timezone: string): number {
  const naive: number = Date.parse(`${day}T00:00:00Z`);
  const first: number = naive - offsetAt(naive, timezone);
  const second: number = naive - offsetAt(first, timezone);
  return dayAt(second, timezone) === day ? second : first;
}

/**
 * The next calendar day.
 *
 * @param day - `YYYY-MM-DD`
 * @returns The day after
 */
export function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 24 * HOUR_IN_MS).toISOString().slice(0, 10);
}

/**
 * A plan written in the days of one timezone, read in the days of another.
 *
 * Each day of the target zone takes the amounts of the days it overlaps, **in proportion to the hours
 * they share** — a platform's day and ours rarely start at the same instant, and a campaign in Paris
 * bought on an account in Los Angeles would otherwise spend the wrong amount every single day. The
 * total stays exact to the cent.
 *
 * Nothing calls this yet: the platforms arrive with their own phases. It is written here because its
 * subtlety belongs to the pacing, and finding it out later would be finding it out too late
 * (`docs/phase-4.md` § 5).
 *
 * @param plan - The planned days, in `from`
 * @param from - Timezone the plan is written in, the campaign's
 * @param to - Timezone to read it in, the ad account's
 * @returns The planned days in `to`, from the day holding the plan's first instant to the one holding
 *   its last
 *
 * @example
 * ```typescript
 * moveToTimezone([{ day: '2027-01-01', cents: 2400 }], 'Europe/Paris', 'America/Los_Angeles');
 * // the 31st takes nine twenty-fourths, the 1st the rest
 * ```
 */
export function moveToTimezone(plan: PlannedDay[], from: string, to: string): PlannedDay[] {
  if (plan.length === 0) return [];
  if (from === to) return plan;

  const shares = new Map<string, number>();
  for (const { day, cents } of plan) {
    const start: number = dayStart(day, from);
    const end: number = dayStart(nextDay(day), from);
    for (let target: string = dayAt(start, to); dayStart(target, to) < end; target = nextDay(target)) {
      const overlap: number = Math.min(end, dayStart(nextDay(target), to)) - Math.max(start, dayStart(target, to));
      if (overlap > 0) shares.set(target, (shares.get(target) ?? 0) + (cents * overlap) / (end - start));
    }
  }

  const days: string[] = [...shares.keys()].sort();
  const total: number = plan.reduce((sum: number, day: PlannedDay): number => sum + day.cents, 0);
  const cents: number[] =
    total > 0
      ? distributeOverDays(
          total,
          days.map((day: string): number => shares.get(day) as number)
        )
      : days.map((): number => 0);
  return days.map((day: string, index: number): PlannedDay => ({ day, cents: cents[index] }));
}

/**
 * Where the spend stands against what the plan expected by now.
 *
 * @param plannedToDateCents - What the plan expected before today
 * @param spentCents - What was spent on those days
 * @param budgetReached - Whether the planned total is spent
 * @returns The status, within a tolerance of ten percent
 */
function pacingStatus(plannedToDateCents: number, spentCents: number, budgetReached: boolean): PacingStatus {
  if (budgetReached) return 'budget_reached';
  if (spentCents > plannedToDateCents * (1 + TOLERANCE)) return 'overspending';
  if (spentCents < plannedToDateCents * (1 - TOLERANCE)) return 'underspending';
  return 'on_track';
}

/**
 * What to spend today: what is left of the plan after the spend of the days before, spread over today
 * and the days after **in the shape of the plan**.
 *
 * A day planned at 0 keeps 0 — the shape is an intention, and catching up must not make a paused day
 * deliver. Once the spend reaches the planned total, today is 0 and delivery stops.
 *
 * @param plan - The planned days, in the timezone the spend is counted in
 * @param spentBeforeTodayCents - What was spent before today; `0` until the reporting phase feeds it
 * @param today - Today, in that same timezone
 * @returns The pacing of the day
 *
 * @example
 * ```typescript
 * paceDay(plan, 0, '2027-01-03'); // a plan nobody has spent against yet: on_track
 * ```
 */
export function paceDay(plan: PlannedDay[], spentBeforeTodayCents: number, today: string): Pacing {
  const plannedCents: number = plan.reduce((sum: number, day: PlannedDay): number => sum + day.cents, 0);
  const plannedToDateCents: number = plan
    .filter((day: PlannedDay): boolean => day.day < today)
    .reduce((sum: number, day: PlannedDay): number => sum + day.cents, 0);
  const remainingCents: number = Math.max(0, plannedCents - spentBeforeTodayCents);
  const budgetReached: boolean = remainingCents === 0 && (plannedCents > 0 || spentBeforeTodayCents > 0);

  const ahead: PlannedDay[] = plan.filter((day: PlannedDay): boolean => day.day >= today);
  const weight: number = ahead.reduce((sum: number, day: PlannedDay): number => sum + day.cents, 0);
  const todayWeight: number = plan.find((day: PlannedDay): boolean => day.day === today)?.cents ?? 0;
  const todayCents: number = weight > 0 ? Math.floor((remainingCents * todayWeight) / weight) : 0;

  return {
    plannedCents,
    plannedToDateCents,
    remainingCents,
    todayCents,
    budgetReached,
    status: pacingStatus(plannedToDateCents, spentBeforeTodayCents, budgetReached),
  };
}

/**
 * The timezone a campaign counts its days in: its own, else its Organization's, else UTC.
 *
 * The Organization's comes from the snapshot omnipass resolved for the request — nothing here reads a
 * tenancy table, which omnipass alone owns (T5). A **job has no actor**, and passes `null`: by then
 * the campaign carries its own, because the launch stamps it (`docs/phase-9.md` § 3). That is what
 * stops a change of the Organization's timezone from retroactively moving the days of a campaign
 * already delivering.
 *
 * @param own - The campaign's own timezone, `null` when it has none
 * @param actor - The caller, whose snapshot carries the Organization's timezone; `null` in a job
 * @param organizationId - The Organization
 * @returns An IANA timezone
 *
 * @example
 * ```typescript
 * resolveCampaignTimezone(null, actor, organizationId); // 'Europe/Paris', the Organization's
 * ```
 */
export function resolveCampaignTimezone(own: string | null, actor: AuthContext | null, organizationId: string): string {
  if (own !== null) return own;
  const organization: SnapshotOrganization | undefined = actor?.tenancy.organizations.find(
    (candidate: SnapshotOrganization): boolean => candidate.id === organizationId
  );
  return organization?.timezone ?? DEFAULT_TIMEZONE;
}

/**
 * The instant of the next local midnight in a timezone.
 *
 * What a campaign's daily appointment is set to (D34 rule 2): the day's budget is recomputed when
 * **its own** day turns over, not when a UTC clock does.
 *
 * @param at - Where to count from, in epoch milliseconds
 * @param timezone - IANA timezone
 * @returns The instant the next local day starts
 *
 * @example
 * ```typescript
 * nextLocalMidnight(Date.now(), 'Europe/Paris');
 * ```
 */
export function nextLocalMidnight(at: number, timezone: string): Date {
  return new Date(dayStart(nextDay(dayAt(at, timezone)), timezone));
}
