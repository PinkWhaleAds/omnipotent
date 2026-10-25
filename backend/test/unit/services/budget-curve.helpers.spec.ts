import {
  applyEdits,
  assertCurvePeriod,
  curveFromWeights,
  CurveDay,
  distributeOverDays,
  followShape,
  isPast,
  isWeekend,
  listDays,
  presetCurve,
  presetWeights,
  rebalance,
  completeCurve,
  sumCents,
  toBudgetDays,
  weekdayOf,
} from '@src/services/budget-curve.helpers';
import { BudgetDay } from '@src/types';

/** A week of January 2027: the 1st is a Friday, so the 2nd and the 3rd are the weekend. */
const WEEK: string[] = listDays('2027-01-01', '2027-01-07');

/**
 * Build a curve from amounts, in order over {@link WEEK}.
 *
 * @param cents - One amount per day
 * @param locked - The days to lock
 * @returns The curve
 */
function curve(cents: number[], locked: string[] = []): CurveDay[] {
  return cents.map((amount: number, index: number): CurveDay => ({
    day: WEEK[index],
    cents: amount,
    locked: locked.includes(WEEK[index]),
  }));
}

/**
 * The amounts of a curve, in order.
 *
 * @param days - The curve
 * @returns Its amounts
 */
function amounts(days: CurveDay[]): number[] {
  return days.map((day: CurveDay): number => day.cents);
}

