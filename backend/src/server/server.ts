import { Opt, Callback, Nullable } from '@src/types';
import { callCallback, LoggerBuilder } from '@utils';

/**
 * Abstract base class for server implementations.
 *
 * Provides a lifecycle interface (listen / stop) that concrete server
 * implementations must fulfil by overriding {@link listenApp} and
 * {@link closeApp}.
 *
 * @example
 * ```typescript
 * class MyServer extends Server {
 *   protected async listenApp(callback?: Opt<Callback>): Promise<void> { /* ... *\/ }
 *   protected closeApp(callback: Callback): void { /* ... *\/ }
 * }
 * const server: MyServer = new MyServer();
 * await server.listen();
 * ```
 */
export abstract class Server {
  /**
   * Listen on the underlying transport.
   *
   * @param callback - Optional callback invoked once the server is listening
   * @returns A promise that resolves when listening has started
   *
   * @example
   * ```typescript
   * await server['listenApp'](() => console.log('ready'));
   * ```
   */
  protected abstract listenApp(callback?: Opt<Callback>): Promise<void>;

  /**
   * Close the underlying transport.
   *
   * @param callback - Callback invoked once the transport is closed
   *
   * @example
   * ```typescript
   * server['closeApp']((err) => { if (err) console.error(err); });
   * ```
   */
  protected abstract closeApp(callback: Callback): void;

  /**
   * Initialize server configuration then start listening.
   *
   * @param callback - Optional callback invoked after the server starts
   * @returns A promise that resolves once the server is listening
   *
   * @example
   * ```typescript
   * const server: HttpServer = new HttpServer();
   * await server.listen(() => console.log('Server is up'));
   * ```
   */
  public async listen(callback?: Opt<Callback>): Promise<void> {
    this.initConfigs();
    await this.listenApp(callback);
  }

  /**
   * Initialize the server's configs.
   *
   * Override in a subclass to provide custom configuration initialization
   * that runs before {@link listenApp}.
   *
   * @example
   * ```typescript
   * class MyServer extends Server {
   *   public initConfigs(): void {
   *     // custom setup
   *   }
   * }
   * ```
   */
  public initConfigs(): void {
    // Can be overridden by child classes to provide custom configuration initialization
  }

  /**
   * Declare the server ready to accept traffic (readiness probe answers 200).
   *
   * Override in a subclass that exposes a readiness state; the base
   * implementation does nothing.
   *
   * @example
   * ```typescript
   * const server: HttpServer = new HttpServer();
   * await server.listen();
   * server.markReady();
   * ```
   */
  public markReady(): void {
    // Overridden by child classes that own a readiness state
  }

  /**
   * Declare the server unable to accept traffic (readiness probe answers 503).
   *
   * Called at the start of a graceful shutdown, before the transports close,
   * so load balancers deregister the instance while it can still serve
   * in-flight requests.
   *
   * @example
   * ```typescript
   * server.markNotReady();
   * server.stop(() => process.exit(0));
   * ```
   */
  public markNotReady(): void {
    // Overridden by child classes that own a readiness state
  }

  /**
   * Gracefully stop the server by closing all underlying transports.
   *
   * @param callback - Callback invoked after the server has stopped
   *
   * @example
   * ```typescript
   * server.stop((error) => {
   *   if (error) console.error('Shutdown error', error);
   *   else console.log('Server stopped');
   * });
   * ```
   */
  public stop(callback: Callback): void {
    this.closeApp((error?: Nullable<Error>): void => {
      if (error) LoggerBuilder.getLogger().error('SERVER::STOP', 'An error occurred while stopping.', error);
      callCallback(callback, error);
    });
  }
}
