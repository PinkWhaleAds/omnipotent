import {
  dayAt,
  dayStart,
  moveToTimezone,
  nextDay,
  nextAppointment,
  nextLocalMidnight,
  paceDay,
  PlannedDay,
  resolveCampaignTimezone,
  startInstant,
} from '@src/services/pacing.helpers';
import { Pacing } from '@src/types';
import { IDS, JANE } from '@test/unit/mocks/auth.fixtures';

/** A plan of four days at 100 €, in the timezone of the campaign. */
const PLAN: PlannedDay[] = [
  { day: '2027-01-01', cents: 10_000 },
  { day: '2027-01-02', cents: 10_000 },
  { day: '2027-01-03', cents: 10_000 },
  { day: '2027-01-04', cents: 10_000 },
];

/**
 * The total of a plan, in cents.
 *
 * @param plan - The planned days
 * @returns Their total
 */
function total(plan: PlannedDay[]): number {
  return plan.reduce((sum: number, day: PlannedDay): number => sum + day.cents, 0);
}

describe('Unit::Services::PacingHelpers', () => {
  describe('dayAt and dayStart', () => {
    it('should give the calendar day of an instant in a timezone', (): void => {
      // 23:30 UTC on the 1st is already the 2nd in Paris.
      expect(dayAt(Date.parse('2027-01-01T23:30:00Z'), 'Europe/Paris')).toBe('2027-01-02');
      expect(dayAt(Date.parse('2027-01-01T23:30:00Z'), 'America/Los_Angeles')).toBe('2027-01-01');
    });

    it('should give the instant a day starts at, and round-trip it', (): void => {
      expect(new Date(dayStart('2027-01-02', 'Europe/Paris')).toISOString()).toBe('2027-01-01T23:00:00.000Z');
      for (const zone of ['Europe/Paris', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Kiritimati']) {
        expect(dayAt(dayStart('2027-06-15', zone), zone)).toBe('2027-06-15');
      }
    });

    it('should take the first instant of a day whose midnight does not exist', (): void => {
      // Chile moves its clocks forward at midnight: the 7th of September 2025 starts at 01:00 local.
      const start: number = dayStart('2025-09-07', 'America/Santiago');

      expect(dayAt(start, 'America/Santiago')).toBe('2025-09-07');
      expect(new Date(start).toISOString()).toBe('2025-09-07T04:00:00.000Z');
    });

    it('should walk to the next day across a month and a year', (): void => {
      expect(nextDay('2027-01-31')).toBe('2027-02-01');
      expect(nextDay('2027-12-31')).toBe('2028-01-01');
      expect(nextDay('2028-02-28')).toBe('2028-02-29');
    });
  });

  describe('moveToTimezone', () => {
    it('should give back the same plan when the zones are the same', (): void => {
      expect(moveToTimezone(PLAN, 'Europe/Paris', 'Europe/Paris')).toBe(PLAN);
    });

    it('should give back nothing for an empty plan', (): void => {
      expect(moveToTimezone([], 'Europe/Paris', 'America/Los_Angeles')).toEqual([]);
    });

    it('should spread each of our days over the platform days it overlaps', (): void => {
      // Paris is nine hours ahead of Los Angeles in January: our day covers the last nine hours of
      // the day before, there, and the first fifteen of the matching one.
      const moved: PlannedDay[] = moveToTimezone(
        [{ day: '2027-01-02', cents: 24_000 }],
        'Europe/Paris',
        'America/Los_Angeles'
      );

      expect(moved).toEqual([
        { day: '2027-01-01', cents: 9_000 },
        { day: '2027-01-02', cents: 15_000 },
      ]);
    });

    it('should keep the total exact to the cent', (): void => {
      const moved: PlannedDay[] = moveToTimezone(PLAN, 'Europe/Paris', 'Pacific/Kiritimati');

      expect(total(moved)).toBe(total(PLAN));
    });

    it('should move a plan of nothing without inventing a cent', (): void => {
      const moved: PlannedDay[] = moveToTimezone(
        [
          { day: '2027-01-01', cents: 0 },
          { day: '2027-01-02', cents: 0 },
        ],
        'Europe/Paris',
        'America/Los_Angeles'
      );

      expect(total(moved)).toBe(0);
      expect(moved.length).toBeGreaterThan(0);
    });
  });

  describe('paceDay', () => {
    it('should plan the day ahead when nothing has been spent yet', (): void => {
      const pacing: Pacing = paceDay(PLAN, 0, '2027-01-01');

      expect(pacing).toEqual({
        plannedCents: 40_000,
        plannedToDateCents: 0,
        remainingCents: 40_000,
        todayCents: 10_000,
        budgetReached: false,
        status: 'on_track',
      });
    });

    it('should raise the day when the spend is behind the plan', (): void => {
      // Two days planned at 100 € each are past, 50 € was spent: the 200 € left spread over two days.
      const pacing: Pacing = paceDay(PLAN, 5_000, '2027-01-03');

      expect(pacing.plannedToDateCents).toBe(20_000);
      expect(pacing.remainingCents).toBe(35_000);
      expect(pacing.todayCents).toBe(17_500);
      expect(pacing.status).toBe('underspending');
    });

    it('should lower the day when the spend has run ahead', (): void => {
      const pacing: Pacing = paceDay(PLAN, 30_000, '2027-01-03');

      expect(pacing.todayCents).toBe(5_000);
      expect(pacing.status).toBe('overspending');
    });

    it('should stay on track within a tenth of the plan', (): void => {
      expect(paceDay(PLAN, 21_000, '2027-01-03').status).toBe('on_track');
      expect(paceDay(PLAN, 19_000, '2027-01-03').status).toBe('on_track');
    });

    it('should stop the delivery once the planned total is spent', (): void => {
      const pacing: Pacing = paceDay(PLAN, 40_000, '2027-01-03');

      expect(pacing).toMatchObject({
        remainingCents: 0,
        todayCents: 0,
        budgetReached: true,
        status: 'budget_reached',
      });
    });

    it('should never answer a negative remainder', (): void => {
      expect(paceDay(PLAN, 100_000, '2027-01-03').remainingCents).toBe(0);
    });

    it('should keep a day planned at zero at zero, catching up or not', (): void => {
      const withPause: PlannedDay[] = [
        { day: '2027-01-01', cents: 10_000 },
        { day: '2027-01-02', cents: 0 },
        { day: '2027-01-03', cents: 10_000 },
      ];

      expect(paceDay(withPause, 0, '2027-01-02').todayCents).toBe(0);
      expect(paceDay(withPause, 0, '2027-01-03').todayCents).toBe(20_000);
    });

    it('should answer nothing for a day outside the plan', (): void => {
      expect(paceDay(PLAN, 0, '2027-02-01')).toMatchObject({ todayCents: 0, budgetReached: false });
    });

    it('should answer nothing for an empty plan nobody spent against', (): void => {
      expect(paceDay([], 0, '2027-01-01')).toEqual({
        plannedCents: 0,
        plannedToDateCents: 0,
        remainingCents: 0,
        todayCents: 0,
        budgetReached: false,
        status: 'on_track',
      });
    });

    it('should call a plan that vanished after a spend reached, not on track', (): void => {
      // An AdGroup or a platform was removed: nothing is planned any more, but money went out.
      expect(paceDay([], 5_000, '2027-01-01')).toMatchObject({ budgetReached: true, status: 'budget_reached' });
    });
  });
  describe('resolveCampaignTimezone', () => {
    it('should prefer the timezone the campaign names', (): void => {
      expect(resolveCampaignTimezone('America/Los_Angeles', JANE, IDS.organization)).toBe('America/Los_Angeles');
    });

    it('should fall back to the Organization of the caller', (): void => {
      // From the snapshot omnipass resolved for this request: nothing here reads a tenancy table (T5).
      expect(resolveCampaignTimezone(null, JANE, IDS.organization)).toBe('Europe/Paris');
    });

    it('should fall back to UTC in a job, which has no caller', (): void => {
      // By then the campaign names its own: the launch stamps it (`docs/phase-9.md` § 3).
      expect(resolveCampaignTimezone(null, null, IDS.organization)).toBe('UTC');
    });

    it('should fall back to UTC for an Organization the snapshot does not carry', (): void => {
      expect(resolveCampaignTimezone(null, JANE, 'another-organization')).toBe('UTC');
    });
  });

  describe('startInstant', () => {
    it('should answer the first day at its start time, in the campaign timezone', (): void => {
      expect(new Date(startInstant('2027-01-04', '09:30', 'Europe/Paris')).toISOString()).toBe(
        '2027-01-04T08:30:00.000Z'
      );
      expect(new Date(startInstant('2027-07-01', '09:30', 'Europe/Paris')).toISOString()).toBe(
        '2027-07-01T07:30:00.000Z'
      );
    });

    it('should start at midnight without a start time', (): void => {
      expect(new Date(startInstant('2027-01-04', null, 'Europe/Paris')).toISOString()).toBe('2027-01-03T23:00:00.000Z');
    });

    it('should land a time the clocks skip an hour early, and take the second of a time they repeat', (): void => {
      // 02:30 does not exist in Paris on 2027-03-28; it does twice on 2027-10-31.
      expect(new Date(startInstant('2027-03-28', '02:30', 'Europe/Paris')).toISOString()).toBe(
        '2027-03-28T00:30:00.000Z'
      );
      expect(new Date(startInstant('2027-10-31', '02:30', 'Europe/Paris')).toISOString()).toBe(
        '2027-10-31T01:30:00.000Z'
      );
    });
  });

  describe('nextAppointment', () => {
    const DAILY: Date = new Date('2027-01-04T23:00:00.000Z');
    const NOW_MS: number = Date.parse('2027-01-04T06:00:00.000Z');

    it('should wake a campaign at its start when that comes before its daily appointment', (): void => {
      expect(nextAppointment(DAILY, Date.parse('2027-01-04T08:30:00.000Z'), NOW_MS).toISOString()).toBe(
        '2027-01-04T08:30:00.000Z'
      );
    });

    it('should keep the daily appointment once the start has passed, or when it comes later', (): void => {
      expect(nextAppointment(DAILY, Date.parse('2027-01-03T08:30:00.000Z'), NOW_MS)).toBe(DAILY);
      expect(nextAppointment(DAILY, Date.parse('2027-01-06T08:30:00.000Z'), NOW_MS)).toBe(DAILY);
    });
  });

  describe('nextLocalMidnight', () => {
    it('should answer the instant the next local day starts', (): void => {
      expect(nextLocalMidnight(Date.parse('2027-01-03T10:00:00.000Z'), 'Europe/Paris').toISOString()).toBe(
        '2027-01-03T23:00:00.000Z'
      );
      expect(nextLocalMidnight(Date.parse('2027-01-03T10:00:00.000Z'), 'UTC').toISOString()).toBe(
        '2027-01-04T00:00:00.000Z'
      );
    });

    it('should answer a day away for a zone where the day has already turned', (): void => {
      // In Auckland it is already the fourth: the next midnight is the fifth, local.
      expect(nextLocalMidnight(Date.parse('2027-01-03T20:00:00.000Z'), 'Pacific/Auckland').toISOString()).toBe(
        '2027-01-04T11:00:00.000Z'
      );
    });
  });
});
