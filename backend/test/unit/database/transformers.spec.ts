import { centsTransformer, numericTransformer } from '@src/database/transformers';

describe('Unit::Database::Transformers', () => {
  describe('numericTransformer', () => {
    it('should write numbers, null and undefined unchanged', (): void => {
      expect(numericTransformer.to(1234.5)).toBe(1234.5);
      expect(numericTransformer.to(null)).toBeNull();
      expect(numericTransformer.to(undefined)).toBeUndefined();
    });

    it('should read the numeric strings of the driver as numbers', (): void => {
      expect(numericTransformer.from('12000.00')).toBe(12000);
      expect(numericTransformer.from('0.05')).toBe(0.05);
    });

    it('should read null as null', (): void => {
      expect(numericTransformer.from(null)).toBeNull();
    });
  });

  describe('centsTransformer', () => {
    it('should write cent amounts, null and undefined unchanged', (): void => {
      expect(centsTransformer.to(225_000)).toBe(225_000);
      expect(centsTransformer.to(null)).toBeNull();
      expect(centsTransformer.to(undefined)).toBeUndefined();
    });

    it('should read the bigint strings of the driver as numbers', (): void => {
      expect(centsTransformer.from('225000')).toBe(225_000);
      // Far above what an `integer` column would hold, which is why the column is a `bigint`.
      expect(centsTransformer.from('9007199254740')).toBe(9_007_199_254_740);
    });

    it('should read null as null, which is how a node says it inherits', (): void => {
      expect(centsTransformer.from(null)).toBeNull();
    });
  });
});
