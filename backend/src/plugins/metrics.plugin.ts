import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import openTelemetryApi, { Attributes, Meter, Histogram } from '@opentelemetry/api';

/**
 * Route label used when a request matched no route (404s, bad URLs).
 *
 * A constant keeps the label bounded: using the raw URL here would let any
 * caller create Prometheus series at will.
 */
const UNMATCHED_ROUTE = '__unmatched__';

/**
 * Registers request-level histogram metrics collection on the Fastify instance.
 *
 * For every completed HTTP response the plugin records a histogram data point
 * containing the request method, route, and response status code.
 *
 * @param fastify - The Fastify instance to add metrics to
 * @returns A promise that resolves once the plugin is registered
 *
 * @example
 * ```typescript
 * await fastify.register(MetricsPlugin);
 * // Every response now emits an 'events.histo' histogram record
 * ```
 */
async function MetricsPlugin(fastify: FastifyInstance): Promise<void> {
  const myMeter: Meter = openTelemetryApi.metrics.getMeter('HttpServer');
  const histo: Histogram = myMeter.createHistogram('events.histo');

  fastify.decorate('metric', metric);
  fastify.addHook('onResponse', onResponse);

  /**
   * Record a single histogram data point with the given attributes.
   *
   * @param request - The incoming Fastify request (unused but required by the decorator signature)
   * @param attributes - OpenTelemetry attributes attached to the metric
   *
   * @example
   * ```typescript
   * fastify.metric(request, { method: 'GET', route: '/status', res: 200 });
   * ```
   */
  function metric(_request: FastifyRequest, attributes: Attributes): void {
    histo.record(1, attributes);
  }

  /**
   * Fastify `onResponse` hook that records metrics for every completed request.
   *
   * @param request - The incoming Fastify request
   * @param reply - The Fastify reply that was sent
   * @param done - Callback to signal hook completion
   *
   * @example
   * ```typescript
   * // Registered automatically via fastify.addHook('onResponse', onResponse)
   * onResponse(request, reply, () => {});
   * ```
   */
  function onResponse(request: FastifyRequest, reply: FastifyReply, done: () => void): void {
    fastify.metric(request, {
      method: request.method,
      // The matched route *pattern* ('/foos/:id'), never the raw URL: path
      // params and query strings would make the label unbounded and blow up
      // the Prometheus series count.
      route: request.routeOptions.url ?? UNMATCHED_ROUTE,
      res: reply.statusCode,
    });
    done();
  }
}

/**
 * Fastify plugin wrapping {@link MetricsPlugin}.
 *
 * Exposed as the default export so it can be registered directly on a
 * Fastify instance with `fastify.register(MetricsPlugin)`.
 */
export default fastifyPlugin(MetricsPlugin, {
  name: 'MetricsPlugin',
});
