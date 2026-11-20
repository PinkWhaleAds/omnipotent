/**
 * @module platforms/google/google-geo
 *
 * The geo target constant of each country Google Ads targets, by ISO 3166-1 alpha-2 code — taken
 * from multi-search (`src/platforms/google/google-geo.ts`, our code), which generated it from
 * Google's official geotargets file `geotargets-2026-08-12.csv`, its 219 `Country` rows.
 *
 * Google describes the criterion ids as unique and persistent: regenerate the table when it publishes
 * a new geotargets file. The finer places — regions, cities, postal codes — come with the place
 * referential of lot 3c (`docs/phase-10.md` § 8.1).
 */

/** `geoTargetConstants/<id>` of each country Google targets, by ISO 3166-1 alpha-2 code. */
export const GEO_TARGET_IDS: Readonly<Record<string, number>> = {
  AD: 2020, // Andorra
  AE: 2784, // United Arab Emirates
  AF: 2004, // Afghanistan
  AG: 2028, // Antigua and Barbuda
  AL: 2008, // Albania
  AM: 2051, // Armenia
  AO: 2024, // Angola
  AQ: 2010, // Antarctica
  AR: 2032, // Argentina
  AS: 2016, // American Samoa
  AT: 2040, // Austria
  AU: 2036, // Australia
  AZ: 2031, // Azerbaijan
  BA: 2070, // Bosnia and Herzegovina
  BB: 2052, // Barbados
  BD: 2050, // Bangladesh
  BE: 2056, // Belgium
  BF: 2854, // Burkina Faso
  BG: 2100, // Bulgaria
  BH: 2048, // Bahrain
  BI: 2108, // Burundi
  BJ: 2204, // Benin
  BL: 2652, // Saint Barthelemy
  BN: 2096, // Brunei
  BO: 2068, // Bolivia
  BQ: 2535, // Caribbean Netherlands
  BR: 2076, // Brazil
  BS: 2044, // The Bahamas
  BT: 2064, // Bhutan
  BW: 2072, // Botswana
  BY: 2112, // Belarus
  BZ: 2084, // Belize
  CA: 2124, // Canada
  CC: 2166, // Cocos (Keeling) Islands
  CD: 2180, // Democratic Republic of the Congo
  CF: 2140, // Central African Republic
  CG: 2178, // Republic of the Congo
  CH: 2756, // Switzerland
  CI: 2384, // Cote d'Ivoire
  CK: 2184, // Cook Islands
  CL: 2152, // Chile
  CM: 2120, // Cameroon
  CN: 2156, // China
  CO: 2170, // Colombia
  CR: 2188, // Costa Rica
  CV: 2132, // Cabo Verde
  CW: 2531, // Curacao
  CX: 2162, // Christmas Island
  CY: 2196, // Cyprus
  CZ: 2203, // Czechia
  DE: 2276, // Germany
  DJ: 2262, // Djibouti
  DK: 2208, // Denmark
  DM: 2212, // Dominica
  DO: 2214, // Dominican Republic
  DZ: 2012, // Algeria
  EC: 2218, // Ecuador
  EE: 2233, // Estonia
  EG: 2818, // Egypt
  ER: 2232, // Eritrea
  ES: 2724, // Spain
  ET: 2231, // Ethiopia
  FI: 2246, // Finland
  FJ: 2242, // Fiji
  FM: 2583, // Micronesia
  FR: 2250, // France
  GA: 2266, // Gabon
  GB: 2826, // United Kingdom
  GD: 2308, // Grenada
  GE: 2268, // Georgia
  GG: 2831, // Guernsey
  GH: 2288, // Ghana
  GM: 2270, // The Gambia
  GN: 2324, // Guinea
  GQ: 2226, // Equatorial Guinea
  GR: 2300, // Greece
  GS: 2239, // South Georgia and the South Sandwich Islands
  GT: 2320, // Guatemala
  GU: 2316, // Guam
  GW: 2624, // Guinea-Bissau
  GY: 2328, // Guyana
  HM: 2334, // Heard Island and McDonald Islands
  HN: 2340, // Honduras
  HR: 2191, // Croatia
  HT: 2332, // Haiti
  HU: 2348, // Hungary
  ID: 2360, // Indonesia
  IE: 2372, // Ireland
  IL: 2376, // Israel
  IM: 2833, // Isle of Man
  IN: 2356, // India
  IQ: 2368, // Iraq
  IS: 2352, // Iceland
  IT: 2380, // Italy
  JE: 2832, // Jersey
  JM: 2388, // Jamaica
  JO: 2400, // Jordan
  JP: 2392, // Japan
  KE: 2404, // Kenya
  KG: 2417, // Kyrgyzstan
  KH: 2116, // Cambodia
  KI: 2296, // Kiribati
  KM: 2174, // Comoros
  KN: 2659, // Saint Kitts and Nevis
  KR: 2410, // South Korea
  KW: 2414, // Kuwait
  KZ: 2398, // Kazakhstan
  LA: 2418, // Laos
  LB: 2422, // Lebanon
  LC: 2662, // Saint Lucia
  LI: 2438, // Liechtenstein
  LK: 2144, // Sri Lanka
  LR: 2430, // Liberia
  LS: 2426, // Lesotho
  LT: 2440, // Lithuania
  LU: 2442, // Luxembourg
  LV: 2428, // Latvia
  LY: 2434, // Libya
  MA: 2504, // Morocco
  MC: 2492, // Monaco
  MD: 2498, // Moldova
  ME: 2499, // Montenegro
  MF: 2663, // Saint Martin
  MG: 2450, // Madagascar
  MH: 2584, // Marshall Islands
  MK: 2807, // North Macedonia
  ML: 2466, // Mali
  MM: 2104, // Myanmar (Burma)
  MN: 2496, // Mongolia
  MP: 2580, // Northern Mariana Islands
  MR: 2478, // Mauritania
  MT: 2470, // Malta
  MU: 2480, // Mauritius
  MV: 2462, // Maldives
  MW: 2454, // Malawi
  MX: 2484, // Mexico
  MY: 2458, // Malaysia
  MZ: 2508, // Mozambique
  NA: 2516, // Namibia
  NC: 2540, // New Caledonia
  NE: 2562, // Niger
  NF: 2574, // Norfolk Island
  NG: 2566, // Nigeria
  NI: 2558, // Nicaragua
  NL: 2528, // Netherlands
  NO: 2578, // Norway
  NP: 2524, // Nepal
  NR: 2520, // Nauru
  NU: 2570, // Niue
  NZ: 2554, // New Zealand
  OM: 2512, // Oman
  PA: 2591, // Panama
  PE: 2604, // Peru
  PF: 2258, // French Polynesia
  PG: 2598, // Papua New Guinea
  PH: 2608, // Philippines
  PK: 2586, // Pakistan
  PL: 2616, // Poland
  PM: 2666, // Saint Pierre and Miquelon
  PN: 2612, // Pitcairn Islands
  PT: 2620, // Portugal
  PW: 2585, // Palau
  PY: 2600, // Paraguay
  QA: 2634, // Qatar
  RO: 2642, // Romania
  RS: 2688, // Serbia
  RU: 2643, // Russia
  RW: 2646, // Rwanda
  SA: 2682, // Saudi Arabia
  SB: 2090, // Solomon Islands
  SC: 2690, // Seychelles
  SD: 2736, // Sudan
  SE: 2752, // Sweden
  SG: 2702, // Singapore
  SH: 2654, // Saint Helena, Ascension and Tristan da Cunha
  SI: 2705, // Slovenia
  SK: 2703, // Slovakia
  SL: 2694, // Sierra Leone
  SM: 2674, // San Marino
  SN: 2686, // Senegal
  SO: 2706, // Somalia
  SR: 2740, // Suriname
  SS: 2728, // South Sudan
  ST: 2678, // Sao Tome and Principe
  SV: 2222, // El Salvador
  SX: 2534, // Sint Maarten
  SY: 2760, // Syria
  SZ: 2748, // Eswatini
  TD: 2148, // Chad
  TF: 2260, // French Southern and Antarctic Lands
  TG: 2768, // Togo
  TH: 2764, // Thailand
  TJ: 2762, // Tajikistan
  TK: 2772, // Tokelau
  TL: 2626, // Timor-Leste
  TM: 2795, // Turkmenistan
  TN: 2788, // Tunisia
  TO: 2776, // Tonga
  TR: 2792, // Turkiye
  TT: 2780, // Trinidad and Tobago
  TV: 2798, // Tuvalu
  TZ: 2834, // Tanzania
  UA: 2804, // Ukraine
  UG: 2800, // Uganda
  UM: 2581, // United States Minor Outlying Islands
  US: 2840, // United States
  UY: 2858, // Uruguay
  UZ: 2860, // Uzbekistan
  VA: 2336, // Vatican City
  VC: 2670, // Saint Vincent and the Grenadines
  VE: 2862, // Venezuela
  VN: 2704, // Vietnam
  VU: 2548, // Vanuatu
  WF: 2876, // Wallis and Futuna
  WS: 2882, // Samoa
  YE: 2887, // Yemen
  ZA: 2710, // South Africa
  ZM: 2894, // Zambia
  ZW: 2716, // Zimbabwe
};

/**
 * The geo target constant of a country.
 *
 * @param country - ISO 3166-1 alpha-2, any case
 * @returns `geoTargetConstants/<id>`, or `null` for a country Google does not target
 *
 * @example
 * ```typescript
 * geoTargetConstant('FR'); // 'geoTargetConstants/2250'
 * ```
 */
export function geoTargetConstant(country: string): string | null {
  const code: string = country.toUpperCase();
  return Object.hasOwn(GEO_TARGET_IDS, code) ? `geoTargetConstants/${GEO_TARGET_IDS[code]}` : null;
}
