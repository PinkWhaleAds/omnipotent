import { FastifyInstance } from 'fastify';
import { In } from 'typeorm';

import { GeoLocationEntity } from '@src/database/entities';
import GeoServicePlugin, { GeoService } from '@src/services/geo.service';
import { GeoLocationList } from '@src/types';
import { buildServiceApp, createAccessMock } from '@test/unit/mocks/access.mock';
import { createDataSourceMock, DataSourceMock } from '@test/unit/mocks/data-source.mock';
import { closeTestApp } from '@test/utils/fastify-test-app.utils';

/** A place as the search SQL selects it. */
const PARIS_ROW = {
  id: '1006094',
  level: 'city',
  name: 'Paris',
  canonicalName: 'Paris,Paris,Ile-de-France,France',
  countryCode: 'FR',
  targetType: 'City',
  status: 'Active',
  parentName: 'Paris',
};

describe('Unit::Services::GeoService', () => {
  let db: DataSourceMock;
  let service: GeoService;

  beforeEach((): void => {
    db = createDataSourceMock();
    service = new GeoService(db.dataSource);
  });

  describe('search', () => {
    it('should search the normalized text, ranked, in the four levels of every country by default', async (): Promise<void> => {
      db.mocks.query.mockResolvedValue([PARIS_ROW, { ...PARIS_ROW, id: '9056126', parentName: null }]);

      await expect(service.search({ q: '  Saint-Étienne ', limit: 20 })).resolves.toEqual<GeoLocationList>({
        items: [
          {
            id: '1006094',
            level: 'city',
            name: 'Paris',
            canonicalName: 'Paris,Paris,Ile-de-France,France',
            countryCode: 'FR',
            targetType: 'City',
            parentName: 'Paris',
            active: true,
          },
          {
            id: '9056126',
            level: 'city',
            name: 'Paris',
            canonicalName: 'Paris,Paris,Ile-de-France,France',
            countryCode: 'FR',
            targetType: 'City',
            parentName: null,
            active: true,
          },
        ],
      });

      const [sql, parameters] = db.mocks.query.mock.calls[0];
      expect(sql).toContain('FROM "geo_locations" g');
      expect(sql).toContain(`g."status" = 'Active'`);
      expect(sql).toContain('$1 <% g."search_text"');
      expect(sql).toContain(`ORDER BY (split_part(g."search_text", ' | ', 1) = $1) DESC`);
      expect(sql).toContain('((g."search_text" LIKE $7 AND g."search_text" LIKE $8) OR $1 <% g."search_text")');
      expect(parameters).toEqual([
        'saint etienne',
        'saint etienne%',
        '% saint etienne%',
        ['region', 'department', 'city', 'postal_code'],
        null,
        20,
        '%saint%',
        '%etienne%',
      ]);
    });

    it('should narrow the search to the countries and levels asked', async (): Promise<void> => {
      await expect(
        service.search({ q: '75', countries: ['FR', 'BE'], levels: ['postal_code'], limit: 5 })
      ).resolves.toEqual({ items: [] });

      expect(db.mocks.query.mock.calls[0][1]).toEqual(['75', '75%', '% 75%', ['postal_code'], ['FR', 'BE'], 5, '%75%']);
      expect(db.mocks.query.mock.calls[0][0]).toContain('((g."search_text" LIKE $7) OR $1 <% g."search_text")');
    });

    it('should match 8 distinct words one by one at most', async (): Promise<void> => {
      await service.search({ q: 'a b a c d e f g h i j', limit: 20 });

      const [sql, parameters] = db.mocks.query.mock.calls[0];
      expect(parameters.slice(6)).toEqual(['%a%', '%b%', '%c%', '%d%', '%e%', '%f%', '%g%', '%h%']);
      expect(sql).toContain('g."search_text" LIKE $14) OR');
      expect(sql).not.toContain('$15');
    });

    it('should answer 400 for a text of fewer than 2 letters or digits', async (): Promise<void> => {
      await expect(service.search({ q: '-é-', limit: 20 })).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'geo_search_too_short',
        errorParams: { min: 2 },
      });
      expect(db.mocks.query).not.toHaveBeenCalled();
    });
  });

  describe('byIds', () => {
    it('should read the places of the offered levels, in the order of the ids, whatever their status', async (): Promise<void> => {
      db.mocks.query.mockResolvedValue([{ ...PARIS_ROW, status: 'Removal Planned', parentName: undefined }]);

      await expect(service.byIds(['1006094', '2250', '1006094'])).resolves.toEqual({
        items: [expect.objectContaining({ id: '1006094', active: false, parentName: null })],
      });

      const [sql, parameters] = db.mocks.query.mock.calls[0];
      expect(sql).toContain('ORDER BY array_position($1::varchar[], g."id")');
      expect(parameters).toEqual([
        ['1006094', '2250'],
        ['region', 'department', 'city', 'postal_code'],
      ]);
    });

    it('should read nothing without id', async (): Promise<void> => {
      await expect(service.byIds([])).resolves.toEqual({ items: [] });
      expect(db.mocks.query).not.toHaveBeenCalled();
    });
  });

  describe('findByIds', () => {
    it('should give the places found, by id', async (): Promise<void> => {
      const paris = { id: '1006094', name: 'Paris' } as GeoLocationEntity;
      db.repository(GeoLocationEntity).findBy.mockResolvedValue([paris]);

      await expect(service.findByIds(['1006094', '1006094', '42'])).resolves.toEqual(new Map([['1006094', paris]]));
      expect(db.repository(GeoLocationEntity).findBy).toHaveBeenCalledWith({ id: In(['1006094', '42']) });
    });

    it('should read nothing without id', async (): Promise<void> => {
      await expect(service.findByIds([])).resolves.toEqual(new Map());
      expect(db.repository(GeoLocationEntity).findBy).not.toHaveBeenCalled();
    });
  });

  describe('plugin', () => {
    let app: FastifyInstance;

    afterEach(async (): Promise<void> => {
      await closeTestApp(app);
    });

    it('should decorate the instance with the service on the database', async (): Promise<void> => {
      app = await buildServiceApp([GeoServicePlugin], { db, access: createAccessMock() });

      expect(app.geoService).toBeInstanceOf(GeoService);
    });
  });
});
