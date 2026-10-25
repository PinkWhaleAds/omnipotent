/**
 * @module services/budget.helpers
 *
 * The algebra of the budget (`../../CADRAGE.md` § 4, D8), as **pure functions**: inheritance by
 * equal division, explicit amounts served first, the `Σ children ≤ parent` invariant, and the
 * per-platform split. No database, no entity, no request — so it is tested exhaustively on its own,
 * and every service, job and preview of every later phase computes the same numbers.
 *
 * Everything is in **integer cents**, in campaign currency, and platform-agnostic. Nothing here is
 * ever stored: a resolved budget is false as soon as a sibling changes, and a stored one would need a
 * job to catch up — that is, a second source of truth (§ 4, the same doctrine as the pacing).
 */
import { PlatformShare, SHARE_TOTAL_BASIS_POINTS, VolumeUnit } from '@src/types';
import { httpError } from '@utils';

/** Impressions one CPM buys: a CPM is the price of a thousand. */
const IMPRESSIONS_PER_CPM = 1000;

/** Where the effective budget of a node comes from. */
export type BudgetSource = 'explicit' | 'inherited' | 'forbidden';

/**
 * One child in a division.
 *
 * @property id - Anything identifying the child; the result is keyed by it
 * @property explicitCents - The amount it carries, `null` when it inherits
 * @property carriesBudget - Whether the lever profile lets a budget reach that level
 *   (`carriesBudget` of `src/levers/lever-profiles.ts`)
 */
export type BudgetChild = {
  id: string;
  explicitCents: number | null;
  carriesBudget: boolean;
};

/**
 * What a child ends up with.
 *
 * @property effectiveCents - What it may actually spend
 * @property source - Whether that amount was entered, divided, or does not exist
 */
export type ResolvedBudget = {
  effectiveCents: number;
  source: BudgetSource;
};

/**
 * Refuse children whose explicit amounts exceed their parent.
 *
 * The invariant `Σ children ≤ parent` holds at every level: there is no lending and no borrowing
 * between nodes (D8), so an amount that would overflow its parent is a 400, not a rebalancing.
 *
 * @param parentCents - The parent's effective budget
 * @param childrenCents - The sum of the explicit amounts of its children
 * @returns Nothing
 * @throws Error with status 400 coded `budget_exceeds_parent`
 *
 * @example
 * ```typescript
 * assertWithinParent(100000, 120000); // throws
 * ```
 */
export function assertWithinParent(parentCents: number, childrenCents: number): void {
  if (childrenCents <= parentCents) return;
  throw httpError(400, `The budgets of the children total ${childrenCents} cents of a parent of ${parentCents}`, {
    code: 'budget_exceeds_parent',
    params: { parentCents, childrenCents },
  });
}

/**
 * Divide a parent's budget between its children.
 *
 * The rule, in order (`../../CADRAGE.md` § 4):
 *
 * 1. a child the profile forbids a budget to gets **none**, and takes no part in the division;
 * 2. the **explicit** amounts are served first, and their sum may not exceed the parent;
 * 3. what is left is shared **equally** between the children that inherit.
 *
 * The last cents of an uneven share go to the first children in the order given, so the children
 * always total exactly the parent and the same input always gives the same output.
 *
 * @param parentCents - The parent's effective budget
 * @param children - Its children, in a stable order
 * @returns What each child may spend, by id
 * @throws Error with status 400 coded `budget_exceeds_parent` when the explicit amounts overflow
 *
 * @example
 * ```typescript
 * distributeBudget(100000, [
 *   { id: 'a', explicitCents: 40000, carriesBudget: true },
 *   { id: 'b', explicitCents: null, carriesBudget: true },
 *   { id: 'c', explicitCents: null, carriesBudget: true },
 * ]);
 * // a: 40000 explicit, b: 30000 inherited, c: 30000 inherited
 * ```
 */
export function distributeBudget(parentCents: number, children: BudgetChild[]): Map<string, ResolvedBudget> {
  const resolved = new Map<string, ResolvedBudget>();
  const inheriting: BudgetChild[] = [];
  let explicitTotal = 0;

  for (const child of children) {
    if (!child.carriesBudget) {
      resolved.set(child.id, { effectiveCents: 0, source: 'forbidden' });
      continue;
    }
    if (child.explicitCents === null) {
      inheriting.push(child);
      continue;
    }
    explicitTotal += child.explicitCents;
    resolved.set(child.id, { effectiveCents: child.explicitCents, source: 'explicit' });
  }

  assertWithinParent(parentCents, explicitTotal);

  const remaining: number = parentCents - explicitTotal;
  const share: number = inheriting.length === 0 ? 0 : Math.floor(remaining / inheriting.length);
  let extra: number = remaining - share * inheriting.length;
  for (const child of inheriting) {
    const bonus: number = extra > 0 ? 1 : 0;
    extra -= bonus;
    resolved.set(child.id, { effectiveCents: share + bonus, source: 'inherited' });
  }
  return resolved;
}

