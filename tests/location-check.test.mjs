import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedRadius,
  haversineMeters,
  validCoordinates,
} from "../lib/location-check.js";

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
  assert.equal(allowedRadius("Road"), 250);
  assert.equal(allowedRadius("Restaurant"), 180);
  assert.equal(allowedRadius("Neighbourhood"), 1500);
  assert.equal(allowedRadius("City"), 8000);
  assert.equal(allowedRadius("Unknown mapped place"), 300);
});
