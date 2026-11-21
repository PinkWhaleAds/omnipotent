import { toAlpha2 } from '@src/geo/country-codes';

describe('Unit::Geo::CountryCodes', () => {
  it.each([
    ['FRA', 'FR'],
    ['DEU', 'DE'],
    ['GBR', 'GB'],
    ['USA', 'US'],
    ['REU', 'RE'],
    ['NAM', 'NA'],
    ['XKS', 'XK'],
    ['XKX', 'XK'],
    ['ZWE', 'ZW'],
    [' fra ', 'FR'],
  ])('should turn the alpha-3 code %s into %s', (alpha3: string, alpha2: string): void => {
    expect(toAlpha2(alpha3)).toBe(alpha2);
  });

  it('should keep an alpha-2 code, in upper case', (): void => {
    expect(toAlpha2('fr')).toBe('FR');
    expect(toAlpha2('BE')).toBe('BE');
  });

  it('should know nothing of an unknown or malformed code', (): void => {
    expect(toAlpha2('ZZZ')).toBeNull();
    expect(toAlpha2('F')).toBeNull();
    expect(toAlpha2('')).toBeNull();
  });
});
