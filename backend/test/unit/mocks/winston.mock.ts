/**
 * Mock class representing a Winston transport instance.
 * Used to stub transport-level properties in unit tests.
 *
 * @example
 * ```typescript
 * const transport = new TransportMock();
 * ```
 */
export class TransportMock {
  /** Mock for the transport format property. */
  public format!: jest.Mock;

  /** Mock for the transport level property. */
  public level!: jest.Mock;

  /** Mock for the transport filename property. */
  public filename!: jest.Mock;

  /** Mock for the transport datePattern property. */
  public datePattern!: jest.Mock;

  /** Mock for the transport zippedArchive property. */
  public zippedArchive!: jest.Mock;
}

/**
 * A mock replacement for the `winston` module.
 * Provides stubbed implementations of format helpers, transports, and `createLogger`
 * so that unit tests can run without real logging side effects.
 *
 * @example
 * ```typescript
 * jest.mock('winston', () => WinstonMock);
 * ```
 */
export const WinstonMock = {
  ...jest.requireActual('winston'),
  format: {
    ...jest.requireActual('winston').format,
    timestamp: jest.fn().mockReturnValue({}),
    logstash: jest.fn().mockReturnValue({}),
    colorize: jest.fn().mockReturnValue({}),
    simple: jest.fn().mockReturnValue({}),
    combine: jest.fn().mockReturnValue({}),
    json: jest.fn().mockReturnValue({}),
  },
  transports: {
    Console: jest.fn().mockImplementation(() => new TransportMock()),
  },
  createLogger: jest.fn().mockReturnValue({
    debug: jest.fn(),
    transports: [],
    child: jest.fn(),
  }),
};
