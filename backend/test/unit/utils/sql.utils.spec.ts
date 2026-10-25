import { escapeLike, withoutAccents, withoutAccentsSql } from '@utils/sql.utils';

describe('Unit::Utils::Sql', () => {
  describe('escapeLike', () => {
    it('should leave text without wildcards unchanged', (): void => {
      expect(escapeLike('Spring sale 2027')).toBe('Spring sale 2027');
    });

    it('should escape the percent wildcard', (): void => {
      expect(escapeLike('100%')).toBe('100\\%');
    });

    it('should escape the underscore wildcard', (): void => {
      expect(escapeLike('summer_sale')).toBe('summer\\_sale');
    });

    it('should escape the backslash so it cannot escape what follows', (): void => {
      expect(escapeLike('a\\b')).toBe('a\\\\b');
    });

    it('should escape every occurrence, wherever it is', (): void => {
      expect(escapeLike('%_\\%_\\')).toBe('\\%\\_\\\\\\%\\_\\\\');
    });

    it('should return an empty string for an empty search', (): void => {
      expect(escapeLike('')).toBe('');
    });
  });

  describe('withoutAccents', () => {
    it('should remove the accents of the letters, keeping their case', (): void => {
      expect(withoutAccents('Herbéa Noël À Ça')).toBe('Herbea Noel A Ca');
    });

    it('should remove the accents of decomposed letters too', (): void => {
      expect(withoutAccents('He\u0301rbe\u0301a')).toBe('Herbea');
    });

    it('should keep letters without decomposition, digits and wildcards', (): void => {
      expect(withoutAccents('Œuvre ø 100%_')).toBe('Œuvre ø 100%_');
    });
  });

  describe('withoutAccentsSql', () => {
    it('should decompose the expression and remove its combining marks', (): void => {
      expect(withoutAccentsSql('"account"."name"')).toBe(
        `regexp_replace(normalize("account"."name", NFD), '[\\u0300-\\u036f]', '', 'g')`
      );
    });
  });
});
