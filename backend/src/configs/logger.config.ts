import config from 'config';

/**
 * Configuration interface for the application logger.
 *
 * @property level - The minimum log level to output (e.g. 'debug', 'info', 'warn', 'error')
 * @property accessLog - Whether one line per HTTP request is written (`AccessLogPlugin`), whatever `level`; on by
 *   default
 */
export type LoggerConfig = {
  level: string;
  accessLog: boolean;
};

/**
 * The configuration key used to look up logger settings in the config store.
 */
const CONFIG_KEY = 'Logger';

/**
 * Resolved logger configuration loaded from the application config store.
 * Falls back to 'warn' level if no logger level is configured, and writes the access log unless told not to.
 *
 * @example
 * ```typescript
 * import { loggerConfig } from './configs';
 *
 * const logger = createLogger({ level: loggerConfig.level });
 * ```
 */
export const loggerConfig: LoggerConfig = {
  level: config.has(`${CONFIG_KEY}.level`) ? config.get(`${CONFIG_KEY}.level`) : 'warn',
  accessLog: config.has(`${CONFIG_KEY}.accessLog`) ? config.get(`${CONFIG_KEY}.accessLog`) !== false : true,
};
