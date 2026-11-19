import {
  ADAPTERS,
  adapterOf,
  hasAdapterFor,
  PlatformAdapter,
  PlatformError,
  registerAdapter,
} from '@src/platforms/platform-adapter';
import { Platform } from '@src/types';
import { errorCodeOf, statusCodeOf } from '@utils';

describe('Unit::Platforms::PlatformAdapter', () => {
  /** The registry, writable, so a spec declares an adapter as a platform phase would. */
  const registry: Partial<Record<Platform, PlatformAdapter>> = ADAPTERS as Partial<Record<Platform, PlatformAdapter>>;

  afterEach((): void => {
    for (const platform of Object.keys(registry)) Reflect.deleteProperty(registry, platform);
  });

  it('should hold no adapter yet: each one arrives with its phase', (): void => {
    expect(ADAPTERS).toEqual({});
    expect(hasAdapterFor('google_ads')).toBe(false);
  });

  describe('adapterOf', () => {
    it('should refuse a platform no phase has written, with a stable code', (): void => {
      let error: unknown;
      try {
        adapterOf('google_ads');
      } catch (thrown: unknown) {
        error = thrown;
      }

      // 500 and not 400: being asked for an adapter that does not exist is our own gap, never the
      // caller's mistake — the preview refuses the launch long before this.
      expect(statusCodeOf(error)).toBe(500);
      expect(errorCodeOf(error)).toEqual({ code: 'sync_adapter_missing', params: { platform: 'google_ads' } });
    });

    it('should answer the adapter a phase declared', (): void => {
      const adapter: PlatformAdapter = { platform: 'hawk', connection: 'account_secret', apply: jest.fn() };
      registry.hawk = adapter;

      expect(adapterOf('hawk')).toBe(adapter);
      expect(hasAdapterFor('hawk')).toBe(true);
    });
  });

  describe('registerAdapter', () => {
    it('should make an adapter the one of its platform, replacing any before it', (): void => {
      const first: PlatformAdapter = { platform: 'hawk', connection: 'account_secret', apply: jest.fn() };
      const second: PlatformAdapter = { platform: 'hawk', connection: 'manager_link', apply: jest.fn() };

      registerAdapter(first);
      registerAdapter(second);

      expect(adapterOf('hawk')).toBe(second);
    });
  });

  describe('PlatformError', () => {
    it('should carry what the engine reacts to', (): void => {
      const error = new PlatformError('hawk', 'Too many requests', {
        statusCode: 429,
        retryable: true,
        invalidCredentials: false,
        requestId: 'r-1',
        code: 'RATE_LIMIT',
      });

      expect(error.name).toBe('PlatformError');
      expect(error.message).toBe('Too many requests');
      expect(error.platform).toBe('hawk');
      expect(error.options).toMatchObject({ retryable: true, invalidCredentials: false, requestId: 'r-1' });
      // Not ours unless said: a failure blames the account by default.
      expect(error.options.ownCredentials).toBeUndefined();
    });
  });
});
