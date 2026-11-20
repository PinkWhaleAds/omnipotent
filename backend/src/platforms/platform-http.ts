/**
 * @module platforms/platform-http
 *
 * The one HTTP client every platform goes through (`../../CADRAGE.md` § 14): its authentication, a
 * timeout, **one line of journal per call**, and every failure turned into a {@link PlatformError}
 * the engine knows how to react to.
 *
 * Written on `fetch`, which Node carries, rather than on the `axios` of multi-search: one dependency
 * less, and the omnipass client already works this way.
 */
import type { CallJournal } from '@src/services/platform-call.service';
import type { Platform } from '@src/types/platform.types';
import { PlatformError } from './platform-adapter';

/**
 * One request to a platform.
 *
 * @property method - HTTP method
 * @property path - Path under the base URL, starting with `/`
 * @property body - JSON body
 * @property headers - Extra headers (the Google manager account, for instance)
 * @property operations - What the call costs against the platform's daily quota, as the journal
 *   counts it (D45): each operation of a Google `mutate`, 0 for the next pages of a Google search; 1
 *   when absent
 */
export type PlatformRequest = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  operations?: number;
};

/**
 * A failed call, as a platform's reading of its errors receives it.
 *
 * @property statusCode - HTTP status, `null` when no response came back (timeout, network)
 * @property data - Response body, parsed when it is JSON
 * @property requestId - Request id read in the response headers
 * @property error - What was thrown, when no response came back
 */
export type PlatformFailure = {
  statusCode: number | null;
  data: unknown;
  requestId: string | null;
  error: unknown;
};

/**
 * What a failed call means, as the platform says it.
 *
 * @property message - Readable message, recorded in the journal
 * @property code - Machine-readable error code
 * @property codes - Every error code of the response, in order, when the platform lists several
 * @property requestId - Request id (the header's, or one the body carries)
 * @property retryable - Whether trying again later can succeed
 * @property invalidCredentials - Whether the access to the client's account was lost
 * @property ownCredentials - Whether **our** credentials failed
 */
export type PlatformErrorDescription = {
  message: string;
  code: string | null;
  codes?: readonly string[];
  requestId: string | null;
  retryable: boolean;
  invalidCredentials: boolean;
  ownCredentials?: boolean;
};

/**
 * Settings of a {@link PlatformHttp}.
 *
 * @property platform - The platform
 * @property baseUrl - Base URL of its API, without a trailing slash
 * @property timeoutMs - Longest wait for one response
 * @property requestIdHeader - Response header carrying the platform's request id
 * @property journal - Where every call is recorded
 * @property authorization - Value of the `Authorization` header. A failure to get it is thrown as is,
 *   without a journal line, since no call went out
 * @property describeError - The platform's reading of its own error bodies
 * @property fetchFn - What sends the request; a fake one in the tests
 */
export type PlatformHttpOptions = {
  platform: Platform;
  baseUrl: string;
  timeoutMs: number;
  requestIdHeader: string;
  journal: CallJournal;
  authorization: () => Promise<string>;
  describeError: (failure: PlatformFailure) => PlatformErrorDescription;
  fetchFn?: typeof fetch;
};

/**
 * The body of a response, parsed when it is JSON.
 *
 * @param response - The response
 * @returns The parsed body, its text when it is not JSON, `null` when empty
 */
async function bodyOf(response: Response): Promise<unknown> {
  const text: string = await response.text();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * The HTTP client of one platform.
 */
export class PlatformHttp {
  /**
   * @param options - Platform, base URL, timeout, journal, authentication and reading of errors
   */
  constructor(private readonly options: PlatformHttpOptions) {}

  /**
   * Send a request and answer its body.
   *
   * @typeParam T - Shape of the response body
   * @param adAccountId - Our account the call is for, for the journal; `null` when it is for none
   * @param request - Method, path, body, headers, cost
   * @returns The response body
   * @throws PlatformError for an error status or no response, as the platform's reading words it
   */
  public async request<T>(adAccountId: string | null, request: PlatformRequest): Promise<T> {
    const authorization: string = await this.options.authorization();
    const fetchFn: typeof fetch = this.options.fetchFn ?? fetch;
    const started: number = Date.now();
    let response: Response;
    try {
      response = await fetchFn(`${this.options.baseUrl}${request.path}`, {
        method: request.method,
        headers: {
          Authorization: authorization,
          ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...request.headers,
        },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error: unknown) {
      throw this.fail(adAccountId, request, started, { statusCode: null, data: null, requestId: null, error });
    }

    const requestId: string | null = response.headers.get(this.options.requestIdHeader);
    const data: unknown = await bodyOf(response);
    if (!response.ok) {
      throw this.fail(adAccountId, request, started, { statusCode: response.status, data, requestId, error: null });
    }
    this.record(adAccountId, request, started, response.status, requestId, null);
    return data as T;
  }

  /**
   * Record a failed call and build its error.
   *
   * @param adAccountId - Our account, for the journal
   * @param request - The request
   * @param started - When it left
   * @param failure - What came back
   * @returns The error to throw
   */
  private fail(
    adAccountId: string | null,
    request: PlatformRequest,
    started: number,
    failure: PlatformFailure
  ): PlatformError {
    const described: PlatformErrorDescription = this.options.describeError(failure);
    this.record(adAccountId, request, started, failure.statusCode, described.requestId, described.message);
    return new PlatformError(this.options.platform, described.message, {
      statusCode: failure.statusCode,
      retryable: described.retryable,
      invalidCredentials: described.invalidCredentials,
      ownCredentials: described.ownCredentials ?? false,
      requestId: described.requestId,
      code: described.code,
      codes: described.codes ?? [],
    });
  }

  /**
   * Write one line of the journal: the path, **never the payload** (`../../CADRAGE.md` § 12).
   *
   * @param adAccountId - Our account
   * @param request - The request
   * @param started - When it left
   * @param statusCode - Its status, `null` without response
   * @param requestId - The platform's id of it
   * @param error - What went wrong, `null` when nothing did
   */
  private record(
    adAccountId: string | null,
    request: PlatformRequest,
    started: number,
    statusCode: number | null,
    requestId: string | null,
    error: string | null
  ): void {
    this.options.journal.record({
      platform: this.options.platform,
      adAccountId,
      method: request.method,
      path: request.path.split('?')[0],
      statusCode,
      durationMs: Date.now() - started,
      requestId,
      error,
      operations: request.operations ?? 1,
    });
  }
}
