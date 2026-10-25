import { z } from 'zod';

/**
 * The advertising platforms Omnipotent buys on, as the API names them
 * (`../../CADRAGE.md` § 6).
 *
 * Amazon counts as **two** platforms: different APIs, different account types, so two adapters and
 * two entries here. YouTube is reached through DV360 on the `dac` lever, not as a platform of its
 * own. The ids are stable: they travel in URLs, in error params and in reports.
 *
 * A platform of this list has no connector until its own phase adds it to
 * `src/platforms/platform-rules.ts`: being nameable is not being usable.
 */
export const platformSchema = z.enum([
  'google_ads',
  'microsoft',
  'openai',
  'thrad',
  'amazon_search',
  'amazon_dsp',
  'dv360',
  'hawk',
  'meta',
  'tiktok',
  'snap',
]);

/** TypeScript type inferred from {@link platformSchema}. */
export type Platform = z.infer<typeof platformSchema>;

/**
 * How a basis point share is expressed: hundredths of a percent, so three equal platforms are
 * `3334 / 3333 / 3333` and nothing is lost to rounding.
 */
export const SHARE_TOTAL_BASIS_POINTS = 10_000;

/**
 * Zod schema of one platform's share of a budget.
 *
 * The share is a **distribution key, not a budget** (`../../CADRAGE.md` § 4): it is chosen on the
 * Lever with the platforms, overridable on the AdGroup, and applies multiplicatively to the leaf.
 *
 * @property platform - The platform
 * @property shareBasisPoints - Its share, in hundredths of a percent; the shares of a node total
 *   {@link SHARE_TOTAL_BASIS_POINTS}
 */
export const platformShareSchema = z.object({
  platform: platformSchema,
  shareBasisPoints: z.number().int().min(1).max(SHARE_TOTAL_BASIS_POINTS),
});

/** TypeScript type inferred from {@link platformShareSchema}. */
export type PlatformShare = z.infer<typeof platformShareSchema>;
