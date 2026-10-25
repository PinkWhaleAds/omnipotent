import { TtlCache } from '@utils';

describe('Unit::Utils::TtlCache', () => {
  const TTL_IN_MS = 1000;
  let now: number;
  const clock: () => number = (): number => now;

  beforeEach((): void => {
    jest.clearAllMocks();
    now = 10000;
  });

  describe('get / set', () => {
    it('should answer undefined for an unknown key', (): void => {
      const cache: TtlCache<string> = new TtlCache<string>(TTL_IN_MS, 10, clock);

      expect(cache.get('nope')).toBeUndefined();
    });

    it('should return a value until it expires', (): void => {
      const cache: TtlCache<string> = new TtlCache<string>(TTL_IN_MS, 10, clock);
      cache.set('user-1', 'admin');

      now += TTL_IN_MS - 1;
      expect(cache.get('user-1')).toBe('admin');
    });

    it('should drop a value once its time to live is over', (): void => {
      const cache: TtlCache<string> = new TtlCache<string>(TTL_IN_MS, 1, clock);
      cache.set('user-1', 'admin');

      now += TTL_IN_MS;
      expect(cache.get('user-1')).toBeUndefined();

      // The expired entry was removed, so it no longer takes the only slot.
      cache.set('user-2', 'viewer');
      now += TTL_IN_MS + 1;
      cache.set('user-3', 'manager');
      expect(cache.get('user-3')).toBe('manager');
    });

    it('should replace the value of a key and restart its time to live', (): void => {
      const cache: TtlCache<string> = new TtlCache<string>(TTL_IN_MS, 10, clock);
      cache.set('user-1', 'viewer');

      now += TTL_IN_MS - 1;
      cache.set('user-1', 'admin');
      now += TTL_IN_MS - 1;

      expect(cache.get('user-1')).toBe('admin');
    });

    it('should cache falsy values', (): void => {
      const cache: TtlCache<number | null> = new TtlCache<number | null>(TTL_IN_MS, 10, clock);
      cache.set('zero', 0);
      cache.set('null', null);

      expect(cache.get('zero')).toBe(0);
      expect(cache.get('null')).toBeNull();
    });
  });

  describe('capacity', () => {
    it('should drop the oldest inserted entry when full', (): void => {
      const cache: TtlCache<number> = new TtlCache<number>(TTL_IN_MS, 2, clock);
      cache.set('a', 1);
      cache.set('b', 2);

      cache.set('c', 3);

      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
    });

    it('should not evict anything when replacing a key of a full cache', (): void => {
      const cache: TtlCache<number> = new TtlCache<number>(TTL_IN_MS, 2, clock);
      cache.set('a', 1);
      cache.set('b', 2);

      cache.set('a', 10);

      expect(cache.get('a')).toBe(10);
      expect(cache.get('b')).toBe(2);
    });

    it('should treat a replaced key as the newest entry', (): void => {
      const cache: TtlCache<number> = new TtlCache<number>(TTL_IN_MS, 2, clock);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('a', 10);

      cache.set('c', 3);

      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('a')).toBe(10);
      expect(cache.get('c')).toBe(3);
    });
  });

  describe('deleteByPrefix', () => {
    it('should forget every key starting with the prefix', (): void => {
      const cache: TtlCache<string> = new TtlCache<string>(TTL_IN_MS, 10, clock);
      cache.set('user-1:org-1', 'admin');
      cache.set('user-1:org-2', 'viewer');
      cache.set('user-2:org-1', 'manager');

      cache.deleteByPrefix('user-1:');

      expect(cache.get('user-1:org-1')).toBeUndefined();
      expect(cache.get('user-1:org-2')).toBeUndefined();
      expect(cache.get('user-2:org-1')).toBe('manager');
    });

    it('should do nothing when no key matches', (): void => {
      const cache: TtlCache<string> = new TtlCache<string>(TTL_IN_MS, 10, clock);
      cache.set('user-1:org-1', 'admin');

      cache.deleteByPrefix('user-3:');

      expect(cache.get('user-1:org-1')).toBe('admin');
    });
  });

  describe('delete', () => {
    it('should forget one entry and keep the others', (): void => {
      const cache: TtlCache<string> = new TtlCache<string>(TTL_IN_MS, 10, clock);
      cache.set('a', '1');
      cache.set('b', '2');

      cache.delete('a');

      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe('2');
    });

    it('should do nothing for an unknown key', (): void => {
      const cache: TtlCache<string> = new TtlCache<string>(TTL_IN_MS, 10, clock);
      cache.set('a', '1');

      cache.delete('nope');

      expect(cache.get('a')).toBe('1');
    });

    it('should free the slot of the deleted entry', (): void => {
      const cache: TtlCache<number> = new TtlCache<number>(TTL_IN_MS, 2, clock);
      cache.set('a', 1);
      cache.set('b', 2);

      cache.delete('b');
      cache.set('c', 3);

      expect(cache.get('a')).toBe(1);
      expect(cache.get('c')).toBe(3);
    });
  });

  describe('clear', () => {
    it('should forget every entry', (): void => {
      const cache: TtlCache<string> = new TtlCache<string>(TTL_IN_MS, 10, clock);
      cache.set('a', '1');
      cache.set('b', '2');

      cache.clear();

      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBeUndefined();
    });
  });

  describe('defaults', () => {
    afterEach((): void => {
      jest.useRealTimers();
    });

    it('should use the system clock and a large capacity', (): void => {
      jest.useFakeTimers({ now: new Date('2026-10-06T10:00:00.000Z') });
      const cache: TtlCache<number> = new TtlCache<number>(TTL_IN_MS);
      for (let index = 0; index < 1000; index++) cache.set(`key-${index}`, index);

      jest.setSystemTime(Date.now() + TTL_IN_MS - 1);
      expect(cache.get('key-0')).toBe(0);
      expect(cache.get('key-999')).toBe(999);

      jest.setSystemTime(Date.now() + 1);
      expect(cache.get('key-0')).toBeUndefined();
    });
  });
});
