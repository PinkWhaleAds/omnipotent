import { STATUS_CODES } from 'node:http';
import { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { IS_DEV_ENV } from '@constants';
import { ErrorResponse, MessageParams } from '@src/types';
import { defaultErrorCode, errorCodeOf, LoggerBuilder, Logger, pathOf } from '@utils';

/** Status used when an error carries none — an unexpected failure. */
const INTERNAL_SERVER_ERROR = 500;

/** Lowest status code considered a server-side failure. */
const SERVER_ERROR_THRESHOLD = 500;

/**
 * Body returned for a 5xx outside development.
 *
 * Error messages routinely carry connection strings, file paths or SQL; they
 * belong in the logs (correlated by `requestId`), never in the response.
 */
const OPAQUE_SERVER_ERROR_MESSAGE = 'Internal Server Error';

/**
 * Registers the application-wide error and not-found handlers.
 *
 * Gives every failure the single shape described by `errorResponseSchema`
 * (`statusCode` / `error` / `code` / `params` / `message` / `requestId`) instead of Fastify's
 * default, and makes the log/response split explicit: 5xx details are logged
 * with the stack and reduced to an opaque message in the response, 4xx are
 * returned as-is because the caller can act on them.
 *
 * Registered with `fastify-plugin`, so the handlers apply to the root instance
 * and therefore to every route.
 *
 * @param fastify - The Fastify instance to attach the handlers to
 * @returns A promise that resolves once the handlers are registered
 *
 * @example
 * ```typescript
 * await fastify.register(ErrorHandlerPlugin);
 * // GET /nope -> 404 { statusCode, error: 'Not Found', message, requestId }
 * ```
 */
async function ErrorHandlerPlugin(fastify: FastifyInstance): Promise<void> {
  const logger: Logger = LoggerBuilder.getChildLogger('ErrorHandler');

  fastify.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply): void => {
    const statusCode: number = error.statusCode ?? INTERNAL_SERVER_ERROR;
    const isServerError: boolean = statusCode >= SERVER_ERROR_THRESHOLD;

    // The path without its query string, which may carry a token (`/email/unsubscribe?token=…`).
    const path: string = pathOf(request.url);
    if (isServerError) {
      logger.error(`${request.method} ${path} failed with ${statusCode}`, {
        code: 'REQUEST::FAILED',
        requestId: request.id,
        error,
      });
    } else {
      logger.warn(`${request.method} ${path} rejected with ${statusCode}: ${error.message}`, {
        requestId: request.id,
      });
    }

    // Only 5xx messages are hidden: a 4xx message tells the caller what to fix.
    const message: string =
      isServerError && !IS_DEV_ENV ? OPAQUE_SERVER_ERROR_MESSAGE : error.message || OPAQUE_SERVER_ERROR_MESSAGE;

    reply.code(statusCode).send(buildErrorResponse(statusCode, message, request.id, codeOf(error, statusCode)));
  });

  fastify.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply): void => {
    const statusCode = 404;
    logger.warn(`${request.method} ${pathOf(request.url)} did not match any route`, { requestId: request.id });

    reply.code(statusCode).send(
      buildErrorResponse(statusCode, `Route ${request.method} ${request.url} not found`, request.id, {
        code: 'route_not_found',
        params: { method: request.method, url: request.url },
      })
    );
  });
}

/** Code and values of a failure, as the response carries them. */
type ErrorCode = { code: string; params: MessageParams };

/**
 * Code and values of a failure: those of an `httpError`, `validation_failed` with the field and the
 * rule for a request refused by its schema, otherwise the code of the status.
 *
 * @param error - The failure
 * @param statusCode - The status answered
 * @returns Its code and values
 *
 * @example
 * ```typescript
 * codeOf(httpError(409, 'Taken', { code: 'name_taken' }), 409); // { code: 'name_taken', params: {} }
 * ```
 */
function codeOf(error: FastifyError, statusCode: number): ErrorCode {
  const coded: ErrorCode | undefined = errorCodeOf(error);
  if (coded) return coded;
  const failed = error.validation?.[0];
  if (failed) {
    const path: string[] = String(failed.instancePath ?? '')
      .split('/')
      .filter((part: string): boolean => part.length > 0);
    // AJV names the field at fault in `params`: the one that is missing, or the one that is not allowed.
    const named = failed.params as { missingProperty?: unknown; additionalProperty?: unknown } | undefined;
    const field: unknown = named?.missingProperty ?? named?.additionalProperty;
    if (typeof field === 'string') path.push(field);
    return {
      code: 'validation_failed',
      params: {
        field: path.join('.') || null,
        rule: failed.keyword ?? null,
        location: error.validationContext ?? null,
      },
    };
  }
  return { code: defaultErrorCode(statusCode), params: {} };
}

/**
 * Build the payload described by `errorResponseSchema`.
 *
 * @param statusCode - The HTTP status code being returned
 * @param message - The human-readable description to expose to the caller
 * @param requestId - The Fastify request id, so logs and response can be correlated
 * @param coded - The code and values of the failure
 * @returns The error body to send
 *
 * @example
 * ```typescript
 * buildErrorResponse(404, 'Foo not found', request.id, { code: 'not_found', params: {} });
 * // { statusCode: 404, error: 'Not Found', code: 'not_found', params: {}, message: 'Foo not found', requestId: 'req-1' }
 * ```
 */
function buildErrorResponse(statusCode: number, message: string, requestId: string, coded: ErrorCode): ErrorResponse {
  return {
    statusCode,
    error: STATUS_CODES[statusCode] ?? 'Error',
    code: coded.code,
    params: coded.params,
    message,
    requestId,
  };
}

export default fastifyPlugin(ErrorHandlerPlugin, {
  name: 'ErrorHandlerPlugin',
});
