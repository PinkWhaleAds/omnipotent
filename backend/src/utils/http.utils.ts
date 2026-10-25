import { isIP } from 'node:net';

import type { FastifyRequest } from 'fastify';

import { httpServerConfig } from '@configs/http-server.config';
import { ORGANIZATION_HEADER } from '@src/types/api.types';
import type { AuthContext } from '@src/types/auth.types';
import type { MessageParams } from '@src/types/error.types';

/**
 * What an {@link httpError} carries besides its status and English message.
 *
 * @property code - Stable code of the failure, which a client translates (`campaign_not_draft`); by default
 *   the code of the status (`not_found`, `conflict`…), see {@link DEFAULT_ERROR_CODES}
 * @property params - The values of the message (a name, a platform, a count), for its translation
 * @property cause - The underlying error, kept for the logs
 */
export type HttpErrorDetails = {
  code?: string;
  params?: MessageParams;
  cause?: unknown;
  /** Never set: keeps an `Error` from passing for details (give it as `cause`). */
  message?: never;
};

/** An error built by {@link httpError}. */
type CodedHttpError = Error & { statusCode: number; errorCode: string; errorParams: MessageParams };

/** Code of a failure that names none, by HTTP status. */
export const DEFAULT_ERROR_CODES: Readonly<Record<number, string>> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'unprocessable',
  429: 'too_many_requests',
  500: 'internal_error',
  502: 'bad_gateway',
  503: 'unavailable',
};

/**
 * Build an `Error` carrying an HTTP status code, a stable code and the values of its message.
 *
 * Handlers throw these instead of replying by hand, so every failure goes
 * through the application error handler
 * (`src/plugins/error-handler.plugin.ts`) and comes back in the single shape
 * described by `errorResponseSchema`.
 *
 * @param statusCode - The HTTP status to answer with
 * @param message - The message exposed to the caller (4xx) or logged (5xx), in English
 * @param details - Its code, the values of its message and its cause, see {@link HttpErrorDetails}
 * @returns An error the error handler turns into an `ErrorResponse`
 *
 * @example
 * ```typescript
 * import { httpError } from '@utils';
 *
 * if (campaign.status !== 'draft') {
 *   throw httpError(409, 'Only a draft can be launched', { code: 'campaign_not_draft', params: { status: campaign.status } });
 * }
 * ```
 */
export function httpError(statusCode: number, message: string, details: HttpErrorDetails = {}): Error {
  const error: CodedHttpError = new Error(
    message,
    details.cause === undefined || details.cause === null ? undefined : { cause: details.cause }
  ) as CodedHttpError;
  error.statusCode = statusCode;
  error.errorCode = details.code ?? defaultErrorCode(statusCode);
  error.errorParams = details.params ?? {};
  return error;
}

/**
 * Code of a failure that names none.
 *
 * @param statusCode - Its HTTP status
 * @returns The code of the status, or `error` for one without a code
 *
 * @example
 * ```typescript
 * defaultErrorCode(404); // 'not_found'
 * ```
 */
export function defaultErrorCode(statusCode: number): string {
  return DEFAULT_ERROR_CODES[statusCode] ?? 'error';
}

/**
 * Code and values carried by an error, if it came from {@link httpError}.
 *
 * @param error - Anything thrown
 * @returns Its code and values, or `undefined` for another error
 *
 * @example
 * ```typescript
 * errorCodeOf(httpError(409, 'Taken', { code: 'name_taken' })); // { code: 'name_taken', params: {} }
 * ```
 */
export function errorCodeOf(error: unknown): { code: string; params: MessageParams } | undefined {
  const coded = error as Partial<CodedHttpError> | null;
  return typeof coded?.errorCode === 'string' ? { code: coded.errorCode, params: coded.errorParams ?? {} } : undefined;
}

/**
 * HTTP status carried by an error, if any.
 *
 * @param error - Anything thrown
 * @returns The `statusCode` of an {@link httpError} (or a Fastify error), otherwise `undefined`
 *
 * @example
 * ```typescript
 * statusCodeOf(httpError(404, 'Campaign not found', { code: 'campaign_not_found' })); // 404
 * statusCodeOf(new Error('boom')); // undefined
 * ```
 */
export function statusCodeOf(error: unknown): number | undefined {
  const statusCode: unknown = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
}

