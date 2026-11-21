/**
 * @module platforms/google/google.adapter
 *
 * The adapter of Google Ads: a `manager_link` platform, whose accounts our manager account (the MCC)
 * manages once their client accepts, with **our** credentials (`docs/phase-10.md` §§ 3 and 4).
 * Transcribed from multi-search (`src/platforms/google/google.adapter.ts`).
 *
 * Two credentials, both ours: the **service account** reads everything, and the **inviter** — a human
 * admin of the MCC, whose consent `pnpm google:connect` keeps — sends and withdraws the invitations,
 * which Google refuses a service account. The campaigns arrive in lot 3.
 */
import type { CallJournal } from '@src/services/platform-call.service';
import type { AdAccountScope, AdReview } from '@src/types';
import type { DesiredUnit } from '../desired-state';
import {
  AccountContext,
  ApplyResult,
  GoalSpec,
  LinkedAccountInfo,
  LinkStatus,
  PlatformAdapter,
  PlatformConnection,
  PlatformContext,
  PlatformError,
  TrackingRefs,
  TrackingSetup,
  UnitRefs,
} from '../platform-adapter';
import { PlatformHttp } from '../platform-http';
import { GoogleInviterAuth, GoogleServiceAccountAuth } from './google.auth';
import { GoogleConversions } from './google-conversions';
import { GoogleUnitSync, quoted } from './google.apply';
import { describeGoogleAdsError, GoogleAdsClient } from './google.client';
import { reviewOf } from './google.mapping';
import { GOOGLE_ADS_API, GoogleAdsRow, GoogleClientLinkStatus } from './google.types';

/** The GAQL queries of the connection. */
const GAQL = {
  /** Every link of our MCC to a client account, whatever its status. */
  clientLinks: (): string =>
    'SELECT customer_client_link.client_customer, customer_client_link.manager_link_id, ' +
    'customer_client_link.status FROM customer_client_link',
  /** The links of our MCC to one client account: several over time (invited, withdrawn, invited again). */
  clientLinksOf: (clientId: string): string =>
    `${GAQL.clientLinks()} WHERE customer_client_link.client_customer = 'customers/${clientId}'`,
  /** What Google made of some ads, named by their resource names (`docs/phase-10.md` § 8.8). */
  reviews: (ads: string): string =>
    'SELECT ad_group_ad.resource_name, ad_group_ad.policy_summary.review_status, ' +
    'ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.policy_topic_entries ' +
    `FROM ad_group_ad WHERE ad_group_ad.resource_name IN (${ads})`,
  /** What a client account says of itself, run on that account. */
  customer: (): string =>
    'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, ' +
    'customer.manager FROM customer',
} as const;

/** How many ads one query of their verdicts names, as multi-search does. */
const REVIEWS_PER_QUERY = 1000;

/** Our statuses of a link, from Google's. */
const LINK_STATUSES: Readonly<Record<string, LinkStatus>> = {
  ACTIVE: 'active',
  PENDING: 'pending',
  REFUSED: 'refused',
  CANCELED: 'refused',
  INACTIVE: 'ended',
};

/**
 * A customer id without its dashes, when it is one.
 *
 * @param input - As typed: `555-000-1111`, `5550001111`
 * @returns Ten digits, or `null`
 */
export function normalizeCustomerId(input: string): string | null {
  const digits: string = input.replace(/[\s-]/g, '');
  return /^\d{10}$/.test(digits) ? digits : null;
}

/**
 * A customer id as Google Ads shows it.
 *
 * @param customerId - Ten digits
 * @returns `555-000-1111`
 */
export function formatCustomerId(customerId: string): string {
  return `${customerId.slice(0, 3)}-${customerId.slice(3, 6)}-${customerId.slice(6)}`;
}

/**
 * The client account a link points at.
 *
 * @param resourceName - `customers/5550001111`
 * @returns `5550001111`, or `null`
 */
function customerIdOfResource(resourceName: string | undefined): string | null {
  const match: RegExpExecArray | null = /^customers\/(\d+)$/.exec(resourceName ?? '');
  return match ? match[1] : null;
}

/**
 * The latest of several links: the one with the greatest `managerLinkId`, Google numbering them in
 * the order they were made.
 *
 * @param rows - Rows of links
 * @returns The latest row, or `null` without any
 */
