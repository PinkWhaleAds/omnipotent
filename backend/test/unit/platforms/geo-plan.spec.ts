import { geoNameOf, GeoPlan, GeoRules, outsideCountries, planGeo, PLANNED_DIMENSIONS } from '@src/platforms/geo-plan';
import { GeoPlace, Targeting } from '@src/types';

/** What Google targets: every level, both ways, and 500 circles (`platform-rules.ts`). */
const GOOGLE: GeoRules = {
  levels: ['region', 'department', 'city', 'postal_code'],
  excludedLevels: ['region', 'department', 'city', 'postal_code'],
  maxRadii: 500,
};

/** A platform that targets regions only, excludes nothing, and takes no circle. */
const REGIONS_ONLY: GeoRules = { levels: ['region'], excludedLevels: [], maxRadii: null };

/** Places of the referential, as the targeting service fills them. */
const PARIS: GeoPlace = {
  id: '1006094',
  level: 'city',
  name: 'Paris',
  canonicalName: 'Paris,Paris,Ile-de-France,France',
  countryCode: 'FR',
};
const BRITTANY: GeoPlace = {
  id: '20316',
  level: 'region',
  name: 'Brittany',
  canonicalName: 'Brittany,France',
  countryCode: 'FR',
};
const PARIS_1ST: GeoPlace = { ...PARIS, id: '9056126', level: 'postal_code', name: '75001' };
const BRUSSELS: GeoPlace = { ...PARIS, id: '1001004', name: 'Brussels', countryCode: 'BE' };

/** A circle around the Louvre. */
const LOUVRE = { latitude: 48.8606, longitude: 2.3376, radiusKm: 2, countryCode: 'FR', label: 'Louvre' };

/** An empty plan, for the cases that change a part of it. */
const NOTHING: GeoPlan = {
  countries: [],
  excludedCountries: [],
  places: [],
  excludedPlaces: [],
  radii: [],
  widened: [],
  ignoredExclusions: [],
  tooManyRadii: null,
  outside: { places: [], radii: [] },
};

