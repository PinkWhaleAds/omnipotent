import { randomUUID } from 'node:crypto';

import { strToU8, zipSync } from 'fflate';
import { DataSource, QueryFailedError, Repository } from 'typeorm';

import { AdAccountEntity, CampaignEntity, GeoLocationEntity, PlatformUnitEntity } from '@src/database/entities';
import { ADAPTERS, PlatformAdapter } from '@src/platforms/platform-adapter';
import { GeoImportService } from '@src/services/geo-import.service';
import { GeoService } from '@src/services/geo.service';
import { ReviewService } from '@src/services/review.service';
import { AdReview, GeoLocation, GeoLocationList, Platform } from '@src/types';
import { connectIntegrationDatabase, seedTree, SeededTree, truncateAll } from './database.utils';

/**
 * What only a real PostgreSQL can prove about the schema of phase 10: an account linked to **our**
 * manager account belongs to **one** Organization among the living rows, whichever it is — our
 * credentials reach every account so linked — and one waiting for its client has no name, currency
 * or timezone yet (`docs/phase-10.md` §§ 4.4 and 4.5).
 */
describe('Integration::Phase10', () => {
  const ORGANIZATION = 'c0000000-0000-4000-8000-000000000001';
  const OTHER_ORGANIZATION = 'c0000000-0000-4000-8000-000000000002';
  let dataSource: DataSource;

  /**
   * Connect an account the way a `manager_link` platform does: the reference alone, waiting.
   *
   * @param organizationId - Whose Organization
   * @param linkRef - Its reference, `null` for one declared by hand
   * @returns The row
   */
  async function connect(organizationId: string, linkRef: string | null): Promise<AdAccountEntity> {
    const accounts: Repository<AdAccountEntity> = dataSource.getRepository(AdAccountEntity);
    return accounts.save(
      accounts.create({
        organizationId,
        platform: 'google_ads',
        externalId: linkRef ?? '1234567890',
        name: null,
        currency: null,
        timezone: null,
        status: 'pending',
        statusReason: 'link_requested',
        scope: {},
        secretName: null,
        linkRef,
        linkRequestedAt: linkRef === null ? null : new Date(),
      })
    );
  }

  beforeAll(async (): Promise<void> => {
    dataSource = await connectIntegrationDatabase();
  });

  afterAll(async (): Promise<void> => {
    await dataSource.destroy();
  });

  beforeEach(async (): Promise<void> => {
    await truncateAll(dataSource);
  });

  it('should keep an account waiting for its client with no name, currency or timezone', async (): Promise<void> => {
    await expect(connect(ORGANIZATION, '5550001111')).resolves.toMatchObject({
      name: null,
      currency: null,
      timezone: null,
      linkRef: '5550001111',
    });
  });

  it('should refuse a linked account to a second Organization', async (): Promise<void> => {
    await connect(ORGANIZATION, '5550001111');

    // The index that phase 7 did not need: there, another Organization could connect the same
    // account, since each brought its own key.
    await expect(connect(OTHER_ORGANIZATION, '5550001111')).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('should free a linked account once disconnected', async (): Promise<void> => {
    const account: AdAccountEntity = await connect(ORGANIZATION, '5550001111');
    await dataSource.getRepository(AdAccountEntity).update({ id: account.id }, { deletedAt: new Date() });

    await expect(connect(OTHER_ORGANIZATION, '5550001111')).resolves.toMatchObject({
      organizationId: OTHER_ORGANIZATION,
    });
  });

  it('should leave the accounts declared by hand out of it', async (): Promise<void> => {
    await connect(ORGANIZATION, null);

    await expect(connect(OTHER_ORGANIZATION, null)).resolves.toMatchObject({ linkRef: null });
  });

  describe('the verdicts to read', () => {
    /** The registry of adapters, writable, so the spec declares Google's as the application does. */
    const adapters: Partial<Record<Platform, PlatformAdapter>> = ADAPTERS as Partial<Record<Platform, PlatformAdapter>>;
    const NOW: Date = new Date('2027-01-03T10:00:00.000Z');
    const APPROVED: AdReview = { status: 'approved', reasons: [] };
    let tree: SeededTree;
    let account: AdAccountEntity;
    let readReviews: jest.Mock;

    /**
     * Insert a unit on Google, under an AdGroup of its own.
     *
     * @param ad - The id of its one ad
     * @param overrides - What this case declares
     * @returns The row
     */
    async function seedUnit(ad: string, overrides: Partial<PlatformUnitEntity> = {}): Promise<PlatformUnitEntity> {
      const units: Repository<PlatformUnitEntity> = dataSource.getRepository(PlatformUnitEntity);
      return units.save(
        units.create({
          organizationId: ORGANIZATION,
          campaignId: tree.campaignId,
          leverId: tree.leverId,
          adGroupId: randomUUID(),
          lever: 'search',
          platform: 'google_ads',
          adAccountId: account.id,
          fxRate: 1,
          refs: { [`line:${ad}`]: ad },
          syncState: 'synced',
          ...overrides,
        })
      );
    }

    beforeEach(async (): Promise<void> => {
      tree = await seedTree(dataSource, ORGANIZATION);
      await dataSource.getRepository(CampaignEntity).update({ id: tree.campaignId }, { status: 'paused' });
      account = await connect(ORGANIZATION, '5550001111');
      await dataSource
        .getRepository(AdAccountEntity)
        .update(
          { id: account.id },
          { status: 'active', statusReason: null, currency: 'EUR', timezone: 'Europe/Paris' }
        );
      readReviews = jest.fn(
        async (_account: unknown, ads: string[]): Promise<Map<string, AdReview>> =>
          new Map(ads.map((ad: string): [string, AdReview] => [ad, APPROVED]))
      );
      adapters.google_ads = {
        platform: 'google_ads',
        connection: 'manager_link',
        apply: jest.fn(),
        readReviews,
      } as PlatformAdapter;
    });

    afterEach((): void => {
      Reflect.deleteProperty(adapters, 'google_ads');
    });

    it('should read a verdict awaited, a unit never read, and one read a day ago — and only them', async (): Promise<void> => {
      const hourAgo = new Date(NOW.getTime() - 3_600_000);
      await seedUnit('awaited', {
        reviews: { 'line:awaited': { status: 'pending', reasons: [] } },
        reviewsReadAt: hourAgo,
      });
      await seedUnit('never', { reviewsReadAt: null });
      await seedUnit('stale', {
        reviews: { 'line:stale': APPROVED },
        reviewsReadAt: new Date(NOW.getTime() - 25 * 3_600_000),
      });
      await seedUnit('fresh', { reviews: { 'line:fresh': APPROVED }, reviewsReadAt: hourAgo });

      await new ReviewService(dataSource, { get: jest.fn() } as never, (): number => NOW.getTime()).poll();

      expect(readReviews).toHaveBeenCalledTimes(1);
      expect([...(readReviews.mock.calls[0][1] as string[])].sort()).toEqual(['awaited', 'never', 'stale']);
      const stored: PlatformUnitEntity[] = await dataSource.getRepository(PlatformUnitEntity).find();
      const awaited = stored.find((row: PlatformUnitEntity): boolean => row.refs['line:awaited'] !== undefined);
      expect(awaited).toMatchObject({ reviews: { 'line:awaited': APPROVED }, reviewsReadAt: NOW });
    });

    it('should leave alone the ads of a campaign ended, and of an account no longer active', async (): Promise<void> => {
      await seedUnit('never');
      await dataSource.getRepository(CampaignEntity).update({ id: tree.campaignId }, { status: 'ended' });

      await new ReviewService(dataSource, { get: jest.fn() } as never, (): number => NOW.getTime()).poll();
      await dataSource.getRepository(CampaignEntity).update({ id: tree.campaignId }, { status: 'active' });
      await dataSource.getRepository(AdAccountEntity).update({ id: account.id }, { status: 'invalid' });
      await new ReviewService(dataSource, { get: jest.fn() } as never, (): number => NOW.getTime()).poll();

      expect(readReviews).not.toHaveBeenCalled();
    });
  });

  describe('the referential of places', () => {
    /** Header of Google's catalog. */
    const HEADER = 'Criteria ID,Name,Canonical Name,Parent ID,Country Code,Target Type,Status';

    /** Real lines of Google's catalog of 2026-08-12, as multi-search's suite reads them. */
    const CATALOG: string[] = [
      '"2250","France","France","","FR","Country",Active',
      '"2056","Belgium","Belgium","","BE","Country",Active',
      '"20316","Brittany","Brittany,France","2250","FR","Region",Active',
      '"20321","Ile-de-France","Ile-de-France,France","2250","FR","Region",Active',
      '"9069525","Auvergne-Rhone-Alpes","Auvergne-Rhone-Alpes,France","2250","FR","Region",Active',
      '"20052","Brussels","Brussels,Belgium","2056","BE","Province",Active',
      '"9040871","Paris","Paris,Ile-de-France,France","20321","FR","Department",Active',
      '"9040889","Loire","Loire,Auvergne-Rhone-Alpes,France","9069525","FR","Department",Active',
      '"1006094","Paris","Paris,Paris,Ile-de-France,France","20321","FR","City",Active',
      '"1006410","Lyon","Lyon,Auvergne-Rhone-Alpes,France","9069525","FR","City",Active',
      '"1005876","Rennes","Rennes,Brittany,France","20316","FR","City",Active',
      '"1006427","Saint-Etienne","Saint-Etienne,Auvergne-Rhone-Alpes,France","9069525","FR","City",Active',
      '"9050107","Saint-Etienne-du-Rouvray","Saint-Etienne-du-Rouvray,Normandy,France","9068565","FR","City",Active',
      '"1001004","Brussels","Brussels,Brussels,Belgium","20052","BE","City",Active',
      '"9194148","15th arrondissement","15th arrondissement,Provence-Alpes-Cote d\'Azur,France","20332","FR","District",Active',
      '"9196217","Canton of Lille-1","Canton of Lille-1,Hauts-de-France,France","9068898","FR","District",Active',
      '"1005918","Chalons-sur-Marne","Chalons-sur-Marne,France","2250","FR","City",Removal Planned',
      '"9056126","75001","75001,Ile-de-France,France","20321","FR","Postal Code",Active',
      '"9055498","42000","42000,Auvergne-Rhone-Alpes,France","9069525","FR","Postal Code",Active',
    ];

    let geo: GeoService;
    let imports: GeoImportService;
    let download: jest.Mock;

    /**
     * A zipped catalog, as Google publishes it.
     *
     * @param lines - Its lines, header excluded
     * @returns The ZIP
     */
    function zippedCatalog(lines: string[]): Buffer {
      return Buffer.from(zipSync({ 'geotargets-2026-08-12.csv': strToU8([HEADER, ...lines].join('\n')) }));
    }

    /**
     * The ids of a list of places.
     *
     * @param list - The places
     * @returns Their ids, in order
     */
    function idsOf(list: GeoLocationList): string[] {
      return list.items.map((place: GeoLocation): string => place.id);
    }

    beforeEach((): void => {
      geo = new GeoService(dataSource);
      download = jest
        .fn()
        .mockResolvedValue({ url: 'https://example.test/geotargets.csv.zip', content: zippedCatalog(CATALOG) });
      imports = new GeoImportService(dataSource, jest.fn().mockResolvedValue('job-1'), download);
    });

    it("should import Google's catalog and find its places by name, whatever the accents and case", async (): Promise<void> => {
      await expect(imports.importGoogle({ whenEmpty: true })).resolves.toEqual({
        url: 'https://example.test/geotargets.csv.zip',
        places: CATALOG.length,
        skipped: 0,
        retired: 0,
      });
      await expect(imports.importGoogle({ whenEmpty: true })).resolves.toBeNull();

      const paris: GeoLocationEntity | null = await dataSource
        .getRepository(GeoLocationEntity)
        .findOneBy({ id: '1006094' });
      expect(paris).toMatchObject({
        name: 'Paris',
        searchText: 'paris | paris paris ile de france france',
        parentId: '20321',
        countryCode: 'FR',
        level: 'city',
        status: 'Active',
      });

      // Accents and hyphens ignored; the name starting with the text comes first, then a longer one.
      const etienne: GeoLocationList = await geo.search({ q: 'Saint-Étienne', limit: 20 });
      expect(idsOf(etienne)).toEqual(['1006427', '9050107']);
      expect(etienne.items[0]).toEqual({
        id: '1006427',
        level: 'city',
        name: 'Saint-Etienne',
        canonicalName: 'Saint-Etienne,Auvergne-Rhone-Alpes,France',
        countryCode: 'FR',
        targetType: 'City',
        parentName: 'Auvergne-Rhone-Alpes',
        active: true,
      });

      // The French name of a region whose English name differs: the region, then the places in it.
      expect(idsOf(await geo.search({ q: 'bretagne', limit: 20 }))).toEqual(['20316', '1005876']);
      expect(idsOf(await geo.search({ q: 'rennes bretagne', limit: 20 }))).toEqual(['1005876']);

      // Same name: the larger place first.
      expect(idsOf(await geo.search({ q: 'PARIS', limit: 20 }))).toEqual(['9040871', '1006094']);

      // A prefix, and a typo.
      expect(idsOf(await geo.search({ q: 'lyo', limit: 20 }))).toContain('1006410');
      expect(idsOf(await geo.search({ q: 'marseile 15th arrondisement', limit: 20 }))).toEqual(['9194148']);

      // Postal codes, by their start.
      expect(idsOf(await geo.search({ q: '750', limit: 20 }))).toEqual(['9056126']);
    });

    it('should filter by country and level, and never offer countries, divisions or removed places', async (): Promise<void> => {
      await imports.importGoogle();

      expect(idsOf(await geo.search({ q: 'brussels', limit: 20 }))).toEqual(['20052', '1001004']);
      expect(idsOf(await geo.search({ q: 'brussels', countries: ['BE'], levels: ['region'], limit: 20 }))).toEqual([
        '20052',
      ]);
      expect(idsOf(await geo.search({ q: 'brussels', countries: ['FR'], limit: 20 }))).toEqual([]);
      expect(idsOf(await geo.search({ q: 'paris', levels: ['department'], limit: 20 }))).toEqual(['9040871']);
      expect(idsOf(await geo.search({ q: 'paris', limit: 1 }))).toEqual(['9040871']);

      expect(idsOf(await geo.search({ q: 'france', levels: ['region'], limit: 50 }))).not.toContain('2250');
      expect(idsOf(await geo.search({ q: 'lille', limit: 20 }))).toEqual([]);
      expect(idsOf(await geo.search({ q: 'chalons', limit: 20 }))).toEqual([]);

      // By id: in the order asked, removed places included, countries and divisions absent.
      const byIds: GeoLocationList = await geo.byIds(['1005918', '2250', '9196217', '20316', 'x', '1006094']);
      expect(byIds.items.map((place: GeoLocation) => [place.id, place.active])).toEqual([
        ['1005918', false],
        ['20316', true],
        ['1006094', true],
      ]);
    });

    it('should retire the places a newer catalog drops, and refuse a catalog that looks truncated', async (): Promise<void> => {
      await imports.importGoogle();

      const newer: string[] = CATALOG.filter((line: string): boolean => !line.startsWith('"1006410"')).map(
        (line: string): string => line.replace('"Brittany","Brittany,France"', '"Brittany","Bretagne,France"')
      );
      download.mockResolvedValue({ url: 'https://example.test/next.csv', content: zippedCatalog(newer) });
      await expect(imports.importGoogle()).resolves.toMatchObject({ places: CATALOG.length - 1, retired: 1 });

      const rows: GeoLocationEntity[] = await dataSource
        .getRepository(GeoLocationEntity)
        .findBy([{ id: '1006410' }, { id: '20316' }]);
      expect(rows.map((row: GeoLocationEntity) => [row.id, row.status, row.canonicalName]).sort()).toEqual([
        ['1006410', 'Removal Planned', 'Lyon,Auvergne-Rhone-Alpes,France'],
        ['20316', 'Active', 'Bretagne,France'],
      ]);
      expect(idsOf(await geo.search({ q: 'lyon', levels: ['city'], limit: 20 }))).toEqual([]);

      download.mockResolvedValue({
        url: 'https://example.test/broken.csv',
        content: zippedCatalog(CATALOG.slice(0, 3)),
      });
      await expect(imports.importGoogle()).rejects.toThrow(/looks truncated/);
      expect(await dataSource.getRepository(GeoLocationEntity).countBy({ status: 'Active' })).toBe(CATALOG.length - 2);
    });
  });
});
