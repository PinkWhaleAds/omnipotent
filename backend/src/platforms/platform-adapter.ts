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
import { AdAccountScope, MessageParams, Platform } from '@src/types';
import { httpError } from '@utils';
import { DesiredUnit } from './desired-state';

/**
 * What an adapter needs to talk to one account.
 *
 * The credentials are read from the secret store **at the last moment** and never leave this object:
 * they are not in the desired state, not in the journal, not in a log (`../../CADRAGE.md` § 12). They
 * are those of the **account**, and `null` on a platform whose credentials are ours
 * ({@link PlatformConnection}): its adapter reads them itself, from what it was built with.
 *
 * @property platform - The platform
 * @property adAccountId - Our id of the account, for the call journal
 * @property externalId - Its id over there
 * @property externalAdvertiserId - The brand's sub-advertiser there
 * @property currency - The account's currency, which the budgets sent are expressed in
 * @property timezone - The timezone the platform counts its days in
 * @property scope - What the platform demands above the account (a partner id, a profile)
 * @property credentials - The account's secret, `null` on a `manager_link` platform
 * @property readAsset - The bytes of one asset of the desired state, read at the moment it is sent:
 *   a file never travels in the state itself
 */
export type PlatformContext = {
  platform: Platform;
  adAccountId: string;
  externalId: string;
  externalAdvertiserId: string;
  currency: string;
  timezone: string;
  scope: Readonly<Record<string, string | number>>;
  credentials: string | null;
  readAsset: (assetId: string) => Promise<Buffer>;
};

/**
 * How a platform reaches the account of a client (`docs/phase-10.md` § 4.1).
 *
 * - `manager_link` — **our** manager account manages theirs once the client accepts a link, so the
 *   credentials are ours, the same for every client, and no account carries a secret (Google Ads,
 *   Microsoft Advertising);
 * - `account_secret` — each account brings its own secret, kept under the name its `AdAccount`
 *   holds (OpenAI, Thrad).
 */
export type PlatformConnection = 'manager_link' | 'account_secret';

/**
 * Where the link of one client account to our manager account stands, as the platform says it.
 *
 * - `pending` — invited, no answer yet;
 * - `active` — accepted: the account can be managed;
 * - `refused` — the client refused, or the invitation was withdrawn;
 * - `expired` — the platform gave the invitation up, unanswered (Microsoft, after thirty days);
 * - `ended` — accepted, then ended.
 */
export type LinkStatus = 'pending' | 'active' | 'refused' | 'expired' | 'ended';

/**
 * A client account, read through our manager account once linked.
 *
 * @property externalId - The id the platform's calls take, which may differ from the reference the
 *   client gave (the Microsoft account number is not its id)
 * @property name - Its name there
 * @property currency - ISO 4217, upper case
 * @property timezone - IANA
 * @property manager - Whether it is itself a manager account, which runs no campaign
 */
export type LinkedAccountInfo = {
  externalId: string;
  name: string;
  currency: string;
  timezone: string;
  manager: boolean;
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
 * One implementation per platform, each added by its own phase to {@link ADAPTERS}. Pushing is one
 * method wide: the engine computes **what must be true**, the adapter makes it true. A `manager_link`
 * platform adds the four methods of the link (`docs/phase-10.md` § 4.3), keyed by the account's
 * **reference** — the account as the client reads it in the platform's interface.
 */
export interface PlatformAdapter {
  /** The platform it talks to. */
  readonly platform: Platform;

  /** How it reaches a client's account, which decides where the credentials come from. */
  readonly connection: PlatformConnection;

  /**
   * The canonical form of a reference, from what a person typed: the one every check of uniqueness
   * compares and every link status is keyed by. Pure, no call.
   *
   * @param input - As given, a Google customer id with or without its dashes
   * @returns The reference, or `null` when it is not one
   */
  referenceOf?(input: string): string | null;

  /**
   * Link a client account to our manager account: nothing to send when ours already manages it,
   * else an invitation the client accepts in the platform's interface.
   *
   * @param reference - The account as the client gave it
   * @param scope - What the account's platform requires above it: Microsoft's customer number of the
   *   client (`docs/phase-11.md` § 2)
   * @returns `active` when our manager account already manages it, `pending` once invited
   * @throws PlatformError
   */
  requestLink?(reference: string, scope: AdAccountScope): Promise<'pending' | 'active'>;

  /**
   * Where **every** link of our manager account stands, in one read.
   *
   * @returns The status of each, by reference
   * @throws PlatformError
   */
  linkStatuses?(): Promise<Map<string, LinkStatus>>;

  /**
   * Withdraw the pending invitation of a client account; nothing happens when none is pending.
   *
   * @param reference - The account
   * @returns A promise that resolves once no invitation is pending
   * @throws PlatformError
   */
  cancelLink?(reference: string): Promise<void>;

  /**
   * Read a client account through our manager account.
   *
   * @param reference - The account
   * @returns Its id, name, currency, timezone, and whether it is itself a manager account
   * @throws PlatformError
   */
  readLinkedAccount?(reference: string): Promise<LinkedAccountInfo>;

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
 * @property ownCredentials - Whether the credentials that failed are **ours** (a service account, an
 *   OAuth authorization of our manager account): the client can do nothing, an operator must act, and
 *   the account is left alone whatever `invalidCredentials` says (`docs/phase-10.md` § 4.2)
 * @property requestId - The id the platform gives for its own support
 * @property code - Its machine-readable error code, when it gives one
 * @property codes - Every error code of the response, in order, when the platform lists several
 *   (Google Ads): the one that matters is not always the first
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
   * @param options.ownCredentials - Whether the credentials that failed are ours
   * @param options.requestId - Request id of the platform
   * @param options.code - Error code of the platform
   * @param options.codes - Every error code of the response, in order
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
      ownCredentials?: boolean;
      requestId: string | null;
      code?: string | null;
      codes?: readonly string[];
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
 * Filled **at startup** by {@link registerAdapter}, because an adapter whose credentials are ours is
 * built with what reads them: a platform whose settings are missing gets none, and the application
 * starts without it (`docs/phase-10.md` § 5). Until a platform has one, the preview answers
 * `preview_adapter_missing` and the engine refuses its units definitively — no amount of retrying
 * writes code.
 */
export const ADAPTERS: Readonly<Partial<Record<Platform, PlatformAdapter>>> = {};

/**
 * Make an adapter the one of its platform, replacing any before it.
 *
 * @param adapter - The adapter
 *
 * @example
 * ```typescript
 * registerAdapter(createGoogleAdsAdapter(setup, journal));
 * ```
 */
export function registerAdapter(adapter: PlatformAdapter): void {
  (ADAPTERS as Partial<Record<Platform, PlatformAdapter>>)[adapter.platform] = adapter;
}

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