function latestOf(rows: GoogleAdsRow[]): GoogleAdsRow | null {
  let latest: GoogleAdsRow | null = null;
  for (const row of rows) {
    const id = BigInt(row.customerClientLink?.managerLinkId ?? 0);
    if (latest === null || id > BigInt(latest.customerClientLink?.managerLinkId ?? 0)) latest = row;
  }
  return latest;
}

/**
 * Where the latest of several links stands, as Google writes it.
 *
 * @param rows - Rows of links
 * @returns Its status, `undefined` without any link or without a status
 */
function latestStatusOf(rows: GoogleAdsRow[]): GoogleClientLinkStatus | undefined {
  return latestOf(rows)?.customerClientLink?.status;
}

/** Codes of an invitation meaning our MCC already manages the account: a race with the read before. */
const ALREADY_MANAGED: ReadonlySet<string> = new Set(['ALREADY_MANAGED_BY_THIS_MANAGER']);

/** Codes of an invitation meaning the account was already invited and has not answered. */
const ALREADY_INVITED: ReadonlySet<string> = new Set([
  'ALREADY_INVITED_BY_THIS_MANAGER',
  'CLIENT_ALREADY_INVITED_BY_THIS_MANAGER',
]);

/**
 * The codes that tell **why** Google refused an invitation, Google listing them after a vaguer one
 * (`INVALID_CHANGE`): the one kept as the reason the caller reads (`ad_account_link_refused`).
 */
const LINK_REFUSAL_REASONS: readonly string[] = [
  'ALREADY_MANAGED_IN_HIERARCHY',
  'DUPLICATE_CHILD_FOUND',
  'TOO_MANY_MANAGERS',
  'MAX_DEPTH_EXCEEDED',
  'TOO_MANY_INVITES',
  'ACCOUNTS_NOT_COMPATIBLE_FOR_LINKING',
];

/**
 * What the Google Ads adapter is built with.
 *
 * @property managerId - Our manager account, with or without its dashes
 * @property loadServiceAccountKey - Reads the JSON key of our service account, from the secret store
 * @property loadInviterSecret - Reads the OAuth credentials of our inviter, from the secret store
 * @property fetchFn - What sends the requests; a fake one in the tests
 * @property now - The clock; a fixed one in the tests
 */
export type GoogleAdsSetup = {
  managerId: string;
  loadServiceAccountKey: () => Promise<string>;
  loadInviterSecret: () => Promise<string>;
  fetchFn?: typeof fetch;
  now?: () => number;
};

/**
 * The adapter of Google Ads.
 */
export class GoogleAdsAdapter implements PlatformAdapter {
  /** @inheritdoc */
  public readonly platform = 'google_ads' as const;

  /** @inheritdoc */
  public readonly connection: PlatformConnection = 'manager_link';

  /** What pushes the campaigns. */
  private readonly units: GoogleUnitSync;

  /** What sets the conversions up. */
  private readonly conversions: GoogleConversions;

  /**
   * @param client - The calls of the API, through our manager account
   * @param now - The clock, which decides whether a start or an end is still to come
   */
  constructor(
    private readonly client: GoogleAdsClient,
    now: () => number = Date.now
  ) {
    this.conversions = new GoogleConversions(client);
    this.units = new GoogleUnitSync(client, now, this.conversions);
  }

  /**
   * Where the conversions of an account are tracked, and its Google tag (`docs/phase-10.md` § 8.10).
   *
   * @param account - The account
   * @returns Its tracking code
   * @throws PlatformError
   */
  public async setupTracking(account: AccountContext): Promise<TrackingSetup> {
    return this.conversions.setupTracking(account, formatCustomerId(account.externalId));
  }

  /**
   * The conversion action and the custom goal of a goal on an account (`docs/phase-10.md` § 8.10).
   *
   * @param account - The account
   * @param goal - The goal
   * @param _tracking - The account's Google tag, which a conversion action does not need
   * @param existing - Refs recorded at the last setup
   * @returns Where the goal stands there
   * @throws PlatformError
   */
  public async setupGoal(
    account: AccountContext,
    goal: GoalSpec,
    _tracking: TrackingRefs,
    existing: TrackingRefs | null
  ): Promise<TrackingSetup> {
    return this.conversions.setupGoal(account, goal, existing);
  }

