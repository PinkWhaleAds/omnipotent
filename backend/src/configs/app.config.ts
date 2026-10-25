import config from 'config';

/**
 * Default grace period, in milliseconds, given to the app to finish in-flight
 * work when a termination signal is received.
 *
 * Keep it lower than the Kubernetes `terminationGracePeriodSeconds` of the pod
 * (30s by default) so the process exits on its own before being SIGKILLed.
 */
const DEFAULT_SHUTDOWN_TIMEOUT_IN_MS = 10000;

/**
 * Default delay, in milliseconds, between the readiness probe starting to fail
 * and the server actually closing.
 *
 * Zero by default so local runs stop instantly; `config/prod.json` raises it,
 * because in a cluster the endpoint removal that follows a failing `/readyz`
 * takes a moment to propagate to every kube-proxy / ingress, and requests
 * routed in the meantime would be refused by a closed server.
 */
const DEFAULT_DRAIN_DELAY_IN_MS = 0;

/**
 * What a process of this image runs.
 *
 * - `api` — the HTTP API and the MCP endpoint. It can enqueue jobs but never works them.
 * - `worker` — the job workers, plus the probe and status routes so the orchestrator can
 *   health-check it. It serves no API route.
 *
 * Both modes ship in the same image; the deployment picks one per process.
 */
export type AppMode = 'api' | 'worker';

/** Every accepted {@link AppMode}, used to validate the configured value. */
const APP_MODES: readonly AppMode[] = ['api', 'worker'];

/** Mode used when none is configured. */
const DEFAULT_APP_MODE: AppMode = 'api';

/**
 * Configuration interface for the application process settings.
 *
 * @property shutdownTimeout - Milliseconds to wait for a graceful shutdown before forcing the process to exit
 * @property drainDelay - Milliseconds to keep serving after the readiness probe starts failing
 * @property mode - What this process runs, see {@link AppMode}
 */
export type AppConfig = {
  shutdownTimeout: number;
  drainDelay: number;
  mode: AppMode;
};

/**
 * The configuration key used to look up application settings in the config store.
 */
const CONFIG_KEY = 'App';

/**
 * Read and validate the configured process mode.
 *
 * An unknown value is a deployment mistake that would silently start the wrong
 * process, so it fails loudly instead of falling back.
 *
 * @returns The configured mode, or {@link DEFAULT_APP_MODE} when none is set
 * @throws Error when the configured value is not a known mode
 *
 * @example
 * ```typescript
 * // APP_MODE=worker
 * readMode(); // 'worker'
 * ```
 */
function readMode(): AppMode {
  if (!config.has(`${CONFIG_KEY}.mode`)) return DEFAULT_APP_MODE;

  const mode: string = config.get(`${CONFIG_KEY}.mode`);
  if (!APP_MODES.includes(mode as AppMode)) {
    throw new Error(`Unknown App.mode '${mode}': expected one of ${APP_MODES.join(', ')}`);
  }
  return mode as AppMode;
}

/**
 * Resolved application configuration loaded from the application config store.
 * Falls back to default values if no application configuration is provided.
 *
 * @example
 * ```typescript
 * import { appConfig } from './configs';
 *
 * setTimeout(forceExit, appConfig.shutdownTimeout);
 * ```
 */
export const appConfig: AppConfig = {
  shutdownTimeout: config.has(`${CONFIG_KEY}.shutdownTimeout`)
    ? config.get(`${CONFIG_KEY}.shutdownTimeout`)
    : DEFAULT_SHUTDOWN_TIMEOUT_IN_MS,
  drainDelay: config.has(`${CONFIG_KEY}.drainDelay`)
    ? config.get(`${CONFIG_KEY}.drainDelay`)
    : DEFAULT_DRAIN_DELAY_IN_MS,
  mode: readMode(),
};
