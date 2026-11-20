/**
 * @module platforms/microsoft/microsoft.adapter
 *
 * The adapter of Microsoft Advertising: a `manager_link` platform, whose accounts our manager account
 * manages once a Super Admin of their client accepts, with **our** service user's credentials
 * (`docs/phase-11.md`). Transcribed from multi-search (`src/platforms/microsoft/microsoft.adapter.ts`),
 * with one case it does not have: an account **our own** customer owns is ours to manage at once,
 * without any link (point 9 of `docs/phase-11.md` § 5). The campaigns arrive in lot B.
 */
import type { CallJournal } from '@src/services/platform-call.service';
import type { AdAccountScope } from '@src/types';
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
import { MicrosoftCredentialsStore, MicrosoftOAuthTokens, WithLock } from './microsoft.auth';
import { checkMicrosoftResponse, describeMicrosoftError, MicrosoftAdsClient } from './microsoft.client';
import { ianaTimeZone } from './microsoft-timezones';
import { MICROSOFT_ADS_API, MicrosoftAccount, MicrosoftClientLink } from './microsoft.types';

/** Our statuses of a link, from Microsoft's. */
const LINK_STATUSES: Readonly<Record<string, LinkStatus>> = {
  LinkPending: 'pending',
  LinkAccepted: 'pending',
  LinkInProgress: 'pending',
  Active: 'active',
  UnlinkFailed: 'active',
  LinkDeclined: 'refused',
  LinkFailed: 'refused',
  LinkCanceled: 'refused',
  LinkExpired: 'expired',
  UnlinkRequested: 'ended',
  UnlinkPending: 'ended',
  UnlinkInProgress: 'ended',
  Inactive: 'ended',
};

/** Microsoft's code of an account already invited by our manager account. */
const ALREADY_INVITED = '1410';

/** Microsoft's code of a prepaid account, which no manager account may manage. */
const PREPAID = '1471';

/**
 * A Microsoft account number, as the client reads it in Tools → All accounts.
 *
 * @param input - As typed
 * @returns Eight letters and digits, upper case, or `null`
 */
export function normalizeAccountNumber(input: string): string | null {
  const number: string = input.trim().toUpperCase();
  return /^[A-Z0-9]{8}$/.test(number) ? number : null;
}

/**
 * Our status of a link.
 *
 * @param status - Microsoft's
 * @returns Ours, or `null` for a status the table does not know
 */
function linkStatusOf(status: string | null | undefined): LinkStatus | null {
  return LINK_STATUSES[status ?? ''] ?? null;
}

/**
 * A refusal **we** word, with a stable code the caller reads (`docs/phase-11.md` § 2).
 *
 * @param message - What it says
 * @param messageCode - Our code
 * @param messageParams - The values of its message
 * @returns The error
 */
function refusal(
  message: string,
  messageCode: string,
  messageParams: Record<string, string | number> = {}
): PlatformError {
  return new PlatformError('microsoft', message, {
    statusCode: null,
    retryable: false,
    invalidCredentials: false,
    requestId: null,
    messageCode,
    messageParams: { platform: 'microsoft', ...messageParams },
  });
}

/**
 * What the Microsoft adapter is built with.
 *
 * @property customerId - Our manager account's customer id
 * @property credentials - Where our application and our service user's tokens live
 * @property withLock - The lock every process shares, taken to renew the tokens
 * @property fetchFn - What sends the requests; a fake one in the tests
 * @property now - The clock; a fixed one in the tests
 */
export type MicrosoftAdsSetup = {
  customerId: string;
  credentials: MicrosoftCredentialsStore;
  withLock: WithLock;
  fetchFn?: typeof fetch;
  now?: () => number;
};

/**
 * The adapter of Microsoft Advertising.
 */
export class MicrosoftAdsAdapter implements PlatformAdapter {
  /** @inheritdoc */
  public readonly platform = 'microsoft' as const;

  /** @inheritdoc */
  public readonly connection: PlatformConnection = 'manager_link';

  /**
   * @param client - The calls of Customer Management, as our service user
   */
  constructor(private readonly client: MicrosoftAdsClient) {}

  /** @inheritdoc */
  public referenceOf(input: string): string | null {
    return normalizeAccountNumber(input);
  }

