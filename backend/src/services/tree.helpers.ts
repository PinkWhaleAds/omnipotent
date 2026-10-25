/**
 * @module services/tree.helpers
 *
 * What holds between a node of the campaign tree and its parent, besides the money
 * (`services/budget.helpers.ts`): the delivery window. Pure functions, like the algebra, so the
 * services, the jobs and the preview all read the same rule.
 */
import { httpError } from '@utils';

/**
 * A delivery window, in **days** (`YYYY-MM-DD`) of the campaign's timezone.
 *
 * Days rather than instants: a campaign runs from one day to another in its own timezone, and the
 * hours of a platform day are the pacing's business (`../../CADRAGE.md` § 4). ISO days compare
 * correctly as text, which is why nothing here parses a date.
 *
 * @property startsOn - First day of delivery, included
 * @property endsOn - Last day of delivery, included
 */
export type DeliveryWindow = {
  startsOn: string;
  endsOn: string;
};

/**
 * Refuse a window that is not inside its parent's.
 *
 * Dates are mandatory on the campaign; below, `null` means the parent's window and an override must
 * be **included** in it (`../../CADRAGE.md` § 4). A child delivering outside its parent is a plan
 * nobody could execute, so it is refused at write time rather than reported by the preview.
 *
 * @param child - The window asked for
 * @param parent - The parent's window
 * @returns Nothing
 * @throws Error with status 400 coded `dates_outside_parent`
 *
 * @example
 * ```typescript
 * assertWindowWithinParent({ startsOn: '2026-11-01', endsOn: '2026-11-30' }, { startsOn: '2026-11-05', endsOn: '2026-11-20' });
 * // throws: it starts before its parent and ends after it
 * ```
 */
export function assertWindowWithinParent(child: DeliveryWindow, parent: DeliveryWindow): void {
  if (child.startsOn >= parent.startsOn && child.endsOn <= parent.endsOn) return;
  throw httpError(400, `The window ${child.startsOn} → ${child.endsOn} is not inside its parent's`, {
    code: 'dates_outside_parent',
    params: { parentStart: parent.startsOn, parentEnd: parent.endsOn },
  });
}

/**
 * Refuse a window that ends before it starts.
 *
 * @param window - The window asked for
 * @returns Nothing
 * @throws Error with status 400 coded `dates_reversed`
 *
 * @example
 * ```typescript
 * assertWindowOrdered({ startsOn: '2026-11-30', endsOn: '2026-11-01' }); // throws
 * ```
 */
export function assertWindowOrdered(window: DeliveryWindow): void {
  if (window.startsOn <= window.endsOn) return;
  throw httpError(400, `The window ends on ${window.endsOn}, before it starts on ${window.startsOn}`, {
    code: 'dates_reversed',
    params: { startsOn: window.startsOn, endsOn: window.endsOn },
  });
}