describe('Unit::Services::BudgetCurveHelpers', () => {
  describe('listDays', () => {
    it('should list every day of a period, both ends included', (): void => {
      expect(listDays('2027-01-30', '2027-02-01')).toEqual(['2027-01-30', '2027-01-31', '2027-02-01']);
      expect(listDays('2027-01-01', '2027-01-01')).toEqual(['2027-01-01']);
    });

    it('should cross a leap day without skipping it', (): void => {
      expect(listDays('2028-02-28', '2028-03-01')).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
    });

    it('should list nothing when the end is before the start', (): void => {
      expect(listDays('2027-02-01', '2027-01-01')).toEqual([]);
    });
  });

  describe('weekdayOf and isWeekend', () => {
    it('should name the weekday of a day', (): void => {
      expect(weekdayOf('2027-01-01')).toBe('friday');
      expect(weekdayOf('2027-01-02')).toBe('saturday');
      expect(weekdayOf('2027-01-03')).toBe('sunday');
      expect(weekdayOf('2027-01-04')).toBe('monday');
    });

    it('should call a Saturday and a Sunday the weekend, and nothing else', (): void => {
      expect(WEEK.filter(isWeekend)).toEqual(['2027-01-02', '2027-01-03']);
    });
  });

  describe('isPast', () => {
    it('should freeze the days before today of a launched campaign', (): void => {
      expect(isPast('2027-01-01', '2027-01-02')).toBe(true);
      expect(isPast('2027-01-02', '2027-01-02')).toBe(false);
      expect(isPast('2027-01-03', '2027-01-02')).toBe(false);
    });

    it('should freeze nothing in a draft', (): void => {
      expect(isPast('2020-01-01', null)).toBe(false);
    });
  });

  describe('distributeOverDays', () => {
    it('should split exactly, the last cents going to the largest remainders', (): void => {
      expect(distributeOverDays(1_000, [1, 1, 1])).toEqual([334, 333, 333]);
      expect(distributeOverDays(100, [1, 3])).toEqual([25, 75]);
    });

    it('should always add up to what it was given', (): void => {
      for (const total of [0, 1, 7, 99, 100_000, 123_457]) {
        expect(sumCents(curveFromWeights(WEEK, total, [1, 2, 3, 1, 1, 1, 1]))).toBe(total);
      }
    });

    it('should give nothing to anyone when there is nothing to give', (): void => {
      expect(distributeOverDays(0, [0, 0])).toEqual([0, 0]);
    });

    it('should refuse to place a budget no day can take', (): void => {
      expect((): number[] => distributeOverDays(10_000, [0, 0])).toThrow(
        expect.objectContaining({
          statusCode: 400,
          errorCode: 'budget_no_free_day',
          errorParams: { remainingCents: 10_000 },
        })
      );
    });
  });

  describe('presetWeights', () => {
    it('should weigh every day the same by default', (): void => {
      expect(presetWeights(WEEK, 'flat')).toEqual([1, 1, 1, 1, 1, 1, 1]);
    });

    it('should weigh a weekend day more, by the factor it is given', (): void => {
      expect(presetWeights(WEEK, 'weekend_boost')).toEqual([1, 1.5, 1.5, 1, 1, 1, 1]);
      expect(presetWeights(WEEK, 'weekend_boost', { factor: 3 })).toEqual([1, 3, 3, 1, 1, 1, 1]);
    });

    it('should climb over the first quarter of the period', (): void => {
      const weights: number[] = presetWeights(WEEK, 'ramp_up');

      expect(weights[0]).toBeLessThan(weights[1]);
      expect(weights.slice(2)).toEqual([1, 1, 1, 1, 1]);
    });

    it('should let only the chosen weekdays deliver', (): void => {
      // « Pas de samedi » : the Saturday weighs nothing, so it will hold nothing.
      expect(presetWeights(WEEK, 'selected_days', { weekdays: ['monday', 'friday'] })).toEqual([1, 0, 0, 1, 0, 0, 0]);
    });

    it('should let nothing deliver when the list is empty', (): void => {
      expect(presetWeights(WEEK, 'selected_days')).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });

    it('should take a named day out of any shape', (): void => {
      // « Pas le 2 janvier », whatever its weekday and whatever the shape.
      expect(presetWeights(WEEK, 'flat', { excludedDays: ['2027-01-02'] })).toEqual([1, 0, 1, 1, 1, 1, 1]);
      expect(presetWeights(WEEK, 'weekend_boost', { excludedDays: ['2027-01-02'] })).toEqual([1, 0, 1.5, 1, 1, 1, 1]);
    });

    it('should compose a named day with the weekdays that deliver', (): void => {
      // « Du lundi au vendredi, mais pas le 4 janvier » — a bank holiday that falls on a Monday.
      expect(
        presetWeights(WEEK, 'selected_days', {
          weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
          excludedDays: ['2027-01-04'],
        })
      ).toEqual([1, 0, 0, 0, 1, 1, 1]);
    });
  });

  describe('rebalance', () => {
    it('should spread a new budget in the proportions the days already had', (): void => {
      const rebalanced: CurveDay[] = rebalance(curve([2_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000]), 16_000);

      expect(amounts(rebalanced)).toEqual([4_000, 2_000, 2_000, 2_000, 2_000, 2_000, 2_000]);
    });

    it('should leave a locked day alone, three recalculations in a row', (): void => {
      let current: CurveDay[] = curve([5_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000], ['2027-01-01']);

      for (const budget of [12_000, 20_000, 11_000]) {
        current = rebalance(current, budget);
        expect(current[0].cents).toBe(5_000);
        expect(sumCents(current)).toBe(budget);
      }
    });

    it('should leave a day already past alone', (): void => {
      const rebalanced: CurveDay[] = rebalance(
        curve([3_000, 3_000, 1_000, 1_000, 1_000, 1_000, 1_000]),
        14_000,
        new Set(),
        '2027-01-03'
      );

      expect(amounts(rebalanced).slice(0, 2)).toEqual([3_000, 3_000]);
      expect(sumCents(rebalanced)).toBe(14_000);
    });

    it('should keep a day the request pinned, without locking it', (): void => {
      const rebalanced: CurveDay[] = rebalance(
        curve([1_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000]),
        13_000,
        new Set(['2027-01-04'])
      );

      expect(rebalanced[3]).toEqual({ day: '2027-01-04', cents: 1_000, locked: false });
      expect(sumCents(rebalanced)).toBe(13_000);
    });

    it('should keep a day at zero at zero: a pause is an intention', (): void => {
      const rebalanced: CurveDay[] = rebalance(curve([1_000, 0, 1_000, 1_000, 1_000, 1_000, 1_000]), 60_000);

      expect(rebalanced[1].cents).toBe(0);
      expect(sumCents(rebalanced)).toBe(60_000);
    });

    it('should refuse a budget smaller than what the past days hold', (): void => {
      expect((): CurveDay[] =>
        rebalance(curve([5_000, 5_000, 1_000, 1_000, 1_000, 1_000, 1_000]), 8_000, new Set(), '2027-01-03')
      ).toThrow(
        expect.objectContaining({
          statusCode: 400,
          errorCode: 'budget_below_past_days',
          errorParams: { pastCents: 10_000, budgetCents: 8_000 },
        })
      );
    });

    it('should refuse a budget the locked days alone exceed', (): void => {
      expect((): CurveDay[] =>
        rebalance(curve([9_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000], ['2027-01-01']), 5_000)
      ).toThrow(expect.objectContaining({ errorCode: 'budget_fixed_days_exceed' }));
    });

    it('should refuse to place what is left when every free day is locked or at zero', (): void => {
      expect((): CurveDay[] => rebalance(curve([1_000, 0, 0, 0, 0, 0, 0], ['2027-01-01']), 5_000)).toThrow(
        expect.objectContaining({ errorCode: 'budget_no_free_day' })
      );
    });
  });

  describe('completeCurve', () => {
    it('should spread a budget evenly when nothing is stored', (): void => {
      const completed: CurveDay[] = completeCurve([], listDays('2027-01-01', '2027-01-07'), 70_000);

      expect(amounts(completed)).toEqual([10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000]);
    });

    it('should keep the shape that was stored, which is the point of having shaped it', (): void => {
      const stored: CurveDay[] = curve([40_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000], ['2027-01-01']);

      const completed: CurveDay[] = completeCurve(stored, WEEK, 70_000);

      expect(amounts(completed)).toEqual([40_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000]);
      expect(completed[0].locked).toBe(true);
    });

    it('should answer the same shape for a budget that changed, without writing anything', (): void => {
      const stored: CurveDay[] = curve([2_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000]);

      const completed: CurveDay[] = completeCurve(stored, WEEK, 16_000);

      expect(amounts(completed)).toEqual([4_000, 2_000, 2_000, 2_000, 2_000, 2_000, 2_000]);
    });

    it('should let a day that appeared in the window enter as an average day', (): void => {
      const stored: CurveDay[] = [{ day: '2027-01-01', cents: 2_000, locked: false }];

      const completed: CurveDay[] = completeCurve(stored, listDays('2027-01-01', '2027-01-02'), 2_000);

      expect(amounts(completed)).toEqual([1_000, 1_000]);
    });

    it('should make room for a day that appeared without flattening the shape', (): void => {
      const stored: CurveDay[] = curve([40_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000]);

      const completed: CurveDay[] = completeCurve(stored, listDays('2027-01-01', '2027-01-08'), 70_000);

      expect(amounts(completed)).toEqual([35_000, 4_375, 4_375, 4_375, 4_375, 4_375, 4_375, 8_750]);
      expect(sumCents(completed)).toBe(70_000);
    });

    it('should drop the days the window no longer covers', (): void => {
      const completed: CurveDay[] = completeCurve(
        curve([1_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000]),
        listDays('2027-01-01', '2027-01-02'),
        4_000
      );

      expect(completed).toHaveLength(2);
      expect(sumCents(completed)).toBe(4_000);
    });

    it('should spread a budget evenly over a window whose days are already past', (): void => {
      // A past day is frozen at what the curve says it carried: a node nobody ever shaped must not
      // freeze its past days at a token amount and pile its budget on the days left.
      const completed: CurveDay[] = completeCurve([], WEEK, 70_000, '2027-01-06');

      expect(amounts(completed)).toEqual([10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000]);
    });

    it('should keep a day already past at what it spent', (): void => {
      const completed: CurveDay[] = completeCurve(
        curve([3_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000]),
        WEEK,
        15_000,
        '2027-01-02'
      );

      expect(completed[0].cents).toBe(3_000);
      expect(sumCents(completed)).toBe(15_000);
    });
  });

  describe('presetCurve', () => {
    it('should reshape the days from today on, and release their lock', (): void => {
      const previous: CurveDay[] = curve([1_000, 1_000, 1_000, 9_000, 1_000, 1_000, 1_000], ['2027-01-04']);

      const reshaped: CurveDay[] = presetCurve(previous, WEEK, 14_000, { preset: 'flat' }, '2027-01-03');

      expect(amounts(reshaped).slice(0, 2)).toEqual([1_000, 1_000]);
      expect(reshaped.every((day: CurveDay): boolean => !day.locked || day.day < '2027-01-03')).toBe(true);
      expect(sumCents(reshaped)).toBe(14_000);
    });

    it('should reshape every day of a draft', (): void => {
      const reshaped: CurveDay[] = presetCurve(curve([1, 1, 1, 1, 1, 1, 1]), WEEK, 70_000, { preset: 'flat' }, null);

      expect(amounts(reshaped)).toEqual([10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000]);
    });

    it('should leave a Saturday at nothing when it is not a chosen day', (): void => {
      const reshaped: CurveDay[] = presetCurve(
        curve([1, 1, 1, 1, 1, 1, 1]),
        WEEK,
        50_000,
        { preset: 'selected_days', weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] },
        null
      );

      expect(reshaped.filter((day: CurveDay): boolean => isWeekend(day.day)).map(amountsOf)).toEqual([0, 0]);
      expect(sumCents(reshaped)).toBe(50_000);
    });

    it('should leave a named day at nothing, and spread the rest', (): void => {
      const reshaped: CurveDay[] = presetCurve(
        curve([1, 1, 1, 1, 1, 1, 1]),
        WEEK,
        60_000,
        { preset: 'flat', excludedDays: ['2027-01-02'] },
        null
      );

      expect(amounts(reshaped)).toEqual([10_000, 0, 10_000, 10_000, 10_000, 10_000, 10_000]);
    });

    it('should refuse a shape that leaves no day able to deliver', (): void => {
      expect((): CurveDay[] =>
        presetCurve(
          curve([1, 1]),
          listDays('2027-01-02', '2027-01-03'),
          10_000,
          { preset: 'selected_days', weekdays: ['monday'] },
          null
        )
      ).toThrow(expect.objectContaining({ errorCode: 'budget_no_free_day' }));
    });

    it('should refuse a preset on a budget the past days exceed', (): void => {
      expect((): CurveDay[] =>
        presetCurve(
          curve([9_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000]),
          WEEK,
          5_000,
          { preset: 'flat' },
          '2027-01-02'
        )
      ).toThrow(expect.objectContaining({ errorCode: 'budget_below_past_days' }));
    });

    it('should give a past day the preset never saw nothing', (): void => {
      const reshaped: CurveDay[] = presetCurve([], WEEK, 60_000, { preset: 'flat' }, '2027-01-02');

      expect(reshaped[0]).toEqual({ day: '2027-01-01', cents: 0, locked: false });
      expect(sumCents(reshaped)).toBe(60_000);
    });
  });

  describe('followShape', () => {
    it('should take the proportions of the reference over the sub-period', (): void => {
      const reference: CurveDay[] = curve([3_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000]);

      const followed: CurveDay[] = followShape(reference, listDays('2027-01-01', '2027-01-03'), 10_000);

      expect(amounts(followed)).toEqual([6_000, 2_000, 2_000]);
      expect(followed.every((day: CurveDay): boolean => !day.locked)).toBe(true);
    });

    it('should spread evenly when the reference says nothing over that period', (): void => {
      const followed: CurveDay[] = followShape(
        curve([0, 0, 0, 0, 0, 0, 0]),
        listDays('2027-01-01', '2027-01-02'),
        10_000
      );

      expect(amounts(followed)).toEqual([5_000, 5_000]);
    });

    it('should spread evenly over days the reference does not know', (): void => {
      const followed: CurveDay[] = followShape(curve([1_000]), listDays('2027-03-01', '2027-03-02'), 10_000);

      expect(amounts(followed)).toEqual([5_000, 5_000]);
    });
  });

  describe('toBudgetDays', () => {
    it('should flag the weekend, for an interface to show it', (): void => {
      const days: BudgetDay[] = toBudgetDays(curve([1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000], ['2027-01-05']));

      expect(days[0]).toEqual({ day: '2027-01-01', cents: 1_000, locked: false, weekend: false });
      expect(days[1].weekend).toBe(true);
      expect(days[4].locked).toBe(true);
    });
  });

  describe('assertCurvePeriod', () => {
    it('should give the days of a period', (): void => {
      expect(assertCurvePeriod('2027-01-01', '2027-01-03')).toHaveLength(3);
    });

    it('should refuse a window that ends before it starts, with the code of the tree', (): void => {
      expect((): string[] => assertCurvePeriod('2027-01-03', '2027-01-01')).toThrow(
        expect.objectContaining({ statusCode: 400, errorCode: 'dates_reversed' })
      );
    });

    it('should refuse a period longer than two years', (): void => {
      expect((): string[] => assertCurvePeriod('2027-01-01', '2029-01-01')).toThrow(
        expect.objectContaining({ errorCode: 'budget_period_too_long', errorParams: { days: 732, max: 731 } })
      );
    });
  });

  describe('applyEdits', () => {
    it('should pin an edited day and let the others absorb the difference', (): void => {
      const edited: CurveDay[] = applyEdits(
        curve([1_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000]),
        { days: [{ day: '2027-01-01', cents: 4_000 }] },
        7_000
      );

      expect(edited[0].cents).toBe(4_000);
      expect(sumCents(edited)).toBe(7_000);
    });

    it('should lock and unlock a day without changing its amount', (): void => {
      const locked: CurveDay[] = applyEdits(
        curve([1_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000]),
        { days: [{ day: '2027-01-02', locked: true }] },
        7_000
      );

      expect(locked[1]).toEqual({ day: '2027-01-02', cents: 1_000, locked: true });
    });

    it('should accept a past day sent back unchanged: a front may send the whole curve', (): void => {
      const edited: CurveDay[] = applyEdits(
        curve([2_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000]),
        { days: [{ day: '2027-01-01', cents: 2_000, locked: false }] },
        8_000,
        '2027-01-03'
      );

      expect(edited[0].cents).toBe(2_000);
    });

    it('should refuse changing the amount or the lock of a past day', (): void => {
      for (const edit of [
        { day: '2027-01-01', cents: 5_000 },
        { day: '2027-01-01', locked: true },
      ]) {
        expect((): CurveDay[] =>
          applyEdits(curve([2_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000]), { days: [edit] }, 8_000, '2027-01-03')
        ).toThrow(
          expect.objectContaining({
            statusCode: 400,
            errorCode: 'budget_day_past',
            errorParams: { day: '2027-01-01' },
          })
        );
      }
    });

    it('should refuse a day outside the window of the node', (): void => {
      expect((): CurveDay[] =>
        applyEdits(
          curve([1_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000]),
          { days: [{ day: '2027-02-01', cents: 1 }] },
          7_000
        )
      ).toThrow(
        expect.objectContaining({
          statusCode: 400,
          errorCode: 'budget_day_outside_window',
          errorParams: { day: '2027-02-01' },
        })
      );
    });
  });
});

/**
 * The amount of one day, for a filter that reads better than an inline arrow.
 *
 * @param day - The day
 * @returns Its amount in cents
 */
function amountsOf(day: CurveDay): number {
  return day.cents;
}
