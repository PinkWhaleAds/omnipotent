/**
 * @module platforms/microsoft/microsoft-timezones
 *
 * The time zones of Microsoft Advertising and their IANA names (`docs/phase-11.md` § 2), transcribed
 * from multi-search (`src/platforms/microsoft/microsoft-timezones.ts`), whose study read them on
 * Microsoft's documentation on 2026-10-07: the `TimeZoneType` enumeration of accounts, the campaign
 * list of the « Time Zones » guide and the `ReportTimeZone` enumeration of the Reporting service.
 *
 * The three official lists spell a few zones differently, hence the aliases. Microsoft publishes
 * standard offsets only; the zones follow daylight saving time, so each maps to the IANA zone of its
 * first city with that offset — where a city changed offset since, the published offset wins.
 */

/**
 * One time zone of Microsoft Advertising.
 *
 * @property iana - IANA time zone
 * @property campaign - Spelling of `Campaign.TimeZone`, when it differs from the account's
 * @property report - Spelling of `ReportTimeZone`, when it differs from the account's
 */
export type MicrosoftTimeZone = { iana: string; campaign?: string; report?: string };

/** Every `TimeZoneType` of an account (75). */
export const MICROSOFT_TIME_ZONES: Readonly<Record<string, MicrosoftTimeZone>> = {
  AbuDhabiMuscat: { iana: 'Asia/Dubai' },
  Adelaide: { iana: 'Australia/Adelaide' },
  Alaska: { iana: 'America/Anchorage' },
  // Almaty moved to UTC+5 in 2024; Microsoft still publishes UTC+6.
  AlmatyNovosibirsk: { iana: 'Asia/Almaty' },
  AmsterdamBerlinBernRomeStockholmVienna: { iana: 'Europe/Berlin' },
  Arizona: { iana: 'America/Phoenix' },
  AstanaDhaka: { iana: 'Asia/Dhaka' },
  // Istanbul and Minsk moved to UTC+3; Athens keeps the published UTC+2.
  AthensBuckarestIstanbul: { iana: 'Europe/Athens', report: 'AthensIslandanbulMinsk' },
  AtlanticTimeCanada: { iana: 'America/Halifax' },
  AucklandWellington: { iana: 'Pacific/Auckland' },
  Azores: { iana: 'Atlantic/Azores' },
  Baghdad: { iana: 'Asia/Baghdad' },
  BakuTbilisiYerevan: { iana: 'Asia/Baku' },
  BangkokHanoiJakarta: { iana: 'Asia/Bangkok' },
  BeijingChongqingHongKongUrumqi: { iana: 'Asia/Shanghai' },
  BelgradeBratislavaBudapestLjubljanaPrague: { iana: 'Europe/Budapest' },
  BogotaLimaQuito: { iana: 'America/Bogota' },
  Brasilia: { iana: 'America/Sao_Paulo' },
  Brisbane: { iana: 'Australia/Brisbane' },
  BrusselsCopenhagenMadridParis: { iana: 'Europe/Paris' },
  Bucharest: { iana: 'Europe/Bucharest' },
  BuenosAiresGeorgetown: { iana: 'America/Argentina/Buenos_Aires' },
  Cairo: { iana: 'Africa/Cairo' },
  CanberraMelbourneSydney: { iana: 'Australia/Sydney' },
  CapeVerdeIsland: { iana: 'Atlantic/Cape_Verde' },
  CaracasLaPaz: { iana: 'America/Caracas' },
  // Casablanca moved to UTC+1; Monrovia keeps the published UTC+0.
  CasablancaMonrovia: { iana: 'Africa/Monrovia' },
  CentralAmerica: { iana: 'America/Guatemala' },
  CentralTimeUSCanada: { iana: 'America/Chicago' },
  ChennaiKolkataMumbaiNewDelhi: { iana: 'Asia/Kolkata' },
  ChihuahuaLaPazMazatlan: { iana: 'America/Mazatlan' },
  Darwin: { iana: 'Australia/Darwin' },
  EasternTimeUSCanada: { iana: 'America/New_York' },
  Ekaterinburg: { iana: 'Asia/Yekaterinburg' },
  FijiKamchatkaMarshallIsland: { iana: 'Pacific/Fiji' },
  // Nuuk moved to UTC-2; Microsoft still publishes UTC-3.
  Greenland: { iana: 'America/Nuuk' },
  GreenwichMeanTimeDublinEdinburghLisbonLondon: { iana: 'Europe/London' },
  GuadalajaraMexicoCityMonterrey: { iana: 'America/Mexico_City' },
  GuamPortMoresby: { iana: 'Pacific/Port_Moresby' },
  HararePretoria: { iana: 'Africa/Johannesburg' },
  Hawaii: { iana: 'Pacific/Honolulu' },
  HelsinkiKyivRigaSofiaTallinnVilnius: { iana: 'Europe/Helsinki' },
  Hobart: { iana: 'Australia/Hobart' },
  IndianaEast: { iana: 'America/Indiana/Indianapolis' },
  InternationalDateLineWest: { iana: 'Etc/GMT+12' },
  IrkutskUlaanBataar: { iana: 'Asia/Irkutsk' },
  IslamabadKarachiTashkent: {
    iana: 'Asia/Karachi',
    campaign: 'IslandamabadKarachiTashkent',
    report: 'IslandamabadKarachiTashkent',
  },
  Jerusalem: { iana: 'Asia/Jerusalem' },
  Kabul: { iana: 'Asia/Kabul' },
  Kathmandu: { iana: 'Asia/Kathmandu' },
  Krasnoyarsk: { iana: 'Asia/Krasnoyarsk' },
  KualaLumpurSingapore: { iana: 'Asia/Singapore' },
  KuwaitRiyadh: { iana: 'Asia/Riyadh' },
  MidAtlantic: { iana: 'Atlantic/South_Georgia' },
  MidwayIslandAndSamoa: { iana: 'Pacific/Pago_Pago', report: 'MidwayIslandandSamoa' },
  MoscowStPetersburgVolgograd: { iana: 'Europe/Moscow' },
  MountainTimeUSCanada: { iana: 'America/Denver' },
  Nairobi: { iana: 'Africa/Nairobi' },
  Newfoundland: { iana: 'America/St_Johns', campaign: 'Newfoundland and Labrador' },
  Nukualofa: { iana: 'Pacific/Tongatapu' },
  OsakaSapporoTokyo: { iana: 'Asia/Tokyo' },
  PacificTimeUSCanadaTijuana: { iana: 'America/Los_Angeles' },
  Perth: { iana: 'Australia/Perth' },
  Rangoon: { iana: 'Asia/Yangon', campaign: 'Yangon' },
  Santiago: { iana: 'America/Santiago' },
  SarajevoSkopjeWarsawZagreb: { iana: 'Europe/Warsaw' },
  Saskatchewan: { iana: 'America/Regina' },
  Seoul: { iana: 'Asia/Seoul' },
  SolomonIslandNewCaledonia: { iana: 'Pacific/Guadalcanal', report: 'MagadanSolomonIslandNewCaledonia' },
  SriJayawardenepura: { iana: 'Asia/Colombo' },
  Taipei: { iana: 'Asia/Taipei' },
  Tehran: { iana: 'Asia/Tehran' },
  Vladivostok: { iana: 'Asia/Vladivostok' },
  WestCentralAfrica: { iana: 'Africa/Lagos' },
  Yakutsk: { iana: 'Asia/Yakutsk' },
};

/**
 * The account time zone a value names, in any of the three spellings.
 *
 * @param value - A `TimeZoneType`, or its campaign or report spelling
 * @returns The account's `TimeZoneType`, or `null` for an unknown value
 */
function accountZoneOf(value: string | null | undefined): string | null {
  if (!value) return null;
  if (Object.hasOwn(MICROSOFT_TIME_ZONES, value)) return value;
  const found: [string, MicrosoftTimeZone] | undefined = Object.entries(MICROSOFT_TIME_ZONES).find(
    ([, zone]: [string, MicrosoftTimeZone]): boolean => zone.campaign === value || zone.report === value
  );
  return found ? found[0] : null;
}

/**
 * The IANA time zone of a Microsoft time zone.
 *
 * @param value - A `TimeZoneType` (or its campaign or report spelling)
 * @returns The IANA zone, or `null` for a zone the table does not know
 */
export function ianaTimeZone(value: string | null | undefined): string | null {
  const zone: string | null = accountZoneOf(value);
  return zone ? MICROSOFT_TIME_ZONES[zone].iana : null;
}
