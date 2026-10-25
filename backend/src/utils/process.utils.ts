import { appConfig } from '@configs';
import { Callback, ErrorCode, Nullable, Opt } from '@src/types';
import { LoggerBuilder, Logger } from '@utils/logger.utils';

/**
 * Signals that ask the process to terminate.
 *
 * Kubernetes sends `SIGTERM` to the container's PID 1 when a pod is evicted,
 * scaled down or rolled out. `SIGINT` covers a local `Ctrl+C`.
 */
const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

/**
 * Anything that can be taken out of rotation and closed when the process
 * terminates.
 *
 * Declared structurally so this module stays independent from `@src/server`
 * (which itself depends on `@utils`).
 */
export type Terminable = {
  markNotReady(): void;
  stop(callback: Callback): void;
};

/**
 * Register the process-level lifecycle handlers.
 *
 * Two ways out of the process, both ending in an explicit exit code:
 *
 * - **A termination signal** (`SIGTERM` / `SIGINT`) — a planned shutdown. The
 *   target is marked not ready so `/readyz` answers 503 and the pod leaves the
 *   Service endpoints; after `appConfig.drainDelay` (time for that removal to
 *   propagate) the target is closed and the process exits `0`.
 * - **A fatal error** (`uncaughtException` / `unhandledRejection`) — the
 *   process state is no longer trustworthy, so there is no drain: it is logged,
 *   the target is closed, and the process exits `1` for the kubelet to restart.
 *
 * Whichever comes first wins; later signals and errors are ignored so a second
 * `SIGTERM` cannot interrupt a shutdown already under way.
 * `appConfig.shutdownTimeout` is the budget for the whole sequence — if it
 * elapses, the process is forcefully exited.
 *
 * @param target - The server (or any terminable resource) to drain and close before exiting
 * @returns Nothing; signal and error listeners are attached as side effects
 *
 * @example
 * ```typescript
 * import { registerLifecycleHandlers } from '@utils';
 *
 * const server: HttpServer = new HttpServer();
 * registerLifecycleHandlers(server);
 * await server.listen();
 * ```
 */
export function registerLifecycleHandlers(target: Terminable): void {
  const logger: Logger = LoggerBuilder.getChildLogger('Process');
  let isShuttingDown = false;

  /**
   * Run the shutdown sequence once.
   *
   * @param exitCode - Code to exit with: 0 for a planned shutdown, 1 for a fatal error
   * @param drain - Whether to keep serving for `appConfig.drainDelay` before closing
   */
  const shutdown: (exitCode: number, drain: boolean) => void = (exitCode: number, drain: boolean): void => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    const forceExitTimer: NodeJS.Timeout = setTimeout((): void => {
      logger.error(`Shutdown did not complete within ${appConfig.shutdownTimeout}ms, forcing exit`, {
        code: 'PROCESS::SHUTDOWN_TIMEOUT',
      });
      process.exit(1);
    }, appConfig.shutdownTimeout);

    const closeTarget: () => void = (): void => {
      target.stop((error?: Nullable<Error>): void => {
        clearTimeout(forceExitTimer);
        logger.info('Shutdown complete');
        process.exit(error ? 1 : exitCode);
      });
    };

    // Fail the readiness probe first: traffic must stop being routed here
    // before the server closes, otherwise requests already on their way in
    // get refused instead of served.
    target.markNotReady();

    if (drain && appConfig.drainDelay > 0) {
      logger.info(`Draining for ${appConfig.drainDelay}ms before closing`);
      setTimeout(closeTarget, appConfig.drainDelay);
      return;
    }

    closeTarget();
  };

  SHUTDOWN_SIGNALS.forEach((signal: NodeJS.Signals): void => {
    process.on(signal, (): void => {
      logger.info(`Received ${signal}, shutting down gracefully`);
      shutdown(0, true);
    });
  });

  process.on('uncaughtException', (error: Error): void => {
    logger.error('Uncaught exception, shutting down', { code: 'PROCESS::UNCAUGHT_EXCEPTION', error });
    shutdown(1, false);
  });

  process.on('unhandledRejection', (reason: unknown): void => {
    const error: Error = reason instanceof Error ? reason : new Error(String(reason));
    logger.error('Unhandled promise rejection, shutting down', { code: 'PROCESS::UNHANDLED_REJECTION', error });
    shutdown(1, false);
  });
}

/**
 * Emit a fatal error and exit the process.
 *
 * Logs the error with the provided error code and description, then exits with
 * code 1 once the log has flushed. Under Kubernetes the container exits
 * non-zero and the pod is restarted by the kubelet.
 *
 * `process.exitCode` is set up front so the process still fails if the logger
 * never invokes the callback and the event loop drains on its own.
 *
 * @param errorCode - A string code identifying the error category
 * @param description - An optional human-readable description of the error
 * @param error - An optional Error instance to log
 * @returns Nothing; the process is terminated
 *
 * @example
 * ```typescript
 * import { killProcess } from '@utils';
 *
 * killProcess('APP::START_FAILED', 'Failed to start server', new Error('Port in use'));
 * ```
 */
export function killProcess(errorCode: ErrorCode, description?: Opt<string>, error?: Opt<Error>): void {
  process.exitCode = 1;
  LoggerBuilder.getLogger()
    .error('Was asked to kill process', { code: errorCode, description, error })
    .end((): void => {
      process.exit(1);
    });
}