  /**
   * Read what Google made of some ads of one account: one query per thousand ads, run on the account.
   *
   * @param account - The account
   * @param ads - Their resource names, as `refs` holds them
   * @returns The verdict of each ad Google answered for, by its resource name
   * @throws PlatformError
   */
  public async readReviews(account: AccountContext, ads: readonly string[]): Promise<Map<string, AdReview>> {
    const reviews = new Map<string, AdReview>();
    for (let start = 0; start < ads.length; start += REVIEWS_PER_QUERY) {
      const rows: GoogleAdsRow[] = await this.client.search(
        account.adAccountId,
        account.externalId,
        GAQL.reviews(quoted(ads.slice(start, start + REVIEWS_PER_QUERY)))
      );
      for (const row of rows) {
        const name: string | undefined = row.adGroupAd?.resourceName;
        if (name !== undefined) reviews.set(name, reviewOf(row.adGroupAd?.policySummary));
      }
    }
    return reviews;
  }

  /** @inheritdoc */
  public referenceOf(input: string): string | null {
    return normalizeCustomerId(input);
  }

  /**
   * Link a client account to our MCC — nothing to send when our MCC already manages it, or already
   * invited it (`docs/phase-10.md` § 7, point 10).
   *
   * Otherwise the invitation leaves, as our inviter, and Google's refusals keep the code that says
   * why — `TOO_MANY_MANAGERS` rather than the vaguer `INVALID_CHANGE` listed before it.
   *
   * @param reference - Its customer id, ten digits
   * @param _scope - Nothing Google needs: its client is named by the customer id alone
   * @returns `active` when our MCC manages it, `pending` when an invitation waits
   * @throws PlatformError: our own credentials when the inviter cannot act, Google's refusal otherwise
   */
  public async requestLink(reference: string, _scope?: AdAccountScope): Promise<'pending' | 'active'> {
    const status: GoogleClientLinkStatus | undefined = (await this.latestLinkOf(reference))?.status;
    if (status === 'ACTIVE') return 'active';
    if (status === 'PENDING') return 'pending';
    try {
      await this.client.createClientLink(reference);
      return 'pending';
    } catch (error: unknown) {
      if (!(error instanceof PlatformError)) throw error;
      const codes: string[] = [error.options.code ?? '', ...(error.options.codes ?? [])];
      if (codes.some((code: string): boolean => ALREADY_MANAGED.has(code))) return 'active';
      if (codes.some((code: string): boolean => ALREADY_INVITED.has(code))) return 'pending';
      const reason: string | undefined = LINK_REFUSAL_REASONS.find((code: string): boolean => codes.includes(code));
      throw reason ? new PlatformError('google_ads', error.message, { ...error.options, code: reason }) : error;
    }
  }

  /** @inheritdoc */
  public async linkStatuses(): Promise<Map<string, LinkStatus>> {
    const rows: GoogleAdsRow[] = await this.client.search(null, this.client.managerId, GAQL.clientLinks());
    const byClient = new Map<string, GoogleAdsRow[]>();
    for (const row of rows) {
      const clientId: string | null = customerIdOfResource(row.customerClientLink?.clientCustomer);
      if (clientId === null) continue;
      byClient.set(clientId, [...(byClient.get(clientId) ?? []), row]);
    }
    const statuses = new Map<string, LinkStatus>();
    for (const [clientId, links] of byClient) {
      const status: LinkStatus | undefined = LINK_STATUSES[latestStatusOf(links) ?? ''];
      if (status) statuses.set(clientId, status);
    }
    return statuses;
  }

  /**
   * Withdraw the pending invitation of a client account; nothing happens when none is pending.
   *
   * @param reference - Its customer id
   * @returns A promise that resolves once no invitation is pending
   * @throws PlatformError, on our own credentials when the inviter cannot act
   */
  public async cancelLink(reference: string): Promise<void> {
    const latest = await this.latestLinkOf(reference);
    if (latest?.status !== 'PENDING') return;
    // Google gives the link's resource name with its row; rebuilt from its parts otherwise.
    await this.client.cancelClientLink(
      latest.resourceName ??
        `customers/${this.client.managerId}/customerClientLinks/${reference}~${String(latest.managerLinkId)}`
    );
  }

