/**
 * @module geo/static-map
 *
 * The view of a static map of circles (`POST /geo/map`): the bounding box framing them and the GeoJSON
 * overlay drawing them, within what Amazon Location's `GetStaticMap` accepts (an overlay of 4 200
 * characters at most). Pure functions; a set of circles across the antimeridian gets a box around the
 * whole world. Transcribed from multi-search (`src/geo/static-map.ts`).
 */
import type { GeoMapCircle } from '@src/types/geo.types';

/** Mean radius of the Earth, in kilometres. */
const EARTH_RADIUS_KM = 6371;

/** Kilometres in one degree of latitude. */
const KM_PER_DEGREE: number = (Math.PI * EARTH_RADIUS_KM) / 180;

/** Highest latitude a Web Mercator map shows. */
const MAX_LATITUDE = 85;

/** Longest GeoJSON overlay `GetStaticMap` takes. */
export const MAX_OVERLAY_LENGTH = 4200;

/** Share of the circles' extent added on each side, so that no circle touches the edge. */
const MARGIN = 0.1;

/** Pixels of circumference between two vertices of a circle. */
const PIXELS_PER_VERTEX = 12;

/** Fewest and most vertices of a circle drawn as a polygon. */
const MIN_VERTICES = 6;
const MAX_VERTICES = 64;

/** A circle smaller than this radius, in pixels, is drawn as a dot. */
const MIN_RADIUS_PX = 3;

/** Fill of the circles (blue, 30 % opaque) and colour of the dots. */
const CIRCLE_FILL = '#2563EB4D';
const DOT_COLOR = '#2563EB';

/**
 * What `GetStaticMap` needs to draw circles.
 *
 * @property boundingBox - South-west and north-east corners, `lon,lat,lon,lat`
 * @property overlay - GeoJSON feature collection drawing the circles
 */
export type StaticMapView = { boundingBox: string; overlay: string };

/** A box in degrees. */
type Box = { west: number; south: number; east: number; north: number };

/** How each circle is drawn: a polygon of some vertices, or a dot (0 vertices). */
type Drawing = { circle: GeoMapCircle; radiusPx: number; vertices: number };

/**
 * Keep a number within bounds.
 *
 * @param value - The number
 * @param min - Lowest value
 * @param max - Highest value
 * @returns The number, clamped
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Half the width and half the height of a circle, in degrees.
 *
 * @param circle - The circle
 * @returns Its extent in longitude and latitude
 */
function extentOf(circle: GeoMapCircle): { lon: number; lat: number } {
  const lat: number = circle.radiusKm / KM_PER_DEGREE;
  const cos: number = Math.max(Math.cos((circle.latitude * Math.PI) / 180), 0.01);
  return { lon: lat / cos, lat };
}

/**
 * The box framing circles, with a margin.
 *
 * @param circles - The circles (one at least)
 * @returns The box
 */
function boxOf(circles: GeoMapCircle[]): Box {
  const edges: Box[] = circles.map((circle: GeoMapCircle): Box => {
    const extent: { lon: number; lat: number } = extentOf(circle);
    return {
      west: circle.longitude - extent.lon,
      south: circle.latitude - extent.lat,
      east: circle.longitude + extent.lon,
      north: circle.latitude + extent.lat,
    };
  });
  const west: number = Math.min(...edges.map((edge: Box): number => edge.west));
  const south: number = Math.min(...edges.map((edge: Box): number => edge.south));
  const east: number = Math.max(...edges.map((edge: Box): number => edge.east));
  const north: number = Math.max(...edges.map((edge: Box): number => edge.north));
  const marginLon: number = (east - west) * MARGIN;
  const marginLat: number = (north - south) * MARGIN;
  return {
    west: clamp(west - marginLon, -180, 180),
    south: clamp(south - marginLat, -MAX_LATITUDE, MAX_LATITUDE),
    east: clamp(east + marginLon, -180, 180),
    north: clamp(north + marginLat, -MAX_LATITUDE, MAX_LATITUDE),
  };
}

/**
 * The vertices of a circle, as `[lon, lat]` rounded to some decimals, the first one repeated at the end.
 *
 * @param circle - The circle
 * @param vertices - How many
 * @param decimals - Decimals kept
 * @returns The ring of the polygon
 */
