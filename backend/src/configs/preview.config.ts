import config from 'config';

/**
 * Configuration of the preview.
 *
 * @property maxPlatformObjectsPerAdGroup - How many objects of the budget-holding level one AdGroup
 *   may produce on one platform. The **split** of `../../CADRAGE.md` § 7 — a TargetingGroup carrying
 *   its own budget becomes its own platform campaign — is what makes this number necessary: it is a
 *   guard-rail against an AdGroup fanning out into hundreds of platform campaigns, not a platform
 *   limit. The real ceilings of a Google account are in `A-FAIRE.md`, still to be read.
 */
export type PreviewConfig = {
  maxPlatformObjectsPerAdGroup: number;
};

/** The configuration key used to look up preview settings in the config store. */
const CONFIG_KEY = 'Preview';

/**
 * Read an optional key, falling back to a default when it is absent.
 *
 * @param key - Key under {@link CONFIG_KEY}
 * @param fallback - Value returned when the key is not configured
 * @returns The configured value or the fallback
 */
function optional<T>(key: string, fallback: T): T {
  return config.has(`${CONFIG_KEY}.${key}`) ? config.get(`${CONFIG_KEY}.${key}`) : fallback;
}

/**
 * Resolved preview configuration loaded from the application config store.
 *
 * @example
 * ```typescript
 * import { previewConfig } from '@configs';
 *
 * if (objects > previewConfig.maxPlatformObjectsPerAdGroup) { … }
 * ```
 */
export const previewConfig: PreviewConfig = {
  maxPlatformObjectsPerAdGroup: optional('maxPlatformObjectsPerAdGroup', 50),
};
