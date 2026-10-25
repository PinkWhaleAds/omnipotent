/**
 * @module instrumentation
 *
 * OpenTelemetry instrumentation setup for the application.
 *
 * Configures tracing and metrics collection when telemetry is enabled
 * via the `APP_TELEMETRY_ENABLED` environment variable. Exports traces
 * and metrics to an OTLP endpoint specified by `OTEL_EXPORTER_OTLP_ENDPOINT`.
 *
 * @see https://opentelemetry.io/docs/languages/js/getting-started/nodejs/
 */

// @see https://opentelemetry.io/docs/languages/js/getting-started/nodejs/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { PeriodicExportingMetricReader, MeterProvider } from '@opentelemetry/sdk-metrics';
import opentelemetry from '@opentelemetry/api';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';

import { TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-node';

/**
 * Reads the app's name and version from its package.json (relative to CWD).
 *
 * Deliberately duplicated from `@constants` instead of imported: this file is a
 * `--require` preload that must patch modules before the app pulls them in, so
 * it stays standalone and imports nothing from `src/`.
 *
 * @returns The app's name and version, or safe literals if the file is unreadable.
 */
function readAppMeta(): { name: string; version: string } {
  try {
    const pkg: Record<string, unknown> = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8')
    ) as Record<string, unknown>;
    return {
      name: typeof pkg.name === 'string' ? pkg.name : 'unknown-service',
      version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
    };
  } catch {
    return { name: 'unknown-service', version: '0.0.0' };
  }
}

const appMeta: { name: string; version: string } = readAppMeta();

/**
 * The service name reported to the OTLP backend.
 *
 * `npm_package_*` is only set when the app is started through the package
 * manager; the container runs `node` directly (so it is PID 1 and receives
 * SIGTERM), hence the package.json fallback.
 */
const APP_NAME: string = process.env.npm_package_name ?? appMeta.name;

/** The service version reported to the OTLP backend. */
const APP_VERSION: string = process.env.npm_package_version ?? appMeta.version;

/** Whether application telemetry (tracing and metrics) is enabled, controlled by the APP_TELEMETRY_ENABLED env variable */
const APP_TELEMETRY_ENABLED: boolean = process.env.APP_TELEMETRY_ENABLED === 'true';

/** The OTLP exporter endpoint URL, read from the OTEL_EXPORTER_OTLP_ENDPOINT env variable */
const OTEL_EXPORTER_OTLP_ENDPOINT: string | undefined = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

/** The trace sampling percentage (0 to 1), defaults to 0.1 (10%) if not specified via OTEL_TRACE_SAMPLER_PERCENTAGE */
const OTEL_TRACE_SAMPLER_PERCENTAGE: number = process.env.OTEL_TRACE_SAMPLER_PERCENTAGE
  ? parseFloat(process.env.OTEL_TRACE_SAMPLER_PERCENTAGE)
  : 0.1;

if (APP_TELEMETRY_ENABLED) {
  if (!OTEL_EXPORTER_OTLP_ENDPOINT)
    throw new Error(
      "OTEL_EXPORTER_OTLP_ENDPOINT env variable is not defined, can't start the app. Either disable telemetry (APP_TELEMETRY_ENABLED=false) or define endpoint."
    );

  // @see https://opentelemetry.io/docs/languages/js/instrumentation/#initializing-metrics-with-sdk-metrics
  const resource: ReturnType<typeof defaultResource> = defaultResource().merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: APP_NAME,
      [ATTR_SERVICE_VERSION]: APP_VERSION,
    })
  );

  const metricReader: PeriodicExportingMetricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/metrics`, // url is optional and can be omitted - default is http://localhost:4318/v1/metrics
      headers: {}, // an optional object containing custom headers to be sent with each request
    }),
  });
  const myServiceMeterProvider: MeterProvider = new MeterProvider({
    resource: resource,
    readers: [metricReader],
  });

  // Set this MeterProvider to be global to the app being instrumented.
  opentelemetry.metrics.setGlobalMeterProvider(myServiceMeterProvider);

  const sdk: NodeSDK = new NodeSDK({
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/metrics`, // url is optional and can be omitted - default is http://localhost:4318/v1/metrics
        headers: {}, // an optional object containing custom headers to be sent with each request
      }),
    }),
    traceExporter: new OTLPTraceExporter({
      // optional - default url is http://localhost:4318/v1/traces
      url: `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`, // url is optional and can be omitted - default is http://localhost:4318/v1/traces
      // optional - collection of custom headers to be sent with each request, empty by default
      headers: {},
    }),
    instrumentations: [getNodeAutoInstrumentations()],
    serviceName: APP_NAME,
    sampler: new TraceIdRatioBasedSampler(OTEL_TRACE_SAMPLER_PERCENTAGE),
  });

  sdk.start();
}