function ringOf(circle: GeoMapCircle, vertices: number, decimals: number): number[][] {
  const extent: { lon: number; lat: number } = extentOf(circle);
  const round = (value: number): number => Number(value.toFixed(decimals));
  const ring: number[][] = Array.from({ length: vertices }, (_: unknown, index: number): number[] => {
    const angle: number = (2 * Math.PI * index) / vertices;
    return [
      round(circle.longitude + extent.lon * Math.sin(angle)),
      round(clamp(circle.latitude + extent.lat * Math.cos(angle), -MAX_LATITUDE, MAX_LATITUDE)),
    ];
  });
  return [...ring, ring[0]];
}

/**
 * The GeoJSON overlay of circles drawn as described.
 *
 * @param drawings - How each circle is drawn
 * @param decimals - Decimals of the coordinates
 * @returns The overlay
 */
function overlayOf(drawings: Drawing[], decimals: number): string {
  const polygons: Drawing[] = drawings.filter((drawing: Drawing): boolean => drawing.vertices > 0);
  const dots: Drawing[] = drawings.filter((drawing: Drawing): boolean => drawing.vertices === 0);
  const features: object[] = [];
  if (polygons.length > 0) {
    features.push({
      type: 'Feature',
      properties: { color: CIRCLE_FILL },
      geometry: {
        type: 'MultiPolygon',
        coordinates: polygons.map((drawing: Drawing): number[][][] => [
          ringOf(drawing.circle, drawing.vertices, decimals),
        ]),
      },
    });
  }
  if (dots.length > 0) {
    features.push({
      type: 'Feature',
      properties: { color: DOT_COLOR },
      geometry: {
        type: 'MultiPoint',
        coordinates: dots.map((drawing: Drawing): number[] => [
          Number(drawing.circle.longitude.toFixed(decimals)),
          Number(drawing.circle.latitude.toFixed(decimals)),
        ]),
      },
    });
  }
  return JSON.stringify({ type: 'FeatureCollection', features });
}

/**
 * The bounding box and the overlay of a static map showing circles. Each circle is a polygon with a vertex every
 * {@link PIXELS_PER_VERTEX} pixels of circumference, coordinates rounded to about a pixel; a circle of less than
 * {@link MIN_RADIUS_PX} pixels is a dot. When the overlay is too long for `GetStaticMap`, circles lose vertices
 * (down to {@link MIN_VERTICES}), then the smallest become dots.
 *
 * @param circles - The circles (one at least)
 * @param width - Width of the image, in pixels
 * @param height - Height of the image, in pixels
 * @returns The view
 * @throws Error when even dots do not fit (cannot happen within the 50 circles a map takes)
 */
export function staticMapView(circles: GeoMapCircle[], width: number, height: number): StaticMapView {
  const box: Box = boxOf(circles);
  const middle: number = ((box.north + box.south) / 2) * (Math.PI / 180);
  const degreesPerPixel: number = Math.max(
    Math.min((box.east - box.west) / width, (box.north - box.south) / height),
    1e-6
  );
  const kmPerPixel: number = Math.max(
    ((box.east - box.west) * KM_PER_DEGREE * Math.cos(middle)) / width,
    ((box.north - box.south) * KM_PER_DEGREE) / height
  );
  const decimals: number = clamp(Math.ceil(-Math.log10(degreesPerPixel)), 1, 6);
  const drawings: Drawing[] = circles.map((circle: GeoMapCircle): Drawing => {
    const radiusPx: number = circle.radiusKm / kmPerPixel;
    const vertices: number =
      radiusPx < MIN_RADIUS_PX
        ? 0
        : clamp(Math.ceil((2 * Math.PI * radiusPx) / PIXELS_PER_VERTEX), MIN_VERTICES, MAX_VERTICES);
    return { circle, radiusPx, vertices };
  });

  let overlay: string = overlayOf(drawings, decimals);
  while (overlay.length > MAX_OVERLAY_LENGTH) {
    const polygons: Drawing[] = drawings.filter((drawing: Drawing): boolean => drawing.vertices > 0);
    if (polygons.length === 0) throw new Error(`${circles.length} circles do not fit in a static map overlay`);
    const reducible: Drawing[] = polygons.filter((drawing: Drawing): boolean => drawing.vertices > MIN_VERTICES);
    if (reducible.length > 0) {
      for (const drawing of reducible) drawing.vertices = Math.max(MIN_VERTICES, Math.floor(drawing.vertices * 0.75));
    } else {
      polygons.reduce((smallest: Drawing, drawing: Drawing): Drawing =>
        drawing.radiusPx < smallest.radiusPx ? drawing : smallest
      ).vertices = 0;
    }
    overlay = overlayOf(drawings, decimals);
  }
  const corner = (value: number): string => value.toFixed(6);
  return {
    boundingBox: [box.west, box.south, box.east, box.north].map(corner).join(','),
    overlay,
  };
}
