import {
  downloadGeoTargets,
  GeoTargetRow,
  GOOGLE_GEO_TARGET_COLUMNS,
  isGeoTargetsFile,
  latestGeoTargetsUrl,
  levelOf,
  normalizeSearchText,
  parseGoogleGeoTarget,
  searchTextOf,
} from '@src/geo/google-geo-targets';

/** Google's page of the catalog. */
const PAGE_URL = 'https://developers.google.com/google-ads/api/data/geotargets';

/**
 * A line of the catalog.
 *
 * @param overrides - Values replacing those of Paris
 * @returns The line, by column
 */
function record(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'Criteria ID': '1006094',
    Name: 'Paris',
    'Canonical Name': 'Paris,Paris,Ile-de-France,France',
    'Parent ID': '9040871',
    'Country Code': 'FR',
    'Target Type': 'City',
    Status: 'Active',
    ...overrides,
  };
}

describe('Unit::Geo::GoogleGeoTargets', () => {
  it('should read the seven columns of the catalog', (): void => {
    expect(GOOGLE_GEO_TARGET_COLUMNS).toEqual([
      'Criteria ID',
      'Name',
      'Canonical Name',
      'Parent ID',
      'Country Code',
      'Target Type',
      'Status',
    ]);
  });

  describe('levelOf', () => {
    it.each([
      ['Country', 'FR', 'France', 'country'],
      ['Region', 'FR', 'Brittany', 'region'],
      ['State', 'US', 'California', 'region'],
      ['Province', 'BE', 'Antwerp', 'region'],
      ['Territory', 'CA', 'Yukon', 'region'],
      ['Autonomous Community', 'ES', 'Catalonia', 'region'],
      ['Prefecture', 'JP', 'Tokyo', 'region'],
      ['Governorate', 'EG', 'Cairo Governorate', 'region'],
      ['Union Territory', 'IN', 'Delhi', 'region'],
      ['Department', 'FR', 'Gironde', 'department'],
      ['County', 'US', 'Orange County', 'department'],
      ['City', 'FR', 'Paris', 'city'],
      ['Municipality', 'IT', 'Naples', 'city'],
      ['District', 'FR', '15th arrondissement', 'city'],
      ['District', 'FR', 'Lomme', 'city'],
      ['district', 'NL', 'Haarlem-Oost', 'city'],
      ['Borough', 'US', 'Brooklyn', 'city'],
      ['Post town', 'GB', 'Sale', 'city'],
      ['Commune', 'VN', 'Binh Hoa', 'city'],
      ['Postal Code', 'FR', '75001', 'postal_code'],
      ['Canton', 'CH', 'Geneva', 'region'],
      ['Canton', 'LU', 'Wiltz', 'department'],
    ])('should offer a %s of %s (%s) as a %s', (type: string, country: string, name: string, level: string): void => {
      expect(levelOf(type, country, name)).toBe(level);
    });

    it.each([
      ['Canton', 'FR', 'Canton of Toulouse-9'],
      ['Canton', 'YT', 'Mamoudzou-3'],
      ['District', 'FR', 'Canton of Lille-1'],
      ['Municipality', 'FR', 'Arrondissement of Saumur'],
      ['Department', 'FR', 'Arrondissement of Lyon'],
      ['Municipality', 'FR', "Arrondissement d'Angers"],
      ['Neighborhood', 'FR', 'Montfavet'],
      ['Airport', 'FR', 'Bordeaux Aeroport'],
      ['Okrug', 'RU', 'Central Administrative Okrug'],
      ['TV Region', 'GB', 'London'],
      ['Spaceport', null, 'Kourou'],
    ])('should not offer a %s of %s (%s)', (type: string, country: string | null, name: string): void => {
      expect(levelOf(type, country, name)).toBeNull();
    });
  });

  describe('normalizeSearchText', () => {
    it('should lower the case and drop accents and punctuation', (): void => {
      expect(normalizeSearchText('  Saint-Étienne, Auvergne-Rhône-Alpes ')).toBe('saint etienne auvergne rhone alpes');
      expect(normalizeSearchText("Provence-Alpes-Côte d'Azur")).toBe('provence alpes cote d azur');
      expect(normalizeSearchText('75001')).toBe('75001');
    });
  });

  describe('searchTextOf', () => {
    it('should join the name and the full name, apart', (): void => {
      expect(searchTextOf('Gironde', 'Gironde,Nouvelle-Aquitaine,France', 'FR')).toBe(
        'gironde | gironde nouvelle aquitaine france'
      );
    });

    it('should add the French names of the English parts of a French place', (): void => {
      expect(searchTextOf('Brittany', 'Brittany,France', 'FR')).toBe('brittany bretagne | brittany france bretagne');
      expect(searchTextOf('Rennes', 'Rennes,Brittany,France', 'FR')).toBe('rennes | rennes brittany france bretagne');
      expect(searchTextOf('French Guiana', 'French Guiana', 'GF')).toBe('french guiana guyane | french guiana guyane');
    });

    it('should not add French names outside France', (): void => {
      expect(searchTextOf('Normandy', 'Normandy,Texas,United States', 'US')).toBe(
        'normandy | normandy texas united states'
      );
      expect(searchTextOf('Normandy', 'Normandy', null)).toBe('normandy | normandy');
    });

    it('should not take a name for a built-in property', (): void => {
      expect(searchTextOf('constructor', 'constructor,France', 'FR')).toBe('constructor | constructor france');
      expect(levelOf('constructor', 'FR', 'x')).toBeNull();
    });

    it('should keep 800 characters at most', (): void => {
      expect(searchTextOf('a'.repeat(255), 'b'.repeat(500), 'FR')).toHaveLength(758);
      expect(searchTextOf('a'.repeat(500), 'b'.repeat(500), 'FR')).toHaveLength(800);
    });
  });

  describe('parseGoogleGeoTarget', () => {
    it('should read a place with its level and search text', (): void => {
      expect(parseGoogleGeoTarget(record())).toEqual<GeoTargetRow>({
        id: '1006094',
        name: 'Paris',
        canonicalName: 'Paris,Paris,Ile-de-France,France',
        searchText: 'paris | paris paris ile de france france',
        parentId: '9040871',
        countryCode: 'FR',
        targetType: 'City',
        level: 'city',
        status: 'Active',
      });
    });

    it('should read a country without parent, and a place without country or full name', (): void => {
      expect(
        parseGoogleGeoTarget(
          record({
            'Criteria ID': '2250',
            Name: 'France',
            'Canonical Name': 'France',
            'Parent ID': '',
            'Target Type': 'Country',
          })
        )
      ).toMatchObject({ id: '2250', parentId: null, level: 'country' });
      expect(
        parseGoogleGeoTarget(record({ 'Canonical Name': '', 'Country Code': '', Status: 'Removal Planned' }))
      ).toMatchObject({ canonicalName: 'Paris', countryCode: null, status: 'Removal Planned' });
    });

    it.each([
      ['an id that is not a number', { 'Criteria ID': 'abc' }],
      ['an id of more than 12 digits', { 'Criteria ID': '1234567890123' }],
      ['a parent that is not a number', { 'Parent ID': 'x1' }],
      ['no name', { Name: '' }],
      ['no target type', { 'Target Type': '' }],
      ['no status', { Status: '' }],
      ['a name over 255 characters', { Name: 'a'.repeat(256) }],
      ['a full name over 500 characters', { 'Canonical Name': 'a'.repeat(501) }],
      ['a target type over 40 characters', { 'Target Type': 'a'.repeat(41) }],
      ['a status over 20 characters', { Status: 'a'.repeat(21) }],
    ])('should skip a line with %s', (_label: string, overrides: Record<string, string>): void => {
      expect(parseGoogleGeoTarget(record(overrides))).toBeNull();
    });
  });

  describe('isGeoTargetsFile', () => {
    it('should tell a file from the page listing them', (): void => {
      expect(isGeoTargetsFile(PAGE_URL)).toBe(false);
      expect(isGeoTargetsFile('https://example.com/geotargets-2026-08-12.csv')).toBe(true);
      expect(isGeoTargetsFile('https://example.com/geotargets-2026-08-12.CSV.zip?v=1')).toBe(true);
    });
  });

  describe('latestGeoTargetsUrl', () => {
    it("should take the most recent file of the page's own site", (): void => {
      const page: string =
        '<a href="/static/google-ads/api/data/geo/geotargets-2026-07-16.csv.zip">Previous</a>' +
        '<a href="https://evil.example.com/geotargets-2027-01-01.csv.zip">Elsewhere</a>' +
        '<a href="/static/google-ads/api/data/geo/geotargets-2026-08-12.csv.zip">Latest</a>' +
        '<a href="/static/google-ads/api/data/geo/geotargets-2025-01-01.csv">Old</a>';

      expect(latestGeoTargetsUrl(page, PAGE_URL)).toBe(
        'https://developers.google.com/static/google-ads/api/data/geo/geotargets-2026-08-12.csv.zip'
      );
    });

    it('should find nothing on a page without file', (): void => {
      expect(latestGeoTargetsUrl('<p>Moved</p>', PAGE_URL)).toBeNull();
    });
  });

  describe('downloadGeoTargets', () => {
    it('should download a configured file directly', async (): Promise<void> => {
      const fetch: jest.Mock = jest.fn().mockResolvedValue(Buffer.from('csv'));

      await expect(downloadGeoTargets('https://example.com/geotargets.csv', fetch)).resolves.toEqual({
        url: 'https://example.com/geotargets.csv',
        content: Buffer.from('csv'),
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should download the latest file linked from the page', async (): Promise<void> => {
      const fileUrl = 'https://developers.google.com/static/google-ads/api/data/geo/geotargets-2026-08-12.csv.zip';
      const fetch: jest.Mock = jest
        .fn()
        .mockResolvedValueOnce(Buffer.from(`<a href="${fileUrl}">Latest</a>`))
        .mockResolvedValueOnce(Buffer.from('zip'));

      await expect(downloadGeoTargets(PAGE_URL, fetch)).resolves.toEqual({ url: fileUrl, content: Buffer.from('zip') });
      expect(fetch).toHaveBeenNthCalledWith(1, PAGE_URL);
      expect(fetch).toHaveBeenNthCalledWith(2, fileUrl);
    });

    it('should fail when the page links no file', async (): Promise<void> => {
      const fetch: jest.Mock = jest.fn().mockResolvedValue(Buffer.from('<p>Moved</p>'));

      await expect(downloadGeoTargets(PAGE_URL, fetch)).rejects.toThrow(
        `No geo targets file is linked from ${PAGE_URL}`
      );
    });
  });
});
