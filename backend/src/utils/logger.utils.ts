import winston from 'winston';

import { loggerConfig } from '@configs/logger.config';
import { APP_NAME, APP_VERSION, ENV, INSTANCE_ID, IS_DEV_ENV } from '@constants';
import { SafeMap } from '@src/types';
import { sanitizeLogFormat } from './log-format.utils';

/** Level of the access log lines. */
const ACCESS_LOG_LEVEL = 'info';

/**
 * Builder for creating and managing Winston logger instances.
 *
 * Provides a singleton global logger and factory methods for creating
 * child loggers scoped to specific services. The logger output format
 * varies based on the environment: simple + colorized in development,
 * JSON in production. Every entry first goes through `sanitizeLogFormat`
 * (`log-format.utils.ts`): errors are written with their message, stack and
 * cause chain, and secrets (`Authorization` headers, tokens, passwords, axios
 * request configurations) are masked at any depth.
 *
 * @example
 * ```typescript
 * import { LoggerBuilder, Logger } from '@utils/logger.utils';
 *
 * const logger: Logger = LoggerBuilder.getLogger();
 * logger.info('Application started');
 *
 * const childLogger: Logger = LoggerBuilder.getChildLogger('MyService');
 * childLogger.info('Service initialized');
 * childLogger.error('Sync failed', { code: 'SYNC::FAILED', campaignId, error });
 * ```
 */
export const LoggerBuilder = {
  gLogger: undefined as Logger | undefined,
  aLogger: undefined as winston.Logger | undefined,

  /**
   * Return a GlobalLogger shared within the whole app.
   *
   * You can call `getChild` on it to create a specific one for your service.
   *
   * @returns The singleton global Logger instance
   */
  getLogger(): Logger {
    if (!LoggerBuilder.gLogger) {
      LoggerBuilder.gLogger = winston.createLogger({
        level: loggerConfig.level,
        format: sanitizeLogFormat,
        transports: LoggerBuilder.getTransportList(),
      }) as Logger;
      LoggerBuilder.gLogger.getChild = LoggerBuilder.getChildLogger;
      LoggerBuilder.gLogger.defaultMeta = {
        service: APP_NAME,
        version: APP_VERSION,
        env: ENV,
      };
    }
    return LoggerBuilder.gLogger;
  },

  /**
   * Return the logger of the access log (`AccessLogPlugin`): one line per HTTP request at `info`, written whatever
   * `Logger.level` (production keeps `warn` for everything else), with the format and metadata of the global logger.
   *
   * @returns The singleton access Logger instance
   */
  getAccessLogger(): winston.Logger {
    if (!LoggerBuilder.aLogger) {
      LoggerBuilder.aLogger = winston.createLogger({
        level: ACCESS_LOG_LEVEL,
        format: sanitizeLogFormat,
        transports: LoggerBuilder.getTransportList(ACCESS_LOG_LEVEL),
        defaultMeta: {
          service: APP_NAME,
          version: APP_VERSION,
          env: ENV,
          class: 'AccessLog',
          instanceId: INSTANCE_ID,
        },
      });
    }
    return LoggerBuilder.aLogger;
  },

  /**
   * Returns a child logger based on the globalLogger.
   *
   * @param service - Service's name added to metadata
   * @param metadata - Map of custom metadata to add to log entries
   * @returns A new Logger scoped to the given service
   */
  getChildLogger(service: string, metadata?: SafeMap<string>): Logger {
    return LoggerBuilder.getLogger().child({ ...metadata, class: service, instanceId: INSTANCE_ID });
  },

  /**
   * Builds the list of Winston transports based on the current environment.
   *
   * In development, uses a simple + colorized format. In production, uses JSON format.
   * Both include timestamps.
   *
   * @param level - The lowest level written, `Logger.level` by default
   * @returns An array of configured Winston transport instances
   */
  getTransportList(level: string = loggerConfig.level): winston.transport[] {
    const format: winston.Logform.Format = IS_DEV_ENV
      ? winston.format.combine(winston.format.timestamp(), winston.format.simple(), winston.format.colorize())
      : winston.format.combine(winston.format.timestamp(), winston.format.json());
    const transportList: winston.transport[] = [
      new winston.transports.Console({
        format,
        level,
      }),
    ];
    return transportList;
  },
};

/**
 * Extended Winston Logger type that includes a `getChild` method
 * for creating service-scoped child loggers.
 */
export type Logger = winston.Logger & {
  getChild(service: string, metadata?: SafeMap<string>): Logger;
};
(winston.Logger.prototype as Logger).getChild = LoggerBuilder.getChildLogger;
