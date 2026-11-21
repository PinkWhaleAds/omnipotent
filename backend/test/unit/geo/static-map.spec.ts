import { MAX_OVERLAY_LENGTH, staticMapView, StaticMapView } from '@src/geo/static-map';
import type { GeoMapCircle } from '@src/types/geo.types';

/** A GeoJSON feature of the overlay. */
type Feature = {
  type: 'Feature';
  properties: { color: string };
  geometry: { type: 'MultiPolygon' | 'MultiPoint'; coordinates: unknown[] };
};

/**
 * The features of an overlay.
 *
 * @param view - The view
 * @returns Its features
 */
function featuresOf(view: StaticMapView): Feature[] {
  const collection: { type: string; features: Feature[] } = JSON.parse(view.overlay);
  expect(collection.type).toBe('FeatureCollection');
  return collection.features;
}

/**
 * The corners of a view, as numbers.
 *
 * @param view - The view
 * @returns West, south, east and north
 */
function cornersOf(view: StaticMapView): number[] {
  return view.boundingBox.split(',').map(Number);
}

describe('Unit::Geo::StaticMap', () => {
  const PARIS: GeoMapCircle = { latitude: 48.8566, longitude: 2.3522, radiusKm: 10 };

  it('should frame one circle with a margin and draw it as a closed polygon', (): void => {
    const view: StaticMapView = staticMapView([PARIS], 640, 400);

    const [west, south, east, north] = cornersOf(view);
    // 10 km is 0.09° of latitude; the margin adds a tenth of the extent on each side.
    expect(north - south).toBeCloseTo(0.18 * 1.2, 2);
    expect(south).toBeLessThan(48.7667);
    expect(north).toBeGreaterThan(48.9465);
    expect(west).toBeLessThan(2.2155);
    expect(east).toBeGreaterThan(2.4889);
    expect(view.boundingBox).toMatch(/^-?\d{1,3}\.\d{6},-?\d{1,2}\.\d{6},-?\d{1,3}\.\d{6},-?\d{1,2}\.\d{6}$/);

    const [feature] = featuresOf(view);
    expect(feature.properties.color).toBe('#2563EB4D');
    expect(feature.geometry.type).toBe('MultiPolygon');
    const ring: number[][] = (feature.geometry.coordinates as number[][][][])[0][0];
    expect(ring.length).toBe(65);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring[0][1]).toBeCloseTo(48.8566 + 0.0899, 3);
    expect(view.overlay.length).toBeLessThanOrEqual(MAX_OVERLAY_LENGTH);
  });

  it('should draw the circles too small to see as dots', (): void => {
    const view: StaticMapView = staticMapView(
      [
        { latitude: 43.2965, longitude: 5.3698, radiusKm: 1 },
        { latitude: 50.6292, longitude: 3.0573, radiusKm: 200 },
      ],
      640,
      400
    );

    const features: Feature[] = featuresOf(view);
    expect(features.map((feature: Feature): string => feature.geometry.type)).toEqual(['MultiPolygon', 'MultiPoint']);
    expect(features[1]).toEqual({
      type: 'Feature',
      properties: { color: '#2563EB' },
      geometry: { type: 'MultiPoint', coordinates: [[5.37, 43.3]] },
    });
  });

  it('should keep the map within the latitudes and longitudes a map shows', (): void => {
    const view: StaticMapView = staticMapView(
      [
        { latitude: 84, longitude: 179, radiusKm: 800 },
        { latitude: -84, longitude: -179, radiusKm: 800 },
      ],
      1400,
      1400
    );

    expect(cornersOf(view)).toEqual([-180, -85, 180, 85]);
    expect(view.overlay.length).toBeLessThanOrEqual(MAX_OVERLAY_LENGTH);
  });

  it('should take fewer vertices, then dots, so that 50 circles fit in the overlay', (): void => {
    const circles: GeoMapCircle[] = Array.from({ length: 50 }, (_: unknown, index: number): GeoMapCircle => ({
      latitude: 42 + (index % 10) * 0.7,
      longitude: -4 + Math.floor(index / 10) * 2.2 + (index % 3) * 0.3,
      radiusKm: 20 + ((index * 37) % 50) * 3,
    }));

    const view: StaticMapView = staticMapView(circles, 1400, 1400);

    expect(view.overlay.length).toBeLessThanOrEqual(MAX_OVERLAY_LENGTH);
    const features: Feature[] = featuresOf(view);
    const polygons: number[][][][] = features[0].geometry.coordinates as number[][][][];
    const dots: number[][] = (features[1]?.geometry.coordinates ?? []) as number[][];
    expect(polygons.length + dots.length).toBe(50);
    expect(Math.max(...polygons.map((polygon: number[][][]): number => polygon[0].length))).toBeLessThanOrEqual(7);
  });

  it('should fail when even dots do not fit', (): void => {
    const circles: GeoMapCircle[] = Array.from({ length: 400 }, (_: unknown, index: number): GeoMapCircle => ({
      latitude: -60 + index * 0.3,
      longitude: -170 + index * 0.85,
      radiusKm: 1,
    }));

    expect(() => staticMapView(circles, 64, 64)).toThrow('400 circles do not fit in a static map overlay');
  });
});
