import { haversineMeters } from "./location-check.js";

const EARTH_METERS_PER_DEGREE = 111320;
const toRadians = (degrees) => (degrees * Math.PI) / 180;

/**
 * Approximate point-to-segment distance in a local equirectangular projection.
 * Good for short local distances used by this prototype's presence check.
 * @param {[number, number]} point
 * @param {[number, number]} start
 * @param {[number, number]} end
 * @returns {number}
 */
function pointToSegmentMeters(point, start, end) {
  const [longitude, latitude] = point;
  const latitudeScale = EARTH_METERS_PER_DEGREE;
  const longitudeScale = EARTH_METERS_PER_DEGREE * Math.cos(toRadians(latitude));
  const project = ([lon, lat]) => [
    (lon - longitude) * longitudeScale,
    (lat - latitude) * latitudeScale,
  ];
  const [ax, ay] = project(start);
  const [bx, by] = project(end);
  const dx = bx - ax;
  const dy = by - ay;
  const denominator = dx * dx + dy * dy;
  const t = denominator === 0
    ? 0
    : Math.max(0, Math.min(1, (-(ax * dx + ay * dy)) / denominator));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/**
 * @param {[number, number]} point
 * @param {Array<[number, number]>} ring
 * @returns {boolean}
 */
function pointInRing(point, ring) {
  if (ring.length < 3) return false;
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * @param {[number, number]} point
 * @param {Array<[number, number]>} line
 * @returns {number}
 */
function lineDistance(point, line) {
  if (!Array.isArray(line) || line.length === 0) return Number.POSITIVE_INFINITY;
  if (line.length === 1) return haversineMeters(point, line[0]);
  let minimum = Number.POSITIVE_INFINITY;
  for (let i = 0; i < line.length - 1; i += 1) {
    minimum = Math.min(minimum, pointToSegmentMeters(point, line[i], line[i + 1]));
  }
  return minimum;
}

/**
 * Measure distance from a [longitude, latitude] point to a GeoJSON geometry.
 * Points, lines, multilines, polygons, and multipolygons are supported.
 * Polygon interiors count as zero distance; polygon holes are respected.
 *
 * @param {[number, number]} point
 * @param {{type: string, coordinates: any}} geojson
 * @returns {number}
 */
export function distanceToGeoJsonMeters(point, geojson) {
  if (!geojson || typeof geojson.type !== "string" || !Array.isArray(geojson.coordinates)) {
    return Number.POSITIVE_INFINITY;
  }

  const coords = geojson.coordinates;
  switch (geojson.type) {
    case "Point":
      return coords.length >= 2 ? haversineMeters(point, coords) : Number.POSITIVE_INFINITY;

    case "MultiPoint":
      return coords.reduce((minimum, coordinate) =>
        Math.min(minimum, haversineMeters(point, coordinate)), Number.POSITIVE_INFINITY);

    case "LineString":
      return lineDistance(point, coords);

    case "MultiLineString":
      return coords.reduce((minimum, line) =>
        Math.min(minimum, lineDistance(point, line)), Number.POSITIVE_INFINITY);

    case "Polygon": {
      if (!Array.isArray(coords) || coords.length === 0) return Number.POSITIVE_INFINITY;
      const insideOuter = pointInRing(point, coords[0]);
      const insideHole = coords.slice(1).some((ring) => pointInRing(point, ring));
      if (insideOuter && !insideHole) return 0;
      return coords.reduce((minimum, ring) =>
        Math.min(minimum, lineDistance(point, ring)), Number.POSITIVE_INFINITY);
    }

    case "MultiPolygon":
      return coords.reduce((minimum, polygon) =>
        Math.min(minimum, distanceToGeoJsonMeters(point, { type: "Polygon", coordinates: polygon })),
      Number.POSITIVE_INFINITY);

    default:
      return Number.POSITIVE_INFINITY;
  }
}
