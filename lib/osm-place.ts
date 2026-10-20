import "server-only";

import type { Db } from "mongodb";

export type GeoJsonGeometry = {
  type: "Point" | "MultiPoint" | "LineString" | "MultiLineString" | "Polygon" | "MultiPolygon";
  coordinates: unknown;
};

export type CanonicalOsmPlace = {
  placeKey: string;
  osmType: "node" | "way" | "relation";
  osmId: number;
  name: string;
  displayName: string;
  kind: string;
  coordinates: [number, number];
  geojson: GeoJsonGeometry;
  fetchedAt: Date;
  expiresAt: Date;
};

type CacheRecord = CanonicalOsmPlace & { _id?: unknown; notFound?: boolean };
type OSMResult = {
  osm_type?: unknown;
  osm_id?: unknown;
  lat?: unknown;
  lon?: unknown;
  name?: unknown;
  display_name?: unknown;
  addresstype?: unknown;
  type?: unknown;
  class?: unknown;
  geojson?: unknown;
};

export class PlaceLookupError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PlaceLookupError";
    this.status = status;
  }
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_GEOMETRY_BYTES = 512 * 1024;
const LOOKUP_ENDPOINT = "https://nominatim.openstreetmap.org/lookup";

function isValidGeoJson(value: unknown): value is GeoJsonGeometry {
  if (!value || typeof value !== "object") return false;
  const geometry = value as { type?: unknown; coordinates?: unknown };
  return (
    typeof geometry.type === "string" &&
    ["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon"].includes(geometry.type) &&
    Array.isArray(geometry.coordinates)
  );
}

function parsePlaceKey(placeKey: string): { osmType: "node" | "way" | "relation"; osmId: number; lookupId: string } {
  const match = /^(node|way|relation)-([1-9]\d{0,17})$/.exec(placeKey);
  if (!match) {
    throw new PlaceLookupError("Choose a named mapped place to open its community.", 422);
  }

  const osmType = match[1] as "node" | "way" | "relation";
  const osmId = Number(match[2]);
  if (!Number.isSafeInteger(osmId) || osmId <= 0) {
    throw new PlaceLookupError("This map feature has an invalid identifier. Search for the place again.", 422);
  }

  const prefix = osmType === "node" ? "N" : osmType === "way" ? "W" : "R";
  return { osmType, osmId, lookupId: `${prefix}${osmId}` };
}

function pointGeometry(coordinates: [number, number]): GeoJsonGeometry {
  return { type: "Point", coordinates };
}

async function waitForNominatimSlot(db: Db): Promise<void> {
  // A Mongo-backed reservation serializes lookup starts across Vercel function
  // instances. A process-local sleep alone would not enforce the public API's
  // global one-request-per-second guideline in a serverless deployment.
  const now = Date.now();
  const collection = db.collection<{ _id: string; nextAllowedAt: number }>("geocoderRateLimits");
  const previous = await collection.findOneAndUpdate(
    { _id: "nominatim-global" },
    [{
      $set: {
        nextAllowedAt: {
          $add: [
            { $max: [{ $ifNull: ["$nextAllowedAt", now] }, now] },
            1100,
          ],
        },
      },
    }],
    { upsert: true, returnDocument: "before" },
  );

  const reservedStart = previous?.nextAllowedAt ?? now;
  const delay = Math.max(0, reservedStart - now);
  // Avoid consuming most of a short-lived serverless invocation waiting in a
  // queue. The reserved slot is intentionally allowed to go unused in this case.
  if (delay > 4000) {
    throw new PlaceLookupError(
      "Place verification is busy right now. Wait a moment and try again.",
      503,
    );
  }
  if (delay > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }
}

