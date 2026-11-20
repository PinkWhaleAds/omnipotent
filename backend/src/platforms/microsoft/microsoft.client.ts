/**
 * @module platforms/microsoft/microsoft.client
 *
 * Typed calls of Microsoft Advertising's Customer Management service, on top of {@link PlatformHttp}:
 * our service user's token, our developer token, a timeout, the journal, and Microsoft's errors read
 * so that the engine knows what to do with them. Transcribed from multi-search
 * (`src/platforms/microsoft/microsoft.client.ts`); the campaigns' services arrive in lot B.
 */
import { PlatformError } from '@src/platforms/platform-adapter';
import type {
  PlatformErrorDescription,
  PlatformFailure,
  PlatformHttp,
  PlatformRequest,
  PlatformSuccess,
} from '@src/platforms/platform-http';
import { MicrosoftAccount, MicrosoftClientLink, MicrosoftErrorEntry, MicrosoftFaultBody } from './microsoft.types';

/** HTTP statuses after which trying again later can succeed. */
const RETRYABLE_HTTP: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Error codes, numeric and symbolic, after which trying again later can succeed: an internal error,
 * too many calls a minute, a timeout, data changed meanwhile, an account being linked, an expired
 * access token.
 */
const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  '0',
  '109',
  '117',
  '207',
  '833',
  '1472',
  '4149',
  'InternalError',
  'AuthenticationTokenExpired',
  'CallRateExceeded',
  'ConcurrentRequestOverLimit',
  'ServiceTimeOut',
]);

/** Error codes saying we lost access to the **client's** account: that account becomes `invalid`. */
const LOST_ACCOUNT_CODES: ReadonlySet<string> = new Set(['106', '2003', 'UserIsNotAuthorized']);

/**
 * Error codes saying **our** credentials failed — the developer token, the service user's rights:
 * the client can do nothing, an operator must act, and no account is touched (`docs/phase-10.md`
 * § 4.2). `109`, an expired access token, is retried with a new one before it gets here.
 */
const OWN_CREDENTIAL_CODES: ReadonlySet<string> = new Set(['105', '108', '116', '120', '122', '1001']);

/** Codes of an access token Microsoft refused: drop it, get a new one, send again. */
const EXPIRED_TOKEN_CODES: ReadonlySet<string> = new Set(['109', 'AuthenticationTokenExpired']);

/** Client links per page of `SearchClientLinks`, and accounts per page of `SearchAccounts`. */
const PAGE_SIZE = 100;

/** Most pages read: past them a read fails rather than miss links or accounts. */
const MAX_PAGES = 100;

/**
 * The error entries of a list that may hold `null`s, nested lists — Customer Management's partial
 * errors — and entries holding their own `BatchErrors`.
 *
 * @param items - The list
 * @returns The entries, flattened
 */
function flatten(items: unknown): MicrosoftErrorEntry[] {
  if (!Array.isArray(items)) return [];
  const entries: MicrosoftErrorEntry[] = [];
  for (const item of items as unknown[]) {
    if (Array.isArray(item)) entries.push(...flatten(item));
    else if (typeof item === 'object' && item !== null) {
      const entry: MicrosoftErrorEntry = item as MicrosoftErrorEntry;
      if (entry.Code !== undefined || entry.ErrorCode || entry.Message) entries.push(entry);
      entries.push(...flatten(entry.BatchErrors));
    }
  }
  return entries;
}

/**
 * The code of an error entry: its number, which Customer Management always gives, else its name.
 *
 * @param entry - The entry
 * @returns For example `1410`, or `null`
 */
function codeOf(entry: MicrosoftErrorEntry): string | null {
  if (entry.Code !== undefined && entry.Code !== null && String(entry.Code) !== '') return String(entry.Code);
  return entry.ErrorCode || null;
}

/**
 * A readable line for one error: its message, its details, where, and its codes.
 *
 * @param entry - The entry
 * @returns For example `The account is already linked. [1410 ...]`
 */
function describeEntry(entry: MicrosoftErrorEntry): string {
  const message: string = entry.Message || 'Microsoft Advertising error';
  const details: string | undefined = entry.Details || undefined;
  const codes: string = [entry.Code, entry.ErrorCode]
    .filter((code: unknown): boolean => code !== undefined && code !== null && String(code) !== '')
    .join(' ');
  return [
    message,
    details && details !== message ? `(${details})` : null,
    entry.FieldPath ? `at ${entry.FieldPath}` : null,
    codes ? `[${codes}]` : null,
  ]
    .filter((part: string | null): part is string => part !== null)
    .join(' ');
}