  /**
   * Link a client account to our manager account — nothing to send when our own customer owns it, or
   * when our manager account already manages it, or already invited it.
   *
   * Otherwise the invitation leaves, and it needs the **customer number** of the account's client:
   * without it Microsoft answers an empty 400 (multi-search, 2026-10-18), so it is refused before.
   *
   * @param reference - Its account number
   * @param scope - Its scope, carrying `customerNumber` for an account to invite
   * @returns `active` when ours or managed, `pending` when an invitation waits
   * @throws PlatformError: our refusals for a missing customer number or a prepaid account, Microsoft's
   *   otherwise
   */
  public async requestLink(reference: string, scope: AdAccountScope): Promise<'pending' | 'active'> {
    if (await this.ownAccount(reference)) return 'active';
    const latest: LinkStatus | null = linkStatusOf((await this.linksOf(reference)).at(-1)?.Status);
    if (latest === 'active' || latest === 'pending') return latest;

    const customerNumber: string = String(scope.customerNumber ?? '')
      .trim()
      .toUpperCase();
    if (!customerNumber) {
      throw refusal(
        `Microsoft Advertising account ${reference} cannot be invited without the customer number of the client that owns it`,
        'ad_account_customer_number_required'
      );
    }
    try {
      await this.client.addClientLinks([
        {
          Type: 'AccountLink',
          ClientEntityNumber: reference,
          ClientEntityCustomerNumber: customerNumber,
          ManagingCustomerId: this.client.customerId,
          IsBillToClient: true,
          Name: 'Omnipotent',
          SuppressNotification: false,
        },
      ]);
      return 'pending';
    } catch (error: unknown) {
      if (!(error instanceof PlatformError)) throw error;
      if (error.options.code === ALREADY_INVITED) return 'pending';
      if (error.options.code === PREPAID) {
        throw refusal(
          `Microsoft Advertising account ${reference} is prepaid: its client must switch to monthly invoicing first`,
          'ad_account_prepaid'
        );
      }
      throw error;
    }
  }

  /** @inheritdoc */
  public async linkStatuses(): Promise<Map<string, LinkStatus>> {
    const statuses = new Map<string, LinkStatus>();
    for (const link of await this.accountLinks()) {
      const status: LinkStatus | null = linkStatusOf(link.Status);
      if (status !== null) statuses.set(String(link.ClientEntityNumber).toUpperCase(), status);
    }
    return statuses;
  }

  /**
   * Withdraw the pending invitation of a client account; nothing happens when none is pending.
   *
   * @param reference - Its account number
   * @returns A promise that resolves once no invitation is pending
   * @throws PlatformError
   */
  public async cancelLink(reference: string): Promise<void> {
    const latest: MicrosoftClientLink | undefined = (await this.linksOf(reference)).at(-1);
    if (latest?.Status !== 'LinkPending') return;
    await this.client.updateClientLinks([
      {
        Type: 'AccountLink',
        ClientEntityId: latest.ClientEntityId,
        ClientEntityNumber: reference,
        ManagingCustomerId: this.client.customerId,
        Status: 'LinkCanceled',
      },
    ]);
  }

  /**
   * Read a client account — ours, or one our manager account manages — refusing what Microsoft does
   * not let a manager run: a Smart account, an inactive or suspended one, and a time zone the table
   * does not know, which is never guessed (`docs/phase-11.md` § 2).
   *
   * @param reference - Its account number
   * @returns Its id, name, currency and time zone
   * @throws PlatformError, our refusals coded
   */
  public async readLinkedAccount(reference: string): Promise<LinkedAccountInfo> {
    const accountId: string | null = await this.accountIdOf(reference);
    if (accountId === null) {
      throw refusal(
        `Microsoft Advertising account ${reference} is not managed by our manager account`,
        'ad_account_link_not_active'
      );
    }
    const account: MicrosoftAccount = await this.client.account(accountId);
    if (account.AccountMode && account.AccountMode !== 'Expert') {
      throw refusal(
        `Microsoft Advertising account ${reference} is a ${account.AccountMode} account: its client switches it to Expert first`,
        'ad_account_not_expert',
        { mode: account.AccountMode }
      );
    }
    if (account.AccountLifeCycleStatus === 'Inactive' || account.AccountLifeCycleStatus === 'Suspended') {
      throw refusal(
        `Microsoft Advertising account ${reference} is ${account.AccountLifeCycleStatus.toLowerCase()}`,
        'ad_account_inactive',
        { status: account.AccountLifeCycleStatus }
      );
    }
    const timezone: string | null = ianaTimeZone(account.TimeZone);
    if (timezone === null || !account.CurrencyCode) {
      throw refusal(
        `Microsoft Advertising account ${reference} has a time zone or a currency Omnipotent does not know`,
        'ad_account_timezone_unknown',
        { timezone: account.TimeZone ?? '' }
      );
    }
    return {
      externalId: accountId,
      name: account.Name?.trim() || `Microsoft Advertising ${reference}`,
      currency: account.CurrencyCode.toUpperCase(),
      timezone,
      manager: false,
    };
  }

