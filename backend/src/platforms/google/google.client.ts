/**
 * @module platforms/google/google.client
 *
 * Typed calls of the Google Ads REST API, on top of {@link PlatformHttp}: our service account's
 * token, a timeout, the journal, and Google's errors read so that the engine knows what to do with
 * them. Transcribed from multi-search (`src/platforms/google/google.client.ts`).
 */
import { PlatformError } from '@src/platforms/platform-adapter';
import type {
  PlatformErrorDescription,
  PlatformFailure,
  PlatformHttp,
  PlatformRequest,
} from '@src/platforms/platform-http';
import {
  GOOGLE_ADS_API,
  GoogleAdsErrorBody,
  GoogleAdsErrorEntry,
  GoogleAdsFailure,
  GoogleAdsRow,
  GoogleAdsSearchResponse,
} from './google.types';

/** gRPC statuses after which trying again later can succeed. */
const RETRYABLE_STATUSES: ReadonlySet<string> = new Set([
  'ABORTED',
  'DEADLINE_EXCEEDED',
  'INTERNAL',
  'RESOURCE_EXHAUSTED',
  'UNAVAILABLE',
  'UNKNOWN',
]);

/** Google Ads error codes after which trying again later can succeed. */
const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  'CONCURRENT_MODIFICATION',
  'DEADLINE_EXCEEDED',
  'INTERNAL_ERROR',
  'RESOURCE_EXHAUSTED',
  'RESOURCE_TEMPORARILY_EXHAUSTED',
  'TRANSIENT_ERROR',
]);

/** HTTP statuses after which trying again later can succeed. */
const RETRYABLE_HTTP: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

/**
 * Google Ads error codes saying we lost access to the **client's** account (link ended, account
 * cancelled, suspended or gone): that account becomes `invalid`.
 */
const LOST_ACCOUNT_CODES: ReadonlySet<string> = new Set([
  'USER_PERMISSION_DENIED',
  'INVALID_LOGIN_CUSTOMER_ID_SERVING_CUSTOMER_ID_COMBINATION',
  'CUSTOMER_NOT_ENABLED',
  'ACTION_NOT_PERMITTED_FOR_SUSPENDED_ACCOUNT',
  'CUSTOMER_NOT_FOUND',
]);

/**
 * Google Ads error codes and gRPC statuses saying **our** credentials or project failed: the client
 * can do nothing, an operator must act, and no account is touched (`docs/phase-10.md` § 4.2,
 * `docs/plateformes/google-ads.md` § 4).
 */
const OWN_CREDENTIAL_CODES: ReadonlySet<string> = new Set([
  'UNAUTHENTICATED',
  'NOT_ADS_USER',
  'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION',
  'DEVELOPER_TOKEN_NOT_APPROVED',
  'OAUTH_TOKEN_INVALID',
  'OAUTH_TOKEN_EXPIRED',
]);

/**
 * The `GoogleAdsFailure` of an error body, when it has one.
 *
 * @param body - The error body
 * @returns The failure, or `null`
 */
function failureOf(body: GoogleAdsErrorBody['error'] | undefined): GoogleAdsFailure | null {
  const failure = body?.details?.find(
    (detail): boolean => typeof detail['@type'] === 'string' && detail['@type'].endsWith('.GoogleAdsFailure')
  );
  return (failure as GoogleAdsFailure | undefined) ?? null;
}

/**
 * The family and code of one Google Ads error.
 *
 * @param entry - The error
 * @returns For example `['authorizationError', 'USER_PERMISSION_DENIED']`, or `null` without code
 */
function codeOf(entry: GoogleAdsErrorEntry): [string, string] | null {
  const [pair] = Object.entries(entry.errorCode ?? {});
  return pair ? [pair[0], String(pair[1])] : null;
}

/**
 * A readable line for one Google Ads error: its message, the faulty value and its code.
 *
 * @param entry - The error
 * @returns For example `The customer is not enabled. [authorizationError.CUSTOMER_NOT_ENABLED]`
 */
function describeEntry(entry: GoogleAdsErrorEntry): string {
  const code: [string, string] | null = codeOf(entry);
  const trigger: string | undefined = entry.trigger?.stringValue;
  return [entry.message ?? 'Google Ads error', trigger ? `("${trigger}")` : null, code ? `[${code.join('.')}]` : null]
    .filter((part: string | null): part is string => part !== null)
    .join(' ');
}

