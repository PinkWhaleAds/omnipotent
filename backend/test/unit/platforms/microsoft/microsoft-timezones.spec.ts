import { ianaTimeZone, MICROSOFT_TIME_ZONES, MicrosoftTimeZone } from '@src/platforms/microsoft/microsoft-timezones';

describe('Unit::Platforms::Microsoft::TimeZones', () => {
  it('should give the IANA zone of an account time zone', (): void => {
    expect(ianaTimeZone('BrusselsCopenhagenMadridParis')).toBe('Europe/Paris');
  });

  it('should read the campaign and the report spellings too', (): void => {
    expect(ianaTimeZone('Yangon')).toBe('Asia/Yangon');
    expect(ianaTimeZone('AthensIslandanbulMinsk')).toBe('Europe/Athens');
  });

  it.each([
    ['an unknown zone', 'Mars'],
    ['an empty one', ''],
    ['none', null],
    ['nothing', undefined],
  ])('should guess nothing for %s', (_label: string, value: string | null | undefined): void => {
    expect(ianaTimeZone(value)).toBeNull();
  });

  it('should name only zones the runtime knows', (): void => {
    for (const zone of Object.values(MICROSOFT_TIME_ZONES) as MicrosoftTimeZone[]) {
      expect((): string => new Intl.DateTimeFormat('en', { timeZone: zone.iana }).format(0)).not.toThrow();
    }
  });
});