  /**
   * The campaigns arrive in lot B (`docs/phase-11.md` § 1). Until then Microsoft has no couple in
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
      httpError(500, 'The Microsoft Advertising campaigns arrive with lot B of phase 11', {
        code: 'sync_adapter_missing',
        params: { platform: 'microsoft' },
      })
    );
  }

  /**
   * The account of that number our own customer owns, if it does.
   *
   * @param reference - The account number
   * @returns The account, or `undefined`
   */
  private async ownAccount(reference: string): Promise<MicrosoftAccount | undefined> {
    return (await this.client.accountsOf(this.client.customerId)).find(
      (account: MicrosoftAccount): boolean => String(account.Number).toUpperCase() === reference
    );
  }

  /**
   * The id the calls take for an account: ours, or the client's under an active link.
   *
   * @param reference - The account number
   * @returns Its id, or `null` when it is neither
   */
  private async accountIdOf(reference: string): Promise<string | null> {
    const own: MicrosoftAccount | undefined = await this.ownAccount(reference);
    if (own?.Id !== undefined) return String(own.Id);
    const link: MicrosoftClientLink | undefined = (await this.linksOf(reference))
      .filter((item: MicrosoftClientLink): boolean => linkStatusOf(item.Status) === 'active')
      .at(-1);
    return link?.ClientEntityId ? String(link.ClientEntityId) : null;
  }

  /**
   * Every link of our manager account to a client **account**, the links to whole customers — an
   * agency's — aside.
   *
   * @returns The links
   */
  private async accountLinks(): Promise<MicrosoftClientLink[]> {
    return (await this.client.clientLinks()).filter(
      (link: MicrosoftClientLink): boolean => link.Type === 'AccountLink'
    );
  }

  /**
   * The links to one client account, in the order Microsoft answers them: the latest last.
   *
   * @param reference - The account number
   * @returns Its links
   */
  private async linksOf(reference: string): Promise<MicrosoftClientLink[]> {
    return (await this.accountLinks()).filter(
      (link: MicrosoftClientLink): boolean => String(link.ClientEntityNumber).toUpperCase() === reference
    );
  }
}

/**
 * Build the adapter of Microsoft Advertising, with what reads and renews our credentials.
 *
 * @param setup - Our manager account, our secrets and the lock
 * @param journal - Where every call is recorded
 * @returns The adapter
 */
export function createMicrosoftAdsAdapter(setup: MicrosoftAdsSetup, journal: CallJournal): MicrosoftAdsAdapter {
  const tokens = new MicrosoftOAuthTokens(setup.credentials, setup.withLock, setup.fetchFn, setup.now);
  const http = new PlatformHttp({
    platform: 'microsoft',
    baseUrl: MICROSOFT_ADS_API.customerUrl,
    timeoutMs: MICROSOFT_ADS_API.timeoutMs,
    requestIdHeader: MICROSOFT_ADS_API.requestIdHeader,
    journal,
    authorization: async (): Promise<string> => `Bearer ${await tokens.accessToken()}`,
    describeError: describeMicrosoftError,
    checkResponse: checkMicrosoftResponse,
    fetchFn: setup.fetchFn,
  });
  return new MicrosoftAdsAdapter(
    new MicrosoftAdsClient(http, setup.customerId, {
      developerToken: (): Promise<string> => tokens.developerToken(),
      invalidate: (): void => tokens.invalidate(),
    })
  );
}
