import config from 'config';
import { hostname } from 'node:os';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The test environment identifier.
 *
 * @example
 * ```typescript
 * if (ENV === TEST) {
 *   enableMocks();
 * }
 * ```
 */
export const TEST: Environment = 'test';

/**
 * The development environment identifier.
 *
 * @example
 * ```typescript
 * if (ENV === DEV) {
 *   enableDevTools();
 * }
 * ```
 */
export const DEV: Environment = 'dev';

/**
 * The production environment identifier.
 *
 * @example
 * ```typescript
 * if (ENV === PROD) {
 *   enableStrictSecurity();
 * }
 * ```
 */
export const PROD: Environment = 'prod';

/**
 * Union type representing valid application environment names.
 */
type Environment = 'dev' | 'prod' | 'test';

/**
 * A mapping from environment name strings to their normalized Environment values.
 */
type EnvironmentMap = Record<string, Environment>;

/**
 * Lookup table that maps various environment name aliases to their canonical Environment values.
 */
const ENVIRONMENTS: EnvironmentMap = {
  dev: DEV,
  development: DEV,
  prod: PROD,
  production: PROD,
  test: TEST,
} as const;

/**
 * Resolves the current application environment from the NODE_ENV variable.
 * Normalizes the value to lowercase and maps it through the known environments.
 * Fails closed: an unrecognized (or empty) environment is treated as PROD — opaque 5xx messages, JSON logs —
 * never as DEV, which shows the real message of every server error. An unset NODE_ENV is `development` for
 * node-config, hence DEV for a local run.
 *
 * @returns The resolved environment identifier
 *
 * @example
 * ```typescript
 * // Internally called to set the ENV constant
 * const currentEnv: Environment = getEnv();
 * ```
 */
function getEnv(): Environment {
  let unsafeEnv: string = config.util.getEnv('NODE_ENV');
  if (unsafeEnv) unsafeEnv = unsafeEnv.toLowerCase();

  const env: Environment | undefined = ENVIRONMENTS[unsafeEnv];
  if (!env) {
    // Plain console.warn on purpose: the logger reads ENV, so it cannot be used before ENV is resolved
    console.warn('[WARN] Unknown environment, treated as PROD');
    return PROD;
  }
  return env;
}

/**
 * The current resolved application environment.
 *
 * @example
 * ```typescript
 * import { ENV } from './constants';
 *
 * console.log(`Running in ${ENV} mode`);
 * ```
 */
export const ENV: Environment = getEnv();

/**
 * Whether the application is running in the development environment.
 *
 * @example
 * ```typescript
 * import { IS_DEV_ENV } from './constants';
 *
 * if (IS_DEV_ENV) {
 *   enableVerboseLogging();
 * }
 * ```
 */
export const IS_DEV_ENV: boolean = ENV === DEV;

/**
 * Reads the consuming app's package.json (relative to CWD).
 * Used as a fallback when `npm_package_*` env vars aren't set
 * (e.g. when the app is started via `node` directly instead of `pnpm run`).
 *
 * @returns The app's name and version, or safe literals if the file is unreadable.
 */
function readAppMeta(): { name: string; version: string } {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    const pkg: Record<string, unknown> = raw as Record<string, unknown>;
    const name: string = typeof pkg.name === 'string' ? pkg.name : 'omnipotent';
    const version: string = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
    return { name, version };
  } catch {
    return { name: 'omnipotent', version: '0.0.0' };
  }
}

const appMeta: { name: string; version: string } = readAppMeta();

/**
 * The application name, read from package.json via npm environment variables.
 *
 * @example
 * ```typescript
 * import { APP_NAME } from './constants';
 *
 * logger.info(`Starting ${APP_NAME}`);
 * ```
 */
export const APP_NAME: string = process.env.npm_package_name ?? appMeta.name;

/**
 * The application version, read from `npm_package_version` or the app's package.json,
 * suffixed with the short commit SHA (`COMMIT_SHA` env var) when available — set by
 * the docker build via `--build-arg COMMIT_SHA=$CI_COMMIT_SHORT_SHA`.
 *
 * @example
 * ```typescript
 * import { APP_VERSION } from './constants';
 *
 * logger.info(`Version: ${APP_VERSION}`); // e.g. "0.0.0-295a1e1f"
 * ```
 */
const APP_VERSION_BASE: string = process.env.npm_package_version ?? appMeta.version;
export const APP_VERSION: string = process.env.COMMIT_SHA
  ? `${APP_VERSION_BASE}-${process.env.COMMIT_SHA}`
  : APP_VERSION_BASE;

/**
 * Identifier of the running instance.
 *
 * Under Kubernetes the container's `HOSTNAME` is the pod name, which is the
 * natural way to tell replicas apart in the logs. Falls back to the machine
 * hostname when the variable is not set (local runs).
 *
 * @example
 * ```typescript
 * import { INSTANCE_ID } from './constants';
 *
 * console.log(`Instance: ${INSTANCE_ID}`); // e.g. "my-api-7d9c8b6f4-x2klm"
 * ```
 */
export const INSTANCE_ID: string = process.env.HOSTNAME ?? hostname();
