import { assertWindowOrdered, assertWindowWithinParent, DeliveryWindow } from '@src/services/tree.helpers';

/** The window of a campaign the children are checked against. */
const PARENT: DeliveryWindow = { startsOn: '2026-11-05', endsOn: '2026-11-20' };

describe('Unit::Services::TreeHelpers', () => {
  describe('assertWindowWithinParent', () => {
    it('should accept a window inside its parent', (): void => {
      expect((): void =>
        assertWindowWithinParent({ startsOn: '2026-11-10', endsOn: '2026-11-15' }, PARENT)
      ).not.toThrow();
    });

    it('should accept a window equal to its parent, which is what inheriting resolves to', (): void => {
      expect((): void => assertWindowWithinParent({ ...PARENT }, PARENT)).not.toThrow();
    });

    it('should refuse a window starting before its parent', (): void => {
      expect((): void => assertWindowWithinParent({ startsOn: '2026-11-01', endsOn: '2026-11-15' }, PARENT)).toThrow(
        expect.objectContaining({
          statusCode: 400,
          errorCode: 'dates_outside_parent',
          errorParams: { parentStart: '2026-11-05', parentEnd: '2026-11-20' },
        })
      );
    });

    it('should refuse a window ending after its parent', (): void => {
      expect((): void => assertWindowWithinParent({ startsOn: '2026-11-10', endsOn: '2026-11-30' }, PARENT)).toThrow(
        expect.objectContaining({ errorCode: 'dates_outside_parent' })
      );
    });
  });

  describe('assertWindowOrdered', () => {
    it('should accept a window of one day', (): void => {
      expect((): void => assertWindowOrdered({ startsOn: '2026-11-05', endsOn: '2026-11-05' })).not.toThrow();
    });

    it('should refuse a window that ends before it starts', (): void => {
      expect((): void => assertWindowOrdered({ startsOn: '2026-11-30', endsOn: '2026-11-01' })).toThrow(
        expect.objectContaining({
          statusCode: 400,
          errorCode: 'dates_reversed',
          errorParams: { startsOn: '2026-11-30', endsOn: '2026-11-01' },
        })
      );
    });
  });
});
