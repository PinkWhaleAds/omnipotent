/**
 * Interface representing the shape of the mocked Fastify instance.
 */
interface FastifyInstanceMock {
  /** Mock for the `register` method that resolves immediately. */
  register: jest.Mock;
  /** Mock for the `listen` method that resolves with an empty string. */
  listen: jest.Mock;
  /** Mock for the `close` method. */
  close: jest.Mock;
  /** Mock for the `hasDecorator` method. */
  hasDecorator: jest.Mock;
  /** Stub of the decorated health service. */
  healthService: { setReady: jest.Mock };
}

/**
 * A mocked Fastify instance object providing stubbed `register`, `listen`, and `close` methods.
 * Used as the singleton instance returned by {@link FastifyMock}.
 *
 * @example
 * ```typescript
 * expect(FASTIFY_INSTANCE_MOCK.register).toHaveBeenCalled();
 * ```
 */
export const FASTIFY_INSTANCE_MOCK: FastifyInstanceMock = {
  register: jest.fn(() => Promise.resolve()),
  listen: jest.fn(() => Promise.resolve('')),
  close: jest.fn(),
  hasDecorator: jest.fn(() => true),
  healthService: { setReady: jest.fn() },
};

/**
 * A factory function that mimics the `Fastify()` constructor by returning
 * the shared {@link FASTIFY_INSTANCE_MOCK} singleton.
 *
 * @returns The mocked Fastify instance.
 *
 * @example
 * ```typescript
 * jest.mock('fastify', () => ({ default: FastifyMock }));
 * ```
 */
export const FastifyMock: () => FastifyInstanceMock = () => FASTIFY_INSTANCE_MOCK;
