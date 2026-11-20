/**
 * @module platforms/google/google.adapter
 *
 * The adapter of Google Ads: a `manager_link` platform, whose accounts our manager account (the MCC)
 * manages once their client accepts, with **our** service account's credentials
 * (`docs/phase-10.md` §§ 3 and 4). Transcribed from multi-search
 * (`src/platforms/google/google.adapter.ts`).
 *
 * What lot 2a carries: reading the links of our MCC and reading a client account — enough to connect
 * an account our MCC already manages. Sending an invitation, and withdrawing one, take the OAuth
 * credentials of a human admin of the MCC, which Google demands instead of a service account's:
 * they arrive in lot 2b with `pnpm google:connect`. The campaigns arrive in lot 3.
 */
import type { CallJournal } from '@src/services/platform-call.service';
import { httpError } from '@utils';
import type { DesiredUnit } from '../desired-state';
import {
  ApplyResult,
  LinkedAccountInfo,
  LinkStatus,
  PlatformAdapter,
  PlatformConnection,
  PlatformContext,
  PlatformError,
  UnitRefs,
} from '../platform-adapter';
import { PlatformHttp } from '../platform-http';
import { GoogleServiceAccountAuth } from './google.auth';
import { describeGoogleAdsError, GoogleAdsClient } from './google.client';
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
  /** What a client account says of itself, run on that account. */
  customer: (): string =>
    'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, ' +
    'customer.manager FROM customer',
} as const;

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
 * @param input - As typed: `972-563-0707`, `9725630707`
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
 * @returns `972-563-0707`
 */
export function formatCustomerId(customerId: string): string {
  return `${customerId.slice(0, 3)}-${customerId.slice(3, 6)}-${customerId.slice(6)}`;
}

/**
 * The client account a link points at.
 *
 * @param resourceName - `customers/9725630707`
 * @returns `9725630707`, or `null`
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

/**
 * The refusal of a call that needs our inviter, the human admin of our MCC, before
 * `pnpm google:connect` has run: our credentials, never the client's.
 *
 * @param action - What it was asked to do
 * @returns The error
 */
function inviterMissing(action: string): PlatformError {
  return new PlatformError(
    'google_ads',
    `Google Ads lets only a human admin of our manager account ${action}: run pnpm google:connect first`,
    {
      statusCode: null,
      retryable: false,
      invalidCredentials: false,
      ownCredentials: true,
      requestId: null,
      code: 'inviter_missing',
    }
  );
}

/**
 * What the Google Ads adapter is built with.
 *
 * @property managerId - Our manager account, with or without its dashes
 * @property loadServiceAccountKey - Reads the JSON key of our service account, from the secret store
 * @property fetchFn - What sends the requests; a fake one in the tests
 * @property now - The clock; a fixed one in the tests
 */
export type GoogleAdsSetup = {
  managerId: string;
  loadServiceAccountKey: () => Promise<string>;
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

  /**
   * @param client - The calls of the API, through our manager account
   */
  constructor(private readonly client: GoogleAdsClient) {}

  /** @inheritdoc */
  public referenceOf(input: string): string | null {
    return normalizeCustomerId(input);
  }

  /**
   * Link a client account to our MCC — nothing to send when our MCC already manages it, or already
   * invited it (`docs/phase-10.md` § 7, point 10).
   *
   * @param reference - Its customer id, ten digits
   * @returns `active` when our MCC manages it, `pending` when an invitation waits
   * @throws PlatformError: `inviter_missing` when an invitation must leave, until lot 2b
   */
  public async requestLink(reference: string): Promise<'pending' | 'active'> {
    const status: GoogleClientLinkStatus | undefined = await this.statusOfClient(reference);
    if (status === 'ACTIVE') return 'active';
    if (status === 'PENDING') return 'pending';
    throw inviterMissing(`invite the account ${formatCustomerId(reference)}`);
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
   * @throws PlatformError: `inviter_missing` when one is pending, until lot 2b
   */
  public async cancelLink(reference: string): Promise<void> {
    if ((await this.statusOfClient(reference)) !== 'PENDING') return;
    throw inviterMissing(`withdraw the invitation of ${formatCustomerId(reference)}`);
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
   * The campaigns arrive in lot 3 (`docs/phase-10.md` § 1). Until then Google Ads has no couple in
   * `PLATFORM_RULES`, so no unit exists and the engine never calls this.
   *
   * @param _context - Account and credentials
   * @param _desired - What must be true over there
   * @param _refs - What exists
   * @returns Never
   * @throws Error with status 500 coded `sync_adapter_missing`
   */
  public apply(_context: PlatformContext, _desired: DesiredUnit, _refs: UnitRefs): Promise<ApplyResult> {
    return Promise.reject(
      httpError(500, 'The Google Ads campaigns arrive with lot 3 of phase 10', {
        code: 'sync_adapter_missing',
        params: { platform: 'google_ads' },
      })
    );
  }

  /**
   * Where the latest link of our MCC to a client account stands.
   *
   * @param clientId - Its customer id
   * @returns Google's status of it, `undefined` without any link
   */
  private async statusOfClient(clientId: string): Promise<GoogleClientLinkStatus | undefined> {
    return latestStatusOf(await this.client.search(null, this.client.managerId, GAQL.clientLinksOf(clientId)));
  }
}

/**
 * Build the adapter of Google Ads, with what reads our credentials.
 *
 * @param setup - Our MCC and the reading of our service account's key
 * @param journal - Where every call is recorded
 * @returns The adapter
 * @throws Error when the configured MCC is not a customer id
 *
 * @example
 * ```typescript
 * registerAdapter(createGoogleAdsAdapter({ managerId: '771-934-5054', loadServiceAccountKey }, journal));
 * ```
 */
export function createGoogleAdsAdapter(setup: GoogleAdsSetup, journal: CallJournal): GoogleAdsAdapter {
  const managerId: string | null = normalizeCustomerId(setup.managerId);
  if (managerId === null) throw new Error(`The Google Ads manager account ${setup.managerId} is not a customer id`);
  const auth = new GoogleServiceAccountAuth(setup.loadServiceAccountKey, setup.fetchFn, setup.now);
  const http = new PlatformHttp({
    platform: 'google_ads',
    baseUrl: GOOGLE_ADS_API.baseUrl,
    timeoutMs: GOOGLE_ADS_API.timeoutMs,
    requestIdHeader: GOOGLE_ADS_API.requestIdHeader,
    journal,
    authorization: async (): Promise<string> => `Bearer ${await auth.accessToken()}`,
    describeError: describeGoogleAdsError,
    fetchFn: setup.fetchFn,
  });
  return new GoogleAdsAdapter(new GoogleAdsClient(http, managerId, (): void => auth.invalidate()));
}