  /** @inheritdoc */
  public async readLinkedAccount(reference: string): Promise<LinkedAccountInfo> {
    const rows: GoogleAdsRow[] = await this.client.search(null, reference, GAQL.customer());
    const customer = rows[0]?.customer;
    if (!customer?.currencyCode || !customer.timeZone) {
      throw new PlatformError('google_ads', `Google Ads did not describe the account ${formatCustomerId(reference)}`, {
        statusCode: null,
        retryable: false,
        invalidCredentials: false,
        requestId: null,
        code: 'customer_unreadable',
      });
    }
    return {
      externalId: reference,
      name: customer.descriptiveName?.trim() || `Google Ads ${formatCustomerId(reference)}`,
      currency: customer.currencyCode.toUpperCase(),
      timezone: customer.timeZone,
      manager: customer.manager === true,
    };
  }

  /**
   * Make Google Ads match the desired state of one unit (`docs/phase-10.md` § 8.5): see
   * `google.apply.ts`.
   *
   * @param context - The account
   * @param desired - What must be true over there
   * @param refs - What exists, as the engine last recorded it
   * @returns What exists now
   * @throws PlatformError
   */
  public apply(context: PlatformContext, desired: DesiredUnit, refs: UnitRefs): Promise<ApplyResult> {
    return this.units.apply(context, desired, refs);
  }

  /**
   * The latest link of our MCC to a client account.
   *
   * @param clientId - Its customer id
   * @returns The link, `undefined` without any
   */
  private async latestLinkOf(clientId: string): Promise<GoogleAdsRow['customerClientLink']> {
    return latestOf(await this.client.search(null, this.client.managerId, GAQL.clientLinksOf(clientId)))
      ?.customerClientLink;
  }
}

/**
 * The client of the Google Ads API, through our MCC: what the adapter calls, and what a command-line
 * script of ours calls directly (`pnpm google:cleanup`).
 *
 * @param setup - Our MCC, and the reading of our two credentials
 * @param journal - Where every call is recorded
 * @returns The client
 * @throws Error when the configured MCC is not a customer id
 */
export function createGoogleAdsClient(setup: GoogleAdsSetup, journal: CallJournal): GoogleAdsClient {
  const managerId: string | null = normalizeCustomerId(setup.managerId);
  if (managerId === null) throw new Error(`The Google Ads manager account ${setup.managerId} is not a customer id`);
  const auth = new GoogleServiceAccountAuth(setup.loadServiceAccountKey, setup.fetchFn, setup.now);
  const inviter = new GoogleInviterAuth(setup.loadInviterSecret, setup.fetchFn, setup.now);
  /**
   * An HTTP client of the API, with one of our tokens.
   *
   * @param token - Gives the token
   * @returns The client
   */
  const httpWith = (token: () => Promise<string>): PlatformHttp =>
    new PlatformHttp({
      platform: 'google_ads',
      baseUrl: GOOGLE_ADS_API.baseUrl,
      timeoutMs: GOOGLE_ADS_API.timeoutMs,
      requestIdHeader: GOOGLE_ADS_API.requestIdHeader,
      journal,
      authorization: async (): Promise<string> => `Bearer ${await token()}`,
      describeError: describeGoogleAdsError,
      fetchFn: setup.fetchFn,
    });
  return new GoogleAdsClient(
    httpWith((): Promise<string> => auth.accessToken()),
    managerId,
    (): void => auth.invalidate(),
    {
      http: httpWith((): Promise<string> => inviter.accessToken()),
      onUnauthenticated: (): void => inviter.invalidate(),
    }
  );
}

/**
 * Build the adapter of Google Ads, with what reads our credentials.
 *
 * @param setup - Our MCC, and the reading of our two credentials
 * @param journal - Where every call is recorded
 * @returns The adapter
 * @throws Error when the configured MCC is not a customer id
 *
 * @example
 * ```typescript
 * registerAdapter(createGoogleAdsAdapter({ managerId: '771-934-5054', loadServiceAccountKey, loadInviterSecret }, journal));
 * ```
 */
export function createGoogleAdsAdapter(setup: GoogleAdsSetup, journal: CallJournal): GoogleAdsAdapter {
  return new GoogleAdsAdapter(createGoogleAdsClient(setup, journal), setup.now);
}
