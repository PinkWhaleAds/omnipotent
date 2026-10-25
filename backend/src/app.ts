import { Server, HttpServer } from '@src/server';
import { killProcess, registerLifecycleHandlers } from '@utils';

/**
 * Main application class responsible for server initialization and process lifecycle.
 *
 * The app runs as a **single process**: horizontal scaling is delegated to the
 * orchestrator (Kubernetes replicas), not to `node:cluster`. Scale by adding
 * pods — one CPU-bound event loop per container — so that the container's CPU
 * requests/limits stay meaningful.
 *
 * @example
 * ```typescript
 * import { App } from './app';
 *
 * const app: App = new App();
 * await app.start();
 * ```
 */
export class App {
  /** The HTTP server owned by this process */
  private readonly server: Server;

  /**
   * Initializes the application and its HTTP server.
   *
   * @example
   * ```typescript
   * import { App } from './app';
   *
   * const app: App = new App();
   * ```
   */
  constructor() {
    this.server = new HttpServer();
  }

  /**
   * Application entry point: registers the lifecycle handlers, starts the HTTP
   * server, then declares it ready.
   *
   * Lifecycle handlers are registered *before* listening so a `SIGTERM` or a
   * fatal error during startup is still handled. Readiness is flipped *after* listening, so
   * `/readyz` answers 503 for the whole startup window and Kubernetes routes no
   * traffic here until the server can actually serve it. Anything else that must
   * be warm before traffic arrives belongs between `listen` and `markReady` —
   * or, if it can fail at runtime, in a readiness check on `healthService`.
   *
   * @returns A promise that resolves once the server is listening and ready
   *
   * @example
   * ```typescript
   * import { App } from './app';
   *
   * const app: App = new App();
   * await app.start();
   * ```
   */
  public async start(): Promise<void> {
    registerLifecycleHandlers(this.server);
    await this.startServer();
    this.server.markReady();
  }

  /**
   * Initializes and starts the HTTP server.
   *
   * @returns A promise that resolves once the server is listening
   * @throws Error if the server fails to start
   *
   * @example
   * ```typescript
   * // Called internally by start():
   * // await this.startServer();
   * ```
   */
  private async startServer(): Promise<void> {
    await this.server.listen().catch((error: Error): void => {
      killProcess('APP::START_FAILED', 'Failed to start server', error);
    });
  }
}