async function lookupOsmFeature(db: Db, lookupId: string): Promise<OSMResult | null> {
  await waitForNominatimSlot(db);

  const url = new URL(LOOKUP_ENDPOINT);
  url.searchParams.set("osm_ids", lookupId);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("polygon_geojson", "1");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Accept-Language": "en",
        "User-Agent": "THE-WORLD-prototype/0.1 (https://github.com/Isaacava/Theworld)",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (response.status === 429) {
      throw new PlaceLookupError(
        "Place verification is temporarily busy. Wait a moment and try again.",
        503,
      );
    }
    if (!response.ok) {
      throw new PlaceLookupError(
        "The map provider couldn't verify this place right now. Please try again.",
        503,
      );
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload) || payload.length === 0) return null;
    return payload[0] as OSMResult;
  } catch (error) {
    if (error instanceof PlaceLookupError) throw error;
    throw new PlaceLookupError(
      "The map provider couldn't verify this place. Check your connection and try again.",
      503,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeOsmResult(
  placeKey: string,
  expected: ReturnType<typeof parsePlaceKey>,
  result: OSMResult,
): CanonicalOsmPlace {
  if (result.osm_type !== expected.osmType || Number(result.osm_id) !== expected.osmId) {
    throw new PlaceLookupError("The map provider returned a different place. Search again and retry.", 422);
  }

  const latitude = Number(result.lat);
  const longitude = Number(result.lon);
  if (
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180
  ) {
    throw new PlaceLookupError("The map provider returned invalid coordinates for this place.", 422);
  }

  const name = typeof result.name === "string" && result.name.trim()
    ? result.name.trim().slice(0, 160)
    : typeof result.display_name === "string"
      ? result.display_name.split(",")[0].trim().slice(0, 160)
      : "Mapped place";
  const displayName = typeof result.display_name === "string"
    ? result.display_name.slice(0, 500)
    : name;
  const rawKind = typeof result.addresstype === "string"
    ? result.addresstype
    : typeof result.type === "string"
      ? result.type
      : typeof result.class === "string"
        ? result.class
        : "place";
  const kind = rawKind.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 80);

  const broadTypes = new Set(["continent", "country", "state", "county", "province", "region"]);
  if (broadTypes.has(rawKind.toLowerCase())) {
    throw new PlaceLookupError(
      "Choose a local street, neighbourhood, venue, or city community rather than a country or region.",
      422,
    );
  }

  let geojson: GeoJsonGeometry | null = isValidGeoJson(result.geojson) ? result.geojson : null;
  if (!geojson && expected.osmType === "node") {
    geojson = pointGeometry([longitude, latitude]);
  }
  if (!geojson) {
    throw new PlaceLookupError(
      "This mapped feature has no usable geometry for a safe local presence check. Try a nearby street or named place.",
      422,
    );
  }

  let geometrySize: number;
  try {
    geometrySize = Buffer.byteLength(JSON.stringify(geojson), "utf8");
  } catch {
    throw new PlaceLookupError("This mapped feature's geometry could not be checked.", 422);
  }
  if (geometrySize > MAX_GEOMETRY_BYTES) {
    throw new PlaceLookupError(
      "This mapped area is too large to verify in the prototype. Choose a nearby street or place.",
      422,
    );
  }

  const now = new Date();
  return {
    placeKey,
    osmType: expected.osmType,
    osmId: expected.osmId,
    name,
    displayName,
    kind,
    coordinates: [longitude, latitude],
    geojson,
    fetchedAt: now,
    expiresAt: new Date(now.getTime() + CACHE_TTL_MS),
  };
}

/**
 * Resolve the browser-selected OSM ID to canonical server-side coordinates and
 * geometry. Cached records prevent a Nominatim lookup on every post. This is
 * a low-volume prototype integration; its process-local throttle is not a
 * substitute for a shared distributed rate limiter in production.
 */
export async function getCanonicalOsmPlace(db: Db, placeKey: string): Promise<CanonicalOsmPlace> {
  const expected = parsePlaceKey(placeKey);
  const collection = db.collection<CacheRecord>("placeVerificationCache");
  const now = new Date();

  const cached = await collection.findOne({
    placeKey,
    expiresAt: { $gt: now },
  });

  if (cached?.notFound) {
    throw new PlaceLookupError("This mapped place could not be found. Search again for a current map result.", 422);
  }
  if (
    cached &&
    cached.osmType === expected.osmType &&
    cached.osmId === expected.osmId &&
    Array.isArray(cached.coordinates) &&
    isValidGeoJson(cached.geojson)
  ) {
    return {
      placeKey: cached.placeKey,
      osmType: cached.osmType,
      osmId: cached.osmId,
      name: cached.name,
      displayName: cached.displayName,
      kind: cached.kind,
      coordinates: cached.coordinates,
      geojson: cached.geojson,
      fetchedAt: cached.fetchedAt,
      expiresAt: cached.expiresAt,
    };
  }

  const result = await lookupOsmFeature(db, expected.lookupId);
  if (!result) {
    await collection.updateOne(
      { placeKey },
      {
        $set: {
          placeKey,
          notFound: true,
          fetchedAt: now,
          expiresAt: new Date(now.getTime() + NEGATIVE_CACHE_TTL_MS),
        },
      },
      { upsert: true },
    );
    throw new PlaceLookupError("This mapped place could not be found. Search again for a current map result.", 422);
  }

  const canonical = normalizeOsmResult(placeKey, expected, result);
  const { _id: _ignored, ...cacheDocument } = canonical as CanonicalOsmPlace & { _id?: unknown };
  await collection.updateOne(
    { placeKey },
    { $set: cacheDocument, $unset: { notFound: "" } },
    { upsert: true },
  );
  return canonical;
}
