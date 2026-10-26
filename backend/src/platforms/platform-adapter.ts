/**
 * @module platforms/platform-adapter
 *
 * The contract every platform implements, and the errors it raises.
 *
 * One interface, one call: the engine hands an adapter **the whole desired state** and **what it
 * already created**, and the adapter makes the platform match. Nothing in the engine tests a platform
 * name, and nothing in an adapter decides the structure — the projection does
 * (`platforms/projection.ts`).
 */
import { MessageParams, Platform } from '@src/types';
import { httpError } from '@utils';
import { DesiredUnit } from './desired-state';

/**
 * What an adapter needs to talk to one account.
 *
 * The credentials are read from the secret store **at the last moment** and never leave this object:
 * they are not in the desired state, not in the journal, not in a log (`../../CADRAGE.md` § 12).
 *
 * @property platform - The platform
 * @property adAccountId - Our id of the account, for the call journal
 * @property externalId - Its id over there
 * @property externalAdvertiserId - The brand's sub-advertiser there
 * @property currency - The account's currency, which the budgets sent are expressed in
 * @property timezone - The timezone the platform counts its days in
 * @property scope - What the platform demands above the account (a partner id, a profile)
 * @property credentials - The secret's value
 */
export type PlatformContext = {
  platform: Platform;
  adAccountId: string;
  externalId: string;
  externalAdvertiserId: string;
  currency: string;
  timezone: string;
  scope: Readonly<Record<string, string | number>>;
  credentials: string;
};

/**
 * What exists at a platform, by key of {@link DesiredUnit}'s objects.
 *
 * The engine passes the map it recorded and keeps the map the adapter returns: that is the whole
 * mechanism of idempotence. An interrupted sync left ids in it, so the next one updates instead of
 * creating a second time.
 */
export type UnitRefs = Readonly<Record<string, string>>;

/**
 * What one call of {@link PlatformAdapter.apply} achieved.
 *
 * @property refs - The id of every object that exists now, by key
 * @property appliedStatus - The status the platform actually took, which is not always the one asked
 *   for: a platform that reviews before activating stays paused, and the unit remains `pending`
 */
export type ApplyResult = {
  refs: Record<string, string>;
  appliedStatus: string | null;
};

/**
 * Everything Omnipotent does on one platform.
 *
 * One implementation per platform, each added by its own phase to {@link ADAPTERS}. The interface is
 * deliberately one method wide: the engine computes **what must be true**, the adapter makes it true.
 */
export interface PlatformAdapter {
  /** The platform it talks to. */
  readonly platform: Platform;

  /**
   * Make the platform match the desired state, idempotently.
   *
   * Creates what is missing — finding first, in `refs`, what an interrupted sync already created —
   * updates what changed, pauses what disappeared, and applies the status last. It never deletes:
   * the history of a report depends on the old objects still being there (R5).
   *
   * @param context - Account and credentials
   * @param desired - What must be true over there
   * @param refs - What exists, as the engine last recorded it
   * @returns What exists now
   * @throws PlatformError
   */
  apply(context: PlatformContext, desired: DesiredUnit, refs: UnitRefs): Promise<ApplyResult>;
}

/**
 * An error raised by a platform call, carrying what the engine needs to decide what to do next.
 *
 * @property retryable - Whether trying again later can succeed: a rate limit, a 5xx, no response.
 *   `false` means the unit waits for a modification or an explicit retry, never for a timer
 *   (`docs/phase-9.md` § 5)
 * @property invalidCredentials - Whether the platform refused the key, which invalidates the account
 * @property requestId - The id the platform gives for its own support
 * @property code - Its machine-readable error code, when it gives one
 * @property messageCode - Our stable code, when **we** worded the message rather than the platform
 * @property messageParams - The values of that message, for its translation
 */
export class PlatformError extends Error {
  /**
   * @param platform - The platform
   * @param message - What went wrong, as it was worded
   * @param options - What the engine reacts to
   * @param options.statusCode - HTTP status of the response, `null` when none came back
   * @param options.retryable - Whether trying again later can succeed
   * @param options.invalidCredentials - Whether the key was refused
   * @param options.requestId - Request id of the platform
   * @param options.code - Error code of the platform
   * @param options.messageCode - Our stable code, when we worded the message
   * @param options.messageParams - Values of that message
   */
  constructor(
    public readonly platform: Platform,
    message: string,
    public readonly options: {
      statusCode: number | null;
      retryable: boolean;
      invalidCredentials: boolean;
      requestId: string | null;
      code?: string | null;
      messageCode?: string | null;
      messageParams?: MessageParams | null;
    }
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}

/**
 * The adapter of every platform that has one.
 *
 * Empty in the socle, exactly like `platform-rules.ts`: a platform arrives with its phase, and until
 * then the preview answers `preview_adapter_missing` and the engine refuses the unit definitively —
 * no amount of retrying writes code.
 */
export const ADAPTERS: Readonly<Partial<Record<Platform, PlatformAdapter>>> = {};

/**
 * The adapter of one platform.
 *
 * @param platform - Its id
 * @returns Its adapter
 * @throws Error with status 500 coded `sync_adapter_missing` when no phase has written it yet
 *
 * @example
 * ```typescript
 * adapterOf('google_ads'); // once the Google Ads phase has landed
 * ```
 */
export function adapterOf(platform: Platform): PlatformAdapter {
  const adapter: PlatformAdapter | undefined = ADAPTERS[platform];
  if (!adapter) {
    throw httpError(500, `No adapter implements ${platform}`, {
      code: 'sync_adapter_missing',
      params: { platform },
    });
  }
  return adapter;
}

/**
 * Whether a platform has an adapter.
 *
 * A **question**, where {@link adapterOf} is a demand.
 *
 * @param platform - Its id
 * @returns `true` when one exists
 */
export function hasAdapterFor(platform: Platform): boolean {
  return ADAPTERS[platform] !== undefined;
}
