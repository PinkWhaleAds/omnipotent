import { z } from 'zod';

/**
 * @module targeting/families
 *
 * The **shapes** a targeting dimension can take, as factories.
 *
 * The dimensions of a media buying model repeat a handful of forms: most are an include/exclude pair
 * over a vocabulary, some point at a reusable list, a few are a numeric range or a set of serving
 * windows, and a handful have a form of their own. Writing each dimension by hand would be writing
 * the same object dozens of times, and testing it dozens of times to prove the same invariant.
 *
 * So a dimension **names its family and its vocabulary**, and keeps its own named schema — which is
 * what the registry stores, and what validates a request. A family is tested once, each dimension on
 * its vocabulary (`docs/phase-5.md` § 2).
 */

/** How many entries one side of an include/exclude pair accepts, so a request cannot be unbounded. */
export const MAX_CRITERIA_VALUES = 5_000;

/** An opaque identifier of a platform referential: its shape belongs to the platform, not to us. */
const opaqueIdSchema = z.string().trim().min(1).max(256);

/**
 * An include/exclude pair over a vocabulary.
 *
 * Two invariants, which are what every dimension of this family would otherwise re-test: at least one
 * side is non-empty — an empty criterion restricts nothing, and saying nothing is done by **not**
 * carrying the dimension — and no value sits on both sides at once, which would be asking for a thing
 * and its opposite.
 *
 * @param value - Schema of one value, a closed enumeration or a validated code
 * @returns The schema of the pair
 *
 * @example
 * ```typescript
 * const os = includeExclude(z.enum(['ios', 'android']));
 * os.parse({ include: ['ios'] }); // { include: ['ios'], exclude: [] }
 * ```
 */
export function includeExclude<Value extends z.ZodType>(value: Value) {
  return z
    .strictObject({
      include: z.array(value).max(MAX_CRITERIA_VALUES).default([]),
      exclude: z.array(value).max(MAX_CRITERIA_VALUES).default([]),
    })
    .refine(
      (criteria): boolean => criteria.include.length > 0 || criteria.exclude.length > 0,
      'a criterion must include or exclude something: drop the dimension to restrict nothing'
    )
    .refine((criteria): boolean => {
      const included = new Set<unknown>(criteria.include);
      return !criteria.exclude.some((entry: unknown): boolean => included.has(entry));
    }, 'a value cannot be included and excluded at once');
}

/**
 * An include/exclude pair over the **opaque identifiers** of a platform referential.
 *
 * Their shape is the platform's: an id gone stale after it was chosen fails **at the push**, where
 * the platform says so, rather than being guessed here (`docs/phase-5.md` § 6). What the model holds
 * is the id plus the denormalized values the caller sent, so a referential being unreachable never
 * stops what is already composed.
 *
 * @returns The schema of the pair
 */
export function opaqueIds() {
  return includeExclude(opaqueIdSchema);
}

/**
 * A reference to reusable lists of the Organization, by id.
 *
 * The **kind** of list a dimension expects is declared by its descriptor, and checked by the service
 * against the lists it reads: a list of POIs does not plug into a dimension of sites.
 *
 * @returns The schema of the reference
 */
export function listReference() {
  return includeExclude(z.uuid());
}

/**
 * A numeric range, inclusive on both ends.
 *
 * One of the two ends may be left out — « at least 70 % viewable » has no upper bound — but not both,
 * and the lower end never exceeds the upper one.
 *
 * @param bounds - What the dimension accepts, and whether it is an integer
 * @returns The schema of the range
 *
 * @example
 * ```typescript
 * range({ min: 0, max: 100, integer: true }).parse({ min: 70 });
 * ```
 */
export function range(bounds: { min: number; max: number; integer?: boolean }) {
  const value: z.ZodNumber = bounds.integer
    ? z.number().int().min(bounds.min).max(bounds.max)
    : z.number().min(bounds.min).max(bounds.max);
  return z
    .strictObject({ min: value.optional(), max: value.optional() })
    .refine(
      (criteria): boolean => criteria.min !== undefined || criteria.max !== undefined,
      'a range must carry at least one of min and max'
    )
    .refine(
      (criteria): boolean => criteria.min === undefined || criteria.max === undefined || criteria.min <= criteria.max,
      'the lower end of a range cannot exceed the upper one'
    );
}

/** The days a serving window can fall on, as the whole model spells them. */
export const windowDaySchema = z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);

/** TypeScript type inferred from {@link windowDaySchema}. */
export type WindowDay = z.infer<typeof windowDaySchema>;

/**
 * Whose clock a serving window is read on.
 *
 * `campaign` is the timezone the campaign counts its days in, the one the budget curve already uses;
 * `user` is the end user's own, which some platforms offer and others refuse — the platform registry
 * says which, and the preview names the loss.
 */
export const windowClockSchema = z.enum(['campaign', 'user']);

/** TypeScript type inferred from {@link windowClockSchema}. */
export type WindowClock = z.infer<typeof windowClockSchema>;

/** How many serving windows one dimension accepts: every day of the week, hour by hour. */
export const MAX_WINDOWS = 7 * 24;

/**
 * A set of serving windows, plus **one** clock to read them on.
 *
 * Windows are include-only: they say **when** delivery happens, and the complement is said by listing
 * the other windows. An hour range is `[startHour, endHour)`, in whole hours, so `0 → 24` is the
 * whole day.
 *
 * @returns The schema of the windows
 *
 * @example
 * ```typescript
 * windows().parse({ windows: [{ day: 'monday', startHour: 9, endHour: 18 }], clock: 'campaign' });
 * ```
 */
export function windows() {
  return z.strictObject({
    windows: z
      .array(
        z
          .strictObject({
            day: windowDaySchema,
            startHour: z.number().int().min(0).max(23),
            endHour: z.number().int().min(1).max(24),
          })
          .refine((window): boolean => window.startHour < window.endHour, 'a window ends after it starts')
      )
      .min(1)
      .max(MAX_WINDOWS),
    clock: windowClockSchema.default('campaign'),
  });
}