/**
 * The reading of a failed Google Ads call: the envelope `{ error: { code, message, status, details } }`
 * and its `GoogleAdsFailure`.
 *
 * - **The message** lists every Google Ads error with its code; without one, the envelope's message
 *   and gRPC status.
 * - **The code** is the first Google Ads error code, else the gRPC status; `codes` lists them all,
 *   the one that matters not always coming first.
 * - **Retryable**: no response, 429 and 5xx, and what Google documents as transient.
 * - **`invalidCredentials`** only when we lost access to the client's account itself, and
 *   **`ownCredentials`** when ours failed — a 401, which survives a new token, or their codes.
 *
 * @param failure - Status, body and request id of the failed call
 * @returns What it means
 */
export function describeGoogleAdsError(failure: PlatformFailure): PlatformErrorDescription {
  const body: GoogleAdsErrorBody['error'] | undefined =
    typeof failure.data === 'object' && failure.data !== null
      ? ((failure.data as GoogleAdsErrorBody).error ?? undefined)
      : undefined;
  const googleFailure: GoogleAdsFailure | null = failureOf(body);
  const entries: GoogleAdsErrorEntry[] = googleFailure?.errors ?? [];
  const codes: string[] = entries
    .map(codeOf)
    .filter((code: [string, string] | null): code is [string, string] => code !== null)
    .map(([, code]: [string, string]): string => code);
  const status: string | null = typeof body?.status === 'string' ? body.status : null;

  let message: string;
  if (entries.length > 0) {
    message = entries.map(describeEntry).join('; ');
  } else if (body?.message) {
    message = status ? `${body.message} [${status}]` : body.message;
  } else if (failure.statusCode === null) {
    message = failure.error instanceof Error ? failure.error.message : String(failure.error);
  } else {
    message = `Google Ads answered HTTP ${failure.statusCode}`;
  }

  return {
    message,
    code: codes[0] ?? status,
    codes,
    requestId: failure.requestId ?? googleFailure?.requestId ?? null,
    retryable:
      failure.statusCode === null ||
      RETRYABLE_HTTP.has(failure.statusCode) ||
      (status !== null && RETRYABLE_STATUSES.has(status)) ||
      codes.some((code: string): boolean => RETRYABLE_CODES.has(code)),
    invalidCredentials: codes.some((code: string): boolean => LOST_ACCOUNT_CODES.has(code)),
    ownCredentials:
      failure.statusCode === 401 ||
      (status !== null && OWN_CREDENTIAL_CODES.has(status)) ||
      codes.some((code: string): boolean => OWN_CREDENTIAL_CODES.has(code)),
  };
}

/**
 * The calls of the Google Ads API, every one through our manager account (`login-customer-id`).
 *
 * No logic beyond paging and one retry: one method per endpoint. Each call tells the journal what it
 * costs against the project's daily quota, as Google counts it — one per search, its next pages free.
 */
export class GoogleAdsClient {
  /**
   * @param http - HTTP client of the API, with our service account's token
   * @param managerId - Our manager account, ten digits
   * @param onUnauthenticated - Drops the token kept, when Google refuses it (401), before the one retry
   */
  constructor(
    private readonly http: PlatformHttp,
    public readonly managerId: string,
    private readonly onUnauthenticated: () => void
  ) {}

  /**
   * Run a GAQL query and read every page.
   *
   * @param adAccountId - Our account the query is for, for the journal; `null` for our manager's own
   * @param customerId - The account queried, ten digits
   * @param query - GAQL
   * @returns Every row
   * @throws PlatformError
   */
  public async search(adAccountId: string | null, customerId: string, query: string): Promise<GoogleAdsRow[]> {
    const rows: GoogleAdsRow[] = [];
    let pageToken: string | undefined;
    do {
      const page: GoogleAdsSearchResponse = await this.send<GoogleAdsSearchResponse>(adAccountId, {
        method: 'POST',
        path: `/customers/${customerId}/googleAds:search`,
        body: pageToken ? { query, pageToken } : { query },
        operations: pageToken ? 0 : 1,
      });
      rows.push(...(page.results ?? []));
      pageToken = page.nextPageToken || undefined;
    } while (pageToken);
    return rows;
  }

  /**
   * Send a request through our manager account. A token Google refuses (401) is dropped and the
   * request sent once more with a new one: a 401 that survives it is our credentials failing.
   *
   * @typeParam T - Shape of the answer
   * @param adAccountId - Our account, for the journal
   * @param request - The request
   * @returns The answer
   */
  private async send<T>(adAccountId: string | null, request: PlatformRequest): Promise<T> {
    const withManager: PlatformRequest = {
      ...request,
      headers: { [GOOGLE_ADS_API.loginCustomerHeader]: this.managerId },
    };
    try {
      return await this.http.request<T>(adAccountId, withManager);
    } catch (error: unknown) {
      if (!(error instanceof PlatformError) || error.options.statusCode !== 401) throw error;
      this.onUnauthenticated();
      return this.http.request<T>(adAccountId, withManager);
    }
  }
}
