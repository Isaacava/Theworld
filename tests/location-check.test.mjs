import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedRadius,
  haversineMeters,
  validCoordinates,
} from "../lib/location-check.js";
import { distanceToGeoJsonMeters } from "../lib/place-geometry.mjs";

test("coordinate validation accepts valid geographic boundaries", () => {
  assert.equal(validCoordinates(0, 0), true);
  assert.equal(validCoordinates(180, 90), true);
  assert.equal(validCoordinates(-180, -90), true);
});

test("coordinate validation rejects out-of-range and non-numeric values", () => {
  assert.equal(validCoordinates(181, 0), false);
  assert.equal(validCoordinates(0, -91), false);
  assert.equal(validCoordinates("3.3", 6.5), false);
  assert.equal(validCoordinates(Number.NaN, 0), false);
});

test("distance from a point to itself is approximately zero", () => {
  assert.equal(haversineMeters([3.3792, 6.5244], [3.3792, 6.5244]), 0);
});

test("one degree of longitude at the equator is about 111.2 km", () => {
  const distance = haversineMeters([0, 0], [1, 0]);
  assert.ok(distance > 111000 && distance < 111400, `unexpected distance: ${distance}`);
});

test("proximity radii use a conservative default and broader area sizes", () => {
  assert.equal(allowedRadius("Road"), 100);
  assert.equal(allowedRadius("Restaurant"), 100);
  assert.equal(allowedRadius("Neighbourhood"), 1000);
  assert.equal(allowedRadius("City"), 5000);
  assert.equal(allowedRadius("Unknown mapped place"), 180);
});

test("presence distance to a mapped point uses canonical point geometry", () => {
  assert.equal(
    distanceToGeoJsonMeters([3, 6], { type: "Point", coordinates: [3, 6] }),
    0,
  );
  const distance = distanceToGeoJsonMeters(
    [3, 6],
    { type: "Point", coordinates: [3.001, 6] },
  );
  assert.ok(distance > 100 && distance < 120, `unexpected point distance: ${distance}`);
});

test("presence distance to a street line measures distance to the line, not its centre", () => {
  const street = {
    type: "LineString",
    coordinates: [[0, 0], [1, 0]],
  };
  assert.equal(distanceToGeoJsonMeters([0.5, 0], street), 0);

  const nearby = distanceToGeoJsonMeters([0.5, 0.001], street);
  assert.ok(nearby > 110 && nearby < 112, `unexpected street distance: ${nearby}`);
});

test("presence distance treats the interior of a mapped polygon as inside", () => {
  const park = {
    type: "Polygon",
    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
  };
  assert.equal(distanceToGeoJsonMeters([0.5, 0.5], park), 0);
  assert.ok(distanceToGeoJsonMeters([2, 0.5], park) > 100000);
});

test("presence distance respects polygon holes", () => {
  const siteWithRestrictedHole = {
    type: "Polygon",
    coordinates: [
      [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
      [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6], [0.4, 0.4]],
    ],
  };
  assert.ok(distanceToGeoJsonMeters([0.5, 0.5], siteWithRestrictedHole) > 10000);
});

test("unknown geometry returns infinity instead of approving a presence check", () => {
  assert.equal(
    distanceToGeoJsonMeters([0, 0], { type: "GeometryCollection", coordinates: [] }),
    Number.POSITIVE_INFINITY,
  );
});
