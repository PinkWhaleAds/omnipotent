/**
 * @module tracking/tracking-platforms
 *
 * What each platform brings to the tracking script of an Advertiser (`docs/phase-10.md` § 8.10): the
 * domains its tag reaches, where the tag of a ready tracking code goes, and how a goal ready on one of
 * its accounts is fired. The tracking service reads this table and never names a platform; a platform
 * absent from it has no part in the script. Transcribed from multi-search (`LOADER_TAGS`,
 * `LOADER_FIRES` and `CSP_DOMAINS` of its tracking service), Google only for now.
 */
import type { Platform } from '@src/types/platform.types';
import type { TrackingRefs } from '@src/platforms/platform-adapter';
import type { LoaderConfig, LoaderGoal } from './loader-config';

/**
 * The part of one platform in the tracking script.
 *
 * @property cspDomains - Domains its tag loads scripts from or sends events to, for the site's Content
 *   Security Policy
 * @property addTag - Put the tag of a ready tracking code in the script's configuration
 * @property addGoal - Put how a goal ready on one account is fired, and the tag it needs; incomplete
 *   ids fire nothing
 */
export type TrackingPlatform = {
  cspDomains: readonly string[];
  addTag: (config: LoaderConfig, tracking: TrackingRefs) => void;
  addGoal: (config: LoaderConfig, goal: LoaderGoal, tracking: TrackingRefs, refs: TrackingRefs) => void;
};

/**
 * Add an item to a list unless an equal one is there already (several accounts can share a tag).
 *
 * @param list - The list
 * @param item - The item
 * @returns Nothing
 */
export function pushOnce<T>(list: T[], item: T): void {
  const key: string = JSON.stringify(item);
  if (!list.some((existing: T): boolean => JSON.stringify(existing) === key)) list.push(item);
}

/** The part of each platform in the tracking script. */
export const TRACKING_PLATFORMS: Readonly<Partial<Record<Platform, TrackingPlatform>>> = {
  google_ads: {
    cspDomains: ['www.googletagmanager.com', 'www.google.com', 'googleads.g.doubleclick.net'],
    addTag: (config: LoaderConfig, tracking: TrackingRefs): void => {
      if (tracking.tagId) pushOnce(config.googleTagIds, tracking.tagId);
    },
    // The label carries the number of the tag (`AW-<number>/<label>`): an account whose tracking Google
    // turned on with its first conversion action has its tag there before its setting shows it.
    addGoal: (config: LoaderConfig, goal: LoaderGoal, _tracking: TrackingRefs, refs: TrackingRefs): void => {
      if (!refs.sendTo) return;
      pushOnce(goal.google, { sendTo: refs.sendTo });
      pushOnce(config.googleTagIds, refs.sendTo.split('/')[0]);
    },
  },
};
