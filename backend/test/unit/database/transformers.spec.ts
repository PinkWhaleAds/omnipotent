import { numericTransformer } from '@src/database/transformers';

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
});