describe('Unit::Platforms::GeoPlan', () => {
  it('should judge the places and the circles, and leave the other dimensions to the registry', (): void => {
    expect(PLANNED_DIMENSIONS).toEqual(['location', 'proximity']);
  });

  describe('planGeo', () => {
    it('should target nothing for a node that restricts nothing', (): void => {
      expect(planGeo(null, GOOGLE)).toEqual(NOTHING);
      expect(planGeo({ device: { include: ['mobile'], exclude: [] } }, GOOGLE)).toEqual(NOTHING);
    });

    it('should serve whole the countries with no place nor circle, and exclude countries once', (): void => {
      const targeting: Targeting = { country: { include: ['FR', 'BE', 'FR'], exclude: ['MC', 'MC'] } };

      expect(planGeo(targeting, GOOGLE)).toEqual({ ...NOTHING, countries: ['FR', 'BE'], excludedCountries: ['MC'] });
    });

    it('should replace a country by its places and circles, and keep the others whole', (): void => {
      const targeting: Targeting = {
        country: { include: ['FR', 'BE'], exclude: [] },
        location: { include: [PARIS, BRITTANY], exclude: [PARIS_1ST] },
        proximity: { points: [LOUVRE] },
      };

      expect(planGeo(targeting, GOOGLE)).toEqual({
        ...NOTHING,
        countries: ['BE'],
        places: [PARIS, BRITTANY],
        excludedPlaces: [PARIS_1ST],
        radii: [LOUVRE],
      });
    });

    it('should serve a country whole where the platform cannot target one of its places or circles, and say why', (): void => {
      const city: Targeting = {
        country: { include: ['FR'], exclude: [] },
        location: { include: [PARIS, BRITTANY], exclude: [] },
      };
      const circle: Targeting = { country: { include: ['FR'], exclude: [] }, proximity: { points: [LOUVRE] } };
      const both: Targeting = { ...city, proximity: { points: [LOUVRE] } };

      // Never Brittany alone: that would be narrower than Paris and Brittany.
      expect(planGeo(city, REGIONS_ONLY)).toEqual({
        ...NOTHING,
        countries: ['FR'],
        widened: [{ country: 'FR', reasons: ['level'] }],
      });
      expect(planGeo(circle, REGIONS_ONLY).widened).toEqual([{ country: 'FR', reasons: ['radius'] }]);
      expect(planGeo(both, REGIONS_ONLY).widened).toEqual([{ country: 'FR', reasons: ['level', 'radius'] }]);
    });

    it('should exclude a place where the platform excludes its level, and say it ignores it elsewhere', (): void => {
      const targeting: Targeting = {
        country: { include: ['FR'], exclude: [] },
        location: { include: [BRITTANY], exclude: [PARIS_1ST] },
      };

      expect(planGeo(targeting, GOOGLE).excludedPlaces).toEqual([PARIS_1ST]);
      expect(planGeo(targeting, REGIONS_ONLY)).toMatchObject({
        places: [BRITTANY],
        excludedPlaces: [],
        ignoredExclusions: [PARIS_1ST],
      });
    });

    it('should say when more circles are sent than the platform takes', (): void => {
      const targeting: Targeting = {
        country: { include: ['FR'], exclude: [] },
        proximity: { points: [LOUVRE, { ...LOUVRE, label: 'Orsay' }] },
      };

      expect(planGeo(targeting, { ...GOOGLE, maxRadii: 1 }).tooManyRadii).toEqual({ count: 2, max: 1 });
      expect(planGeo(targeting, GOOGLE).tooManyRadii).toBeNull();
    });

    it('should leave out the places and circles outside the countries, and report them', (): void => {
      const targeting: Targeting = {
        country: { include: ['FR'], exclude: [] },
        location: { include: [PARIS, BRUSSELS], exclude: [{ ...BRUSSELS, id: '20052' }] },
      };

      const plan: GeoPlan = planGeo(targeting, GOOGLE);

      expect(plan).toMatchObject({ places: [PARIS], excludedPlaces: [], ignoredExclusions: [] });
      expect(plan.outside.places.map((place: GeoPlace): string => place.id)).toEqual(['1001004', '20052']);
    });
  });

  describe('outsideCountries', () => {
    it('should find nothing outside for a node without places nor circles', (): void => {
      expect(outsideCountries(null)).toEqual({ places: [], radii: [] });
    });

    it('should find a place of a country not included, or excluded, and one without a country', (): void => {
      const noCountry: GeoPlace = { id: '1' };
      const targeting: Targeting = {
        country: { include: ['FR'], exclude: ['BE'] },
        location: { include: [PARIS, BRUSSELS, noCountry], exclude: [] },
      };

      expect(outsideCountries(targeting).places).toEqual([BRUSSELS, noCountry]);
    });

    it('should find every place and circle outside when no country is included', (): void => {
      const legacy = { latitude: 48.8566, longitude: 2.3522, radiusKm: 20 };
      const targeting: Targeting = {
        location: { include: [PARIS], exclude: [] },
        proximity: { points: [LOUVRE, legacy] },
      };

      expect(outsideCountries(targeting)).toEqual({ places: [PARIS], radii: [LOUVRE, legacy] });
    });

    it('should find a circle written before D57, which has no country', (): void => {
      const legacy = { latitude: 48.8566, longitude: 2.3522, radiusKm: 20, label: 'Paris' };
      const targeting: Targeting = {
        country: { include: ['FR'], exclude: [] },
        proximity: { points: [LOUVRE, legacy] },
      };

      expect(outsideCountries(targeting).radii).toEqual([legacy]);
    });
  });

  describe('geoNameOf', () => {
    it('should name a place by its name, or its id', (): void => {
      expect(geoNameOf(PARIS)).toBe('Paris');
      expect(geoNameOf({ id: '1006094' })).toBe('1006094');
    });

    it('should name a circle by its label, its address, or where it is', (): void => {
      expect(geoNameOf(LOUVRE)).toBe('Louvre');
      expect(geoNameOf({ latitude: 1, longitude: 2, radiusKm: 3, address: '1 rue de Rivoli' })).toBe('1 rue de Rivoli');
      expect(geoNameOf({ latitude: 48.86, longitude: 2.33, radiusKm: 3 })).toBe('48.86, 2.33');
    });
  });
});
