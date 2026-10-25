import { includeExclude, listReference, MAX_CRITERIA_VALUES, opaqueIds, range, windows } from '@src/targeting/families';
import { z } from 'zod';

/** A vocabulary to test the include/exclude family on. */
const colour = z.enum(['red', 'green']);

describe('Unit::Targeting::Families', () => {
  describe('includeExclude', () => {
    it('should answer both sides, the one left out empty', (): void => {
      expect(includeExclude(colour).parse({ include: ['red'] })).toEqual({ include: ['red'], exclude: [] });
    });

    it('should refuse a criterion that restricts nothing', (): void => {
      expect(includeExclude(colour).safeParse({}).success).toBe(false);
      expect(includeExclude(colour).safeParse({ include: [], exclude: [] }).success).toBe(false);
    });

    it('should refuse a value on both sides at once', (): void => {
      const parsed: z.ZodSafeParseResult<unknown> = includeExclude(colour).safeParse({
        include: ['red', 'green'],
        exclude: ['green'],
      });

      expect(parsed.success).toBe(false);
    });

    it('should refuse a value outside the vocabulary, and a field it does not declare', (): void => {
      expect(includeExclude(colour).safeParse({ include: ['blue'] }).success).toBe(false);
      expect(includeExclude(colour).safeParse({ include: ['red'], nope: 1 }).success).toBe(false);
    });

    it('should refuse more values than one side accepts', (): void => {
      const many: string[] = Array.from({ length: MAX_CRITERIA_VALUES + 1 }, (): string => 'red');

      expect(includeExclude(colour).safeParse({ include: many }).success).toBe(false);
    });
  });

  describe('opaqueIds', () => {
    it('should take the identifiers of a platform referential as they are', (): void => {
      expect(opaqueIds().parse({ include: ['LOI_42'], exclude: ['LOI_7'] })).toEqual({
        include: ['LOI_42'],
        exclude: ['LOI_7'],
      });
    });

    it('should refuse an empty identifier, and anything that is not a string', (): void => {
      expect(opaqueIds().safeParse({ include: [' '] }).success).toBe(false);
      expect(opaqueIds().safeParse({ include: [42] }).success).toBe(false);
    });
  });

  describe('listReference', () => {
    it('should take the ids of lists, and refuse what is not one', (): void => {
      const listId = '11111111-1111-4111-8111-111111111111';

      expect(listReference().parse({ include: [listId] })).toEqual({ include: [listId], exclude: [] });
      expect(listReference().safeParse({ include: ['nope'] }).success).toBe(false);
    });
  });

  describe('range', () => {
    const percent = { min: 0, max: 100, integer: true };

    it('should accept a range open on one end', (): void => {
      expect(range(percent).parse({ min: 70 })).toEqual({ min: 70 });
      expect(range(percent).parse({ max: 30 })).toEqual({ max: 30 });
    });

    it('should refuse a range open on both ends', (): void => {
      expect(range(percent).safeParse({}).success).toBe(false);
    });

    it('should refuse a lower end above the upper one', (): void => {
      expect(range(percent).safeParse({ min: 80, max: 20 }).success).toBe(false);
      expect(range(percent).parse({ min: 20, max: 80 })).toEqual({ min: 20, max: 80 });
    });

    it('should refuse what the bounds of the dimension exclude', (): void => {
      expect(range(percent).safeParse({ min: 120 }).success).toBe(false);
      expect(range(percent).safeParse({ min: 1.5 }).success).toBe(false);
      expect(range({ min: 0, max: 10 }).parse({ min: 1.5 })).toEqual({ min: 1.5 });
    });
  });

  describe('windows', () => {
    it('should default to the clock of the campaign', (): void => {
      expect(windows().parse({ windows: [{ day: 'monday', startHour: 9, endHour: 18 }] })).toEqual({
        windows: [{ day: 'monday', startHour: 9, endHour: 18 }],
        clock: 'campaign',
      });
    });

    it('should accept a whole day, and refuse a window that ends before it starts', (): void => {
      expect(windows().safeParse({ windows: [{ day: 'sunday', startHour: 0, endHour: 24 }] }).success).toBe(true);
      expect(windows().safeParse({ windows: [{ day: 'sunday', startHour: 18, endHour: 9 }] }).success).toBe(false);
      expect(windows().safeParse({ windows: [{ day: 'sunday', startHour: 9, endHour: 9 }] }).success).toBe(false);
    });

    it('should refuse an empty set of windows, and an unknown day', (): void => {
      expect(windows().safeParse({ windows: [] }).success).toBe(false);
      expect(windows().safeParse({ windows: [{ day: 'lundi', startHour: 0, endHour: 24 }] }).success).toBe(false);
    });
  });
});