/**
 * What a list of errors means.
 *
 * @param entries - The errors, one at least
 * @param statusCode - HTTP status, `null` without response
 * @param requestId - Request id
 * @returns The description
 */
function describeEntries(
  entries: MicrosoftErrorEntry[],
  statusCode: number | null,
  requestId: string | null
): PlatformErrorDescription {
  const codes: string[] = entries.flatMap((entry: MicrosoftErrorEntry): string[] =>
    [entry.Code, entry.ErrorCode]
      .filter((code: unknown): boolean => code !== undefined && code !== null && String(code) !== '')
      .map(String)
  );
  return {
    message: [...new Set(entries.map(describeEntry))].join('; '),
    code: codeOf(entries[0]),
    codes,
    requestId,
    retryable:
      statusCode === null ||
      RETRYABLE_HTTP.has(statusCode) ||
      codes.some((code: string): boolean => RETRYABLE_CODES.has(code)),
    invalidCredentials: codes.some((code: string): boolean => LOST_ACCOUNT_CODES.has(code)),
    ownCredentials: statusCode === 401 || codes.some((code: string): boolean => OWN_CREDENTIAL_CODES.has(code)),
  };
}

/**
 * The reading of a failed Microsoft Advertising call: the `ApiFault` of Customer Management
 * (`OperationErrors`), `ApiFaultDetail` (`BatchErrors`) and `AdApiFaultDetail` (`Errors`).
 *
 * - **The message** lists every error with its codes; **the code** is the first error's number.
 * - **The request id** is the `TrackingId` header, else the body's.
 * - **Retryable**: no response, 408, 429, 5xx, and the codes Microsoft documents as passing.
 * - **`invalidCredentials`** only when we lost access to the client's account itself (106, 2003), and
 *   **`ownCredentials`** when ours failed — a 401 that survives a new token, or their codes.
 *
 * @param failure - Status, body and request id of the failed call
 * @returns What it means
 */
export function describeMicrosoftError(failure: PlatformFailure): PlatformErrorDescription {
  const body: MicrosoftFaultBody =
    typeof failure.data === 'object' && failure.data !== null ? (failure.data as MicrosoftFaultBody) : {};
  const requestId: string | null = failure.requestId ?? body.TrackingId ?? null;
  const entries: MicrosoftErrorEntry[] = [
    ...flatten(body.Errors),
    ...flatten(body.OperationErrors),
    ...flatten(body.BatchErrors),
  ];
  if (entries.length === 0 && (body.Code !== undefined || body.Message)) entries.push(body);
  if (entries.length > 0) return describeEntries(entries, failure.statusCode, requestId);
  return {
    message:
      failure.statusCode === null
        ? failure.error instanceof Error
          ? failure.error.message
          : String(failure.error)
        : `Microsoft Advertising answered HTTP ${failure.statusCode}`,
    code: null,
    requestId,
    retryable: failure.statusCode === null || RETRYABLE_HTTP.has(failure.statusCode),
    invalidCredentials: false,
    ownCredentials: failure.statusCode === 401,
  };
}

/**
 * The reading of a successful answer: Microsoft writes item by item, so an answer with a success
 * status may carry failures (`PartialErrors`, Customer Management's `OperationErrors`). Any of them
 * fails the call.
 *
 * @param response - Status, body and request id of the answer
 * @returns What the failures mean, or `null` when every item succeeded
 */
export function checkMicrosoftResponse(response: PlatformSuccess): PlatformErrorDescription | null {
  const body: MicrosoftFaultBody =
    typeof response.data === 'object' && response.data !== null ? (response.data as MicrosoftFaultBody) : {};
  const entries: MicrosoftErrorEntry[] = [...flatten(body.OperationErrors), ...flatten(body.PartialErrors)];
  if (entries.length === 0) return null;
  return describeEntries(entries, response.statusCode, response.requestId ?? body.TrackingId ?? null);
}

/**
 * Whether an error is Microsoft refusing our access token.
 *
 * @param error - What a call threw
 * @returns `true` for an HTTP 401 or error 109
 */
function isRefusedToken(error: unknown): boolean {
  return (
    error instanceof PlatformError &&
    (error.options.statusCode === 401 || EXPIRED_TOKEN_CODES.has(error.options.code ?? ''))
  );
}

/**
 * What the client needs of our credentials, beyond the access token its HTTP client sends.
 *
 * @property developerToken - Our developer token, sent with every call
 * @property invalidate - Drops the access token Microsoft refused
 */
export type MicrosoftClientAuth = { developerToken: () => Promise<string>; invalidate: () => void };

