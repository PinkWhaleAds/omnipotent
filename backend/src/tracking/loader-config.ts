import type { ConversionCategory, ConversionValueMode } from '@src/types/conversion.types';

/**
 * How one goal is fired by the tracking script. A platform appears once per ad account where the goal
 * is ready.
 *
 * @property category - What the conversion is
 * @property valueMode - How it is valued
 * @property defaultValue - Fixed value, or fallback of a dynamic one, in units of `currency`
 * @property currency - Currency of the value
 * @property google - Per Google tag: the `send_to` of the conversion action (`AW-…/label`)
 */
export type LoaderGoal = {
  category: ConversionCategory;
  valueMode: ConversionValueMode;
  defaultValue: number | null;
  currency: string | null;
  google: { sendTo: string }[];
};

/**
 * Everything the tracking script of one Advertiser needs: the tags to load and how each goal is fired.
 * Built by the tracking service from what is ready; served at `/t/<key>.js` (`docs/phase-10.md`
 * § 8.10). Google only for now: Microsoft joins with lot B of phase 11.
 *
 * @property googleTagIds - Google tags (`AW-…`) to configure
 * @property goals - By goal key
 */
export type LoaderConfig = {
  googleTagIds: string[];
  goals: Record<string, LoaderGoal>;
};
