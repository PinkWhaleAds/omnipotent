/**
 * A mock implementation of the application logger.
 * Every logging method is stubbed with `jest.fn()` and returns `this` for chaining,
 * allowing assertions on log calls without producing real output.
 *
 * @example
 * ```typescript
 * const logger = new LoggerMock();
 * service.setLogger(logger);
 * service.doWork();
 * expect(logger.info).toHaveBeenCalledWith('work done');
 * ```
 */
export class LoggerMock {
  /** Mock for the `debug` log level method. Returns `this` for chaining. */
  debug: jest.Mock = jest.fn().mockImplementation(() => this);

  /** Mock for the `info` log level method. Returns `this` for chaining. */
  info: jest.Mock = jest.fn().mockImplementation(() => this);

  /** Mock for the `warn` log level method. Returns `this` for chaining. */
  warn: jest.Mock = jest.fn().mockImplementation(() => this);

  /** Mock for the `error` log level method. Returns `this` for chaining. */
  error: jest.Mock = jest.fn().mockImplementation(() => this);

  /** Mock for the `getChild` method. Returns `this` as the child logger. */
  getChild: jest.Mock = jest.fn().mockImplementation(() => this);

  /** Mock for the `getChildLogger` method. Returns `this` as the child logger. */
  getChildLogger: jest.Mock = jest.fn().mockImplementation(() => this);

  /** Mock for the `getLogger` method. Returns `this` as the logger. */
  getLogger: jest.Mock = jest.fn().mockImplementation(() => this);

  /** Mock for the `end` method. Invokes the callback if provided, otherwise resolves a Promise. */
  end: jest.Mock = jest.fn().mockImplementation((cb: (() => void) | undefined) => (cb ? cb() : Promise.resolve()));

  /** Mock for the `child` method. Returns `this` as the child logger. */
  child: jest.Mock = jest.fn().mockImplementation(() => this);
}
