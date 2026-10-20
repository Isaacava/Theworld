import "server-only";

import { createHash } from "node:crypto";
import type { Db } from "mongodb";

export class NominatimError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "NominatimError";
    this.status = status;
  }
}

export type NominatimPlace = {
  place_id: number;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  type?: string;
  category?: string;
  addresstype?: string;
  address?: Record<string, string>;
};

type CachedSearch = {
  cacheKey: string;
  results: NominatimPlace[];
  fetchedAt: Date;
  expiresAt: Date;
};

type CachedReverse = {
  cacheKey: string;
  place: NominatimPlace | null;
  fetchedAt: Date;
  expiresAt: Date;
};

const ENDPOINT = "https://nominatim.openstreetmap.org";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_LOOKUP_WAIT_MS = 4000;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function reserveGlobalRequestSlot(db: Db): Promise<void> {
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

  const delay = Math.max(0, (previous?.nextAllowedAt ?? now) - now);
  if (delay > MAX_LOOKUP_WAIT_MS) {
    throw new NominatimError("Place search is busy right now. Wait a moment and try again.", 503);
  }
  if (delay > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }
}

/**
 * All public Nominatim requests pass through one Mongo-backed request slot.
 * A local process timer cannot enforce the global per-application limit when
 * requests run in separate serverless instances.
 */
export async function fetchNominatimJson(db: Db, url: URL): Promise<unknown> {
  await reserveGlobalRequestSlot(db);

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
      throw new NominatimError("Place search is temporarily rate-limited. Wait a moment and try again.", 503);
    }
    if (!response.ok) {
      throw new NominatimError("The map search service is temporarily unavailable. Please try again.", 503);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof NominatimError) throw error;
    throw new NominatimError("The map search service could not be reached. Please try again.", 503);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeResult(value: unknown): NominatimPlace | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const placeId = Number(record.place_id);
  const osmId = Number(record.osm_id);
  const latitude = Number(record.lat);
  const longitude = Number(record.lon);

  if (
    !Number.isSafeInteger(placeId) || placeId <= 0 ||
    !["node", "way", "relation"].includes(String(record.osm_type)) ||
    !Number.isSafeInteger(osmId) || osmId <= 0 ||
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
    typeof record.display_name !== "string"
  ) {
    return null;
  }

  const address = record.address && typeof record.address === "object"
    ? Object.fromEntries(
        Object.entries(record.address as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string")
          .slice(0, 80),
      )
    : undefined;

  return {
    place_id: placeId,
    osm_type: String(record.osm_type),
    osm_id: osmId,
    lat: String(latitude),
    lon: String(longitude),
    display_name: record.display_name.slice(0, 500),
    ...(typeof record.name === "string" ? { name: record.name.slice(0, 160) } : {}),
    ...(typeof record.type === "string" ? { type: record.type.slice(0, 80) } : {}),
    ...(typeof record.class === "string" ? { category: record.class.slice(0, 80) } : {}),
    ...(typeof record.addresstype === "string" ? { addresstype: record.addresstype.slice(0, 80) } : {}),
    ...(address ? { address } : {}),
  };
}

export async function searchNominatim(db: Db, rawQuery: string): Promise<NominatimPlace[]> {
  const query = rawQuery.trim().replace(/\s+/g, " ");
  if (query.length < 2) return [];
  if (query.length > 160) {
    throw new NominatimError("Place searches must be 160 characters or fewer.", 400);
  }

  const cacheKey = hash(query.toLocaleLowerCase());
  const cache = db.collection<CachedSearch>("geocoderSearchCache");
  const now = new Date();
  const cached = await cache.findOne({ cacheKey, expiresAt: { $gt: now } });
  if (cached && Array.isArray(cached.results)) return cached.results;

  const url = new URL("/search", ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "6");
  url.searchParams.set("accept-language", "en");

  const payload = await fetchNominatimJson(db, url);
  if (!Array.isArray(payload)) {
    throw new NominatimError("The map search returned an unexpected response.", 503);
  }
  const results = payload.map(normalizeResult).filter((item): item is NominatimPlace => item !== null);
  await cache.updateOne(
    { cacheKey },
    {
      $set: {
        cacheKey,
        results,
        fetchedAt: now,
        expiresAt: new Date(now.getTime() + CACHE_TTL_MS),
      },
    },
    { upsert: true },
  );
  return results;
}

export async function reverseNominatim(
  db: Db,
  latitude: number,
  longitude: number,
): Promise<NominatimPlace | null> {
  if (
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180
  ) {
    throw new NominatimError("That map position is not valid.", 400);
  }

  // Hash rounded coordinates to avoid storing map-tap coordinates as cache keys.
  const coordinateKey = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  const cacheKey = hash(coordinateKey);
  const cache = db.collection<CachedReverse>("geocoderReverseCache");
  const now = new Date();
  const cached = await cache.findOne({ cacheKey, expiresAt: { $gt: now } });
  if (cached) return cached.place;

  const url = new URL("/reverse", ENDPOINT);
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "18");
  url.searchParams.set("accept-language", "en");

  const payload = await requestJson(db, url);
  const place = normalizeResult(payload);
  await cache.updateOne(
    { cacheKey },
    {
      $set: {
        cacheKey,
        place,
        fetchedAt: now,
        expiresAt: new Date(now.getTime() + CACHE_TTL_MS),
      },
    },
    { upsert: true },
  );
  return place;
}