/**
 * The calls of Customer Management, every one as our service user.
 *
 * No logic beyond paging: one method per operation, each costing one call of the journal.
 */
export class MicrosoftAdsClient {
  /**
   * @param http - HTTP client of Customer Management, with our service user's token
   * @param customerId - Our manager account's customer id
   * @param auth - Our developer token, and the dropping of a refused access token
   */
  constructor(
    private readonly http: PlatformHttp,
    public readonly customerId: string,
    private readonly auth: MicrosoftClientAuth
  ) {}

  /**
   * Every account a customer owns.
   *
   * @param customerId - The customer
   * @returns Its accounts
   * @throws PlatformError, and an error past the pages read
   */
  public async accountsOf(customerId: string): Promise<MicrosoftAccount[]> {
    return this.everyPage<MicrosoftAccount>(async (index: number): Promise<MicrosoftAccount[]> => {
      const body = await this.send<{ Accounts?: MicrosoftAccount[] | null }>({
        method: 'POST',
        path: '/Accounts/Search',
        body: {
          Predicates: [{ Field: 'CustomerId', Operator: 'Equals', Value: customerId }],
          PageInfo: { Index: index, Size: PAGE_SIZE },
        },
      });
      return body.Accounts ?? [];
    });
  }

  /**
   * Every link our manager account has to a client account or a client customer.
   *
   * @returns The links, ordered by the client's number
   * @throws PlatformError, and an error past the pages read
   */
  public async clientLinks(): Promise<MicrosoftClientLink[]> {
    return this.everyPage<MicrosoftClientLink>(async (index: number): Promise<MicrosoftClientLink[]> => {
      const body = await this.send<{ ClientLinks?: MicrosoftClientLink[] | null }>({
        method: 'POST',
        path: '/ClientLinks/Search',
        body: {
          Predicates: [{ Field: 'DirectManagingCustomerId', Operator: 'Equals', Value: this.customerId }],
          Ordering: [{ Field: 'Number', Order: 'Ascending' }],
          PageInfo: { Index: index, Size: PAGE_SIZE },
        },
      });
      return body.ClientLinks ?? [];
    });
  }

  /**
   * Send links: invitations a Super Admin of each client accepts.
   *
   * @param links - The links
   * @returns A promise that resolves once sent
   */
  public async addClientLinks(links: MicrosoftClientLink[]): Promise<void> {
    await this.send({ method: 'POST', path: '/ClientLinks', body: { ClientLinks: links } });
  }

  /**
   * Change links: withdraw an invitation (`LinkCanceled`).
   *
   * @param links - The links, with their new status
   * @returns A promise that resolves once changed
   */
  public async updateClientLinks(links: MicrosoftClientLink[]): Promise<void> {
    await this.send({ method: 'PUT', path: '/ClientLinks', body: { ClientLinks: links } });
  }

  /**
   * One account, with its mode — Expert or Smart.
   *
   * @param accountId - Its id
   * @returns The account
   */
  public async account(accountId: string): Promise<MicrosoftAccount> {
    const body = await this.send<{ Account?: MicrosoftAccount | null }>({
      method: 'POST',
      path: '/Account/Query',
      body: { AccountId: accountId, ReturnAdditionalFields: 'AccountMode' },
    });
    return body.Account ?? {};
  }

  /**
   * Read every page of a search, until one comes back short.
   *
   * @typeParam T - What a page holds
   * @param page - Reads one page, from 0
   * @returns Every item
   * @throws Error past {@link MAX_PAGES}, rather than miss some
   */
  private async everyPage<T>(page: (index: number) => Promise<T[]>): Promise<T[]> {
    const items: T[] = [];
    for (let index = 0; index < MAX_PAGES; index++) {
      const found: T[] = await page(index);
      items.push(...found);
      if (found.length < PAGE_SIZE) return items;
    }
    throw new Error(`Microsoft Advertising answered more than ${MAX_PAGES * PAGE_SIZE} items: read refused`);
  }

  /**
   * Send a request with our developer token. An access token Microsoft refuses is dropped and the
   * request sent once more with a new one.
   *
   * @typeParam T - Shape of the answer
   * @param request - The request
   * @returns The answer
   */
  private async send<T>(request: PlatformRequest): Promise<T> {
    const sent: PlatformRequest = { ...request, headers: { DeveloperToken: await this.auth.developerToken() } };
    try {
      return await this.http.request<T>(null, sent);
    } catch (error: unknown) {
      if (!isRefusedToken(error)) throw error;
      this.auth.invalidate();
      return this.http.request<T>(null, sent);
    }
  }
}