/**
 * The authenticated caller of a request.
 *
 * @param request - A request of a route authenticated by the auth plugin
 * @returns The caller
 * @throws Error with status 401 when the route was not authenticated (a wiring mistake)
 *
 * @example
 * ```typescript
 * const page: Paginated<Seat> = await this.seatService.list(actorOf(request), request.query);
 * ```
 */
export function actorOf(request: FastifyRequest): AuthContext {
  if (!request.auth) throw httpError(401, 'Authentication required', { code: 'not_authenticated' });
  return request.auth;
}

/**
 * The Organization an org-scoped request acts on.
 *
 * The header is validated by the route schema (`organizationHeadersSchema`), so
 * it is a well-formed id here; whether the caller may use it is checked by the service.
 *
 * @param request - A request of an org-scoped route
 * @returns The value of the `X-Organization-Id` header
 * @throws Error with status 400 when the header is absent (a route that does not declare it: a wiring mistake)
 *
 * @example
 * ```typescript
 * await this.advertiserService.list(actorOf(request), organizationIdOf(request), request.query);
 * ```
 */
export function organizationIdOf(request: FastifyRequest): string {
  const organizationId: unknown = request.headers[ORGANIZATION_HEADER];
  if (typeof organizationId !== 'string' || organizationId.length === 0) {
    throw httpError(400, `The ${ORGANIZATION_HEADER} header is required`, {
      code: 'organization_header_missing',
      params: { header: ORGANIZATION_HEADER },
    });
  }
  return organizationId;
}

/**
 * Fastify's `trustProxy`: trust the `hops` proxies nearest to the server, so that `request.ip` is the address the
 * farthest of them saw, the `X-Forwarded-For` entries before it being the client's own claims. Behind CloudFront
 * then the load balancer, 2.
 *
 * @param hops - Proxies trusted (`HttpServer.trustProxyHops`); 0 trusts none, `request.ip` being the socket's address
 * @returns Whether the proxy at a hop (0 for the socket's peer) is trusted
 *
 * @example
 * ```typescript
 * Fastify({ trustProxy: trustNearestProxies(2) });
 * ```
 */
export function trustNearestProxies(hops: number): (address: string, hop: number) => boolean {
  return (_address: string, hop: number): boolean => hop < hops;
}

/** Header in which CloudFront gives the viewer's address and port (`198.51.100.7:46532`, `2001:db8::1:46532`). */
export const VIEWER_ADDRESS_HEADER = 'cloudfront-viewer-address';

/**
 * The path of a request URL, without its query string, which may carry a token (`/email/unsubscribe?token=…`):
 * what the logs may show of a URL.
 *
 * @param url - The URL of the request (`request.url`)
 * @returns Its path
 *
 * @example
 * ```typescript
 * pathOf('/email/unsubscribe?token=abc'); // '/email/unsubscribe'
 * ```
 */
export function pathOf(url: string): string {
  const index: number = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}

/**
 * The address of the client of a request. Behind CloudFront then the internal load balancer, the viewer's own
 * `X-Forwarded-For` is forwarded and prepended to, so it cannot be read as is:
 *
 * - when `HttpServer.trustCloudFrontViewerAddress` is on (production behind CloudFront only), the address of the
 *   `CloudFront-Viewer-Address` header, which CloudFront sets itself (`<ip>:<port>`, an IPv6 address without
 *   brackets: split at the last colon);
 * - otherwise, or when that header is absent or unreadable, Fastify's `request.ip`, which honours
 *   `HttpServer.trustProxyHops` (the socket's address when no proxy is trusted).
 *
 * @param request - The request
 * @param trustViewerAddress - Whether the CloudFront header is read (the configuration by default)
 * @returns The client address
 *
 * @example
 * ```typescript
 * clientIpOf(request); // '198.51.100.7'
 * ```
 */
export function clientIpOf(
  request: FastifyRequest,
  trustViewerAddress: boolean = httpServerConfig.trustCloudFrontViewerAddress
): string {
  const header: unknown = request.headers[VIEWER_ADDRESS_HEADER];
  if (trustViewerAddress && typeof header === 'string') {
    const address: string = header.slice(0, Math.max(header.lastIndexOf(':'), 0)).trim();
    if (isIP(address)) return address;
  }
  return request.ip;
}
