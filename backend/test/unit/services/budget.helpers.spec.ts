import {
  assertSharesComplete,
  assertWithinParent,
  BudgetChild,
  distributeBudget,
  PlatformBudget,
  ResolvedBudget,
  splitByPlatform,
  volumeToCents,
} from '@src/services/budget.helpers';
import { PlatformShare } from '@src/types';

/**
 * Build a child that inherits its budget.
 *
 * @param id - Its id
 * @returns The child
 */
function inheriting(id: string): BudgetChild {
  return { id, explicitCents: null, carriesBudget: true };
}

/**
 * Build a child carrying an explicit amount.
 *
 * @param id - Its id
 * @param explicitCents - What it carries
 * @returns The child
 */
function explicit(id: string, explicitCents: number): BudgetChild {
  return { id, explicitCents, carriesBudget: true };
}

/**
 * The effective amounts of a division, by id.
 *
 * @param resolved - What `distributeBudget` answered
 * @returns The cents by id
 */
function centsOf(resolved: Map<string, ResolvedBudget>): Record<string, number> {
  return Object.fromEntries(
    [...resolved].map(([id, budget]: [string, ResolvedBudget]): [string, number] => [id, budget.effectiveCents])
  );
}

describe('Unit::Services::BudgetHelpers', () => {
  describe('assertWithinParent', () => {
    it('should accept children that fit, up to the last cent', (): void => {
      expect((): void => assertWithinParent(100_000, 100_000)).not.toThrow();
    });

    it('should refuse children that overflow their parent, saying by how much', (): void => {
      expect((): void => assertWithinParent(100_000, 120_000)).toThrow(
        expect.objectContaining({
          statusCode: 400,
          errorCode: 'budget_exceeds_parent',
          errorParams: { parentCents: 100_000, childrenCents: 120_000 },
        })
      );
    });
  });

  describe('distributeBudget', () => {
    it('should divide equally between siblings that all inherit', (): void => {
      const resolved: Map<string, ResolvedBudget> = distributeBudget(90_000, [
        inheriting('a'),
        inheriting('b'),
        inheriting('c'),
      ]);

      expect(centsOf(resolved)).toEqual({ a: 30_000, b: 30_000, c: 30_000 });
      expect(resolved.get('a')).toEqual({ effectiveCents: 30_000, source: 'inherited' });
    });

    it('should serve the explicit amounts first, the rest sharing what is left', (): void => {
      const resolved: Map<string, ResolvedBudget> = distributeBudget(100_000, [
        explicit('a', 40_000),
        inheriting('b'),
        inheriting('c'),
      ]);

      expect(centsOf(resolved)).toEqual({ a: 40_000, b: 30_000, c: 30_000 });
      expect(resolved.get('a')?.source).toBe('explicit');
      expect(resolved.get('b')?.source).toBe('inherited');
    });

    it('should give the last cents of an uneven share to the first siblings', (): void => {
      const resolved: Map<string, ResolvedBudget> = distributeBudget(100, [
        inheriting('a'),
        inheriting('b'),
        inheriting('c'),
      ]);

      expect(centsOf(resolved)).toEqual({ a: 34, b: 33, c: 33 });
    });

    it('should total exactly the parent, whatever the mix', (): void => {
      const children: BudgetChild[] = [explicit('a', 3_333), inheriting('b'), inheriting('c'), inheriting('d')];

      const resolved: Map<string, ResolvedBudget> = distributeBudget(10_000, children);

      const total: number = [...resolved.values()].reduce(
        (sum: number, budget: ResolvedBudget): number => sum + budget.effectiveCents,
        0
      );
      expect(total).toBe(10_000);
    });

    it('should give nothing to a level the lever forbids a budget to, and not dilute the others', (): void => {
      const resolved: Map<string, ResolvedBudget> = distributeBudget(90_000, [
        inheriting('a'),
        inheriting('b'),
        { id: 'line', explicitCents: null, carriesBudget: false },
      ]);

      expect(centsOf(resolved)).toEqual({ a: 45_000, b: 45_000, line: 0 });
      expect(resolved.get('line')).toEqual({ effectiveCents: 0, source: 'forbidden' });
    });

    it('should ignore an amount written on a forbidden level rather than spend it', (): void => {
      // The services refuse that write (`assertFieldAllowed`); a row that predates the rule must not
      // make the algebra hand out money the level cannot use.
      const resolved: Map<string, ResolvedBudget> = distributeBudget(90_000, [
        inheriting('a'),
        { id: 'line', explicitCents: 50_000, carriesBudget: false },
      ]);

      expect(centsOf(resolved)).toEqual({ a: 90_000, line: 0 });
    });

    it('should refuse explicit amounts that overflow the parent', (): void => {
      expect((): Map<string, ResolvedBudget> =>
        distributeBudget(100_000, [explicit('a', 60_000), explicit('b', 60_000)])
      ).toThrow(expect.objectContaining({ errorCode: 'budget_exceeds_parent' }));
    });

    it('should leave the rest with the parent when every sibling is explicit', (): void => {
      const resolved: Map<string, ResolvedBudget> = distributeBudget(100_000, [explicit('a', 30_000)]);

      expect(centsOf(resolved)).toEqual({ a: 30_000 });
    });

    it('should answer nothing for no children', (): void => {
      expect(distributeBudget(100_000, []).size).toBe(0);
    });
  });

  describe('assertSharesComplete', () => {
    it('should accept a key that totals a hundred percent', (): void => {
      expect((): void =>
        assertSharesComplete([
          { platform: 'hawk', shareBasisPoints: 4_000 },
          { platform: 'dv360', shareBasisPoints: 6_000 },
        ])
      ).not.toThrow();
    });

    it('should refuse a key that does not, saying what it totals', (): void => {
      expect((): void => assertSharesComplete([{ platform: 'hawk', shareBasisPoints: 9_000 }])).toThrow(
        expect.objectContaining({
          statusCode: 400,
          errorCode: 'platform_shares_invalid',
          errorParams: { total: 9_000 },
        })
      );
    });

    it('should refuse the same platform twice', (): void => {
      expect((): void =>
        assertSharesComplete([
          { platform: 'hawk', shareBasisPoints: 5_000 },
          { platform: 'hawk', shareBasisPoints: 5_000 },
        ])
      ).toThrow(expect.objectContaining({ errorCode: 'platform_share_duplicated', errorParams: { platform: 'hawk' } }));
    });
  });

  describe('splitByPlatform', () => {
    it('should split a budget in the proportions of the key', (): void => {
      const split: PlatformBudget[] = splitByPlatform(100_000, [
        { platform: 'hawk', shareBasisPoints: 4_000 },
        { platform: 'dv360', shareBasisPoints: 6_000 },
      ]);

      expect(split).toEqual([
        { platform: 'hawk', shareBasisPoints: 4_000, cents: 40_000 },
        { platform: 'dv360', shareBasisPoints: 6_000, cents: 60_000 },
      ]);
    });

    it('should lose no cent on three platforms that cannot be equal', (): void => {
      const shares: PlatformShare[] = [
        { platform: 'hawk', shareBasisPoints: 3_334 },
        { platform: 'dv360', shareBasisPoints: 3_333 },
        { platform: 'meta', shareBasisPoints: 3_333 },
      ];

      const split: PlatformBudget[] = splitByPlatform(100, shares);

      expect(split.map((budget: PlatformBudget): number => budget.cents)).toEqual([34, 33, 33]);
    });

    it('should keep the order of the key while giving the extra cents to the largest remainders', (): void => {
      const split: PlatformBudget[] = splitByPlatform(10, [
        { platform: 'hawk', shareBasisPoints: 1_000 },
        { platform: 'dv360', shareBasisPoints: 4_500 },
        { platform: 'meta', shareBasisPoints: 4_500 },
      ]);

      expect(split.map((budget: PlatformBudget): string => budget.platform)).toEqual(['hawk', 'dv360', 'meta']);
      expect(split.map((budget: PlatformBudget): number => budget.cents)).toEqual([1, 5, 4]);
    });

    it('should total exactly the budget it was given', (): void => {
      const shares: PlatformShare[] = [
        { platform: 'hawk', shareBasisPoints: 1_667 },
        { platform: 'dv360', shareBasisPoints: 1_667 },
        { platform: 'meta', shareBasisPoints: 1_666 },
        { platform: 'tiktok', shareBasisPoints: 5_000 },
      ];

      for (const cents of [0, 1, 7, 99, 100, 123_457]) {
        const total: number = splitByPlatform(cents, shares).reduce(
          (sum: number, budget: PlatformBudget): number => sum + budget.cents,
          0
        );
        expect({ cents, total }).toEqual({ cents, total: cents });
      }
    });
  });

  describe('volumeToCents', () => {
    it('should convert a volume through the bid CPM', (): void => {
      expect(volumeToCents(500_000, 'impressions', 450)).toBe(225_000);
    });

    it('should round up, so the money always buys at least the volume asked for', (): void => {
      expect(volumeToCents(1, 'plays', 450)).toBe(1);
      expect(volumeToCents(1_001, 'completions', 1_000)).toBe(1_001);
    });

    it('should refuse a volume on a node with no CPM, rather than estimate one', (): void => {
      expect((): number => volumeToCents(500_000, 'impressions', null)).toThrow(
        expect.objectContaining({
          statusCode: 400,
          errorCode: 'volume_without_bid',
          errorParams: { unit: 'impressions' },
        })
      );
    });
  });
});