/**
 * Refuse a set of platform shares that is not a complete distribution key.
 *
 * The shares of a node total exactly {@link SHARE_TOTAL_BASIS_POINTS}: a key that totals less would
 * leave money nowhere, and one that totals more would promise money twice.
 *
 * @param shares - The shares of one node
 * @returns Nothing
 * @throws Error with status 400 coded `platform_share_duplicated` when a platform appears twice, or
 *   `platform_shares_invalid` when the total is wrong
 *
 * @example
 * ```typescript
 * assertSharesComplete([
 *   { platform: 'hawk', shareBasisPoints: 4000 },
 *   { platform: 'dv360', shareBasisPoints: 6000 },
 * ]);
 * ```
 */
export function assertSharesComplete(shares: PlatformShare[]): void {
  const seen = new Set<string>();
  let total = 0;
  for (const share of shares) {
    if (seen.has(share.platform)) {
      throw httpError(400, `The platform ${share.platform} appears twice in this distribution`, {
        code: 'platform_share_duplicated',
        params: { platform: share.platform },
      });
    }
    seen.add(share.platform);
    total += share.shareBasisPoints;
  }
  if (total !== SHARE_TOTAL_BASIS_POINTS) {
    throw httpError(400, `The platform shares total ${total} basis points instead of ${SHARE_TOTAL_BASIS_POINTS}`, {
      code: 'platform_shares_invalid',
      params: { total },
    });
  }
}

/** What one platform gets of a node's budget. */
export type PlatformBudget = PlatformShare & { cents: number };

/**
 * Split a budget between the platforms of its distribution key.
 *
 * `budget(node, platform) = effective(node) × share(platform)` (`../../CADRAGE.md` § 4). The cents
 * that no share wins outright go to the largest remainders first — the method an election uses to
 * seat whole people — so the platforms total exactly the node's budget and three equal platforms
 * never lose a cent.
 *
 * @param cents - The node's effective budget
 * @param shares - Its distribution key, which {@link assertSharesComplete} has accepted
 * @returns What each platform gets, in the order the shares were given; nothing for an empty key
 *
 * @example
 * ```typescript
 * splitByPlatform(100, [
 *   { platform: 'hawk', shareBasisPoints: 3334 },
 *   { platform: 'dv360', shareBasisPoints: 3333 },
 *   { platform: 'meta', shareBasisPoints: 3333 },
 * ]);
 * // 34, 33, 33
 * ```
 */
export function splitByPlatform(cents: number, shares: PlatformShare[]): PlatformBudget[] {
  // No key at all — a campaign, whose levers each have their own: there is nothing to split.
  if (shares.length === 0) return [];

  const exact: { index: number; floor: number; remainder: number }[] = shares.map(
    (share: PlatformShare, index: number) => {
      const scaled: number = cents * share.shareBasisPoints;
      return {
        index,
        floor: Math.floor(scaled / SHARE_TOTAL_BASIS_POINTS),
        remainder: scaled % SHARE_TOTAL_BASIS_POINTS,
      };
    }
  );

  const assigned: number = exact.reduce((total: number, part): number => total + part.floor, 0);
  // The largest remainders first, ties going to the share the caller gave first: a stable order, so
  // the same key always splits the same way.
  const byRemainder: typeof exact = [...exact].sort((a, b): number => b.remainder - a.remainder || a.index - b.index);
  for (let rank = 0; rank < cents - assigned; rank += 1) {
    exact[byRemainder[rank].index].floor += 1;
  }

  return shares.map((share: PlatformShare, index: number): PlatformBudget => ({ ...share, cents: exact[index].floor }));
}

/**
 * Turn a volume entered by the user into the amount that is stored (L25).
 *
 * The budget is **always** money. A volume — impressions, plays, completions — is a way of entering
 * it: it is converted through the bid CPM, and the amount is the truth. The volume is kept beside it
 * as the entry that produced it, so the interface can show it and recompute the amount if the CPM
 * changes.
 *
 * The amount is rounded **up**, so the money entered always buys at least the volume asked for. It
 * stays an estimate: the CPM paid in delivery is not the CPM bid, and the volume must never be
 * presented as a commitment.
 *
 * @param volume - How many impressions, plays or completions the user asked for
 * @param unit - The unit they asked in, which the lever profile permits
 * @param cpmCents - The bid amount of the node (L3), `null` when it has none
 * @returns The amount to store, in cents
 * @throws Error with status 400 coded `volume_without_bid` when the node has no CPM: a volume without
 *   a price is not an implicit estimate
 *
 * @example
 * ```typescript
 * volumeToCents(500000, 'impressions', 450); // 225000 cents, i.e. 2 250 €
 * ```
 */
export function volumeToCents(volume: number, unit: VolumeUnit, cpmCents: number | null): number {
  if (cpmCents === null) {
    throw httpError(400, `A budget entered in ${unit} needs a bid CPM to be converted into money`, {
      code: 'volume_without_bid',
      params: { unit },
    });
  }
  return Math.ceil((volume * cpmCents) / IMPRESSIONS_PER_CPM);
}
