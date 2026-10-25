import { dayAt, dayStart, moveToTimezone, nextDay, paceDay, PlannedDay } from '@src/services/pacing.helpers';
import { Pacing } from '@src/types';

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
});
