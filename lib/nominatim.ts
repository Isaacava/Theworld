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
const memorySearchCache = new Map<string, { results: NominatimPlace[]; expiresAt: number }>();
const memoryReverseCache = new Map<string, { place: NominatimPlace | null; expiresAt: number }>();
let localLastRequestStartedAt = 0;
let localRequestQueue: Promise<void> = Promise.resolve();

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function setBounded<K, V>(cache: Map<K, V>, key: K, value: V, maximum = 250): void {
  cache.set(key, value);
  while (cache.size > maximum) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function reserveGlobalRequestSlot(db: Db | null): Promise<void> {
  const now = Date.now();
  if (!db) {
    const task = localRequestQueue.then(async () => {
      const delay = Math.max(0, 1100 - (Date.now() - localLastRequestStartedAt));
      if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
      localLastRequestStartedAt = Date.now();
    });
    localRequestQueue = task.catch(() => undefined);
    await task;
    return;
  }

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
export async function fetchNominatimJson(db: Db | null, url: URL): Promise<unknown> {
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

export async function searchNominatim(db: Db | null, rawQuery: string): Promise<NominatimPlace[]> {
  const query = rawQuery.trim().replace(/\s+/g, " ");
  if (query.length < 2) return [];
  if (query.length > 160) {
    throw new NominatimError("Place searches must be 160 characters or fewer.", 400);
  }

  const cacheKey = hash(query.toLocaleLowerCase());
  const cache = db?.collection<CachedSearch>("geocoderSearchCache");
  const now = new Date();
  const memoryCached = memorySearchCache.get(cacheKey);
  if (memoryCached && memoryCached.expiresAt > now.getTime()) return memoryCached.results;
  const cached = cache ? await cache.findOne({ cacheKey, expiresAt: { $gt: now } }) : null;
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
  setBounded(memorySearchCache, cacheKey, { results, expiresAt: now.getTime() + CACHE_TTL_MS });
  if (cache) {
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
  }
  return results;
}

export async function reverseNominatim(
  db: Db | null,
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
  const cache = db?.collection<CachedReverse>("geocoderReverseCache");
  const now = new Date();
  const memoryCached = memoryReverseCache.get(cacheKey);
  if (memoryCached && memoryCached.expiresAt > now.getTime()) return memoryCached.place;
  const cached = cache ? await cache.findOne({ cacheKey, expiresAt: { $gt: now } }) : null;
  if (cached) return cached.place;

  const url = new URL("/reverse", ENDPOINT);
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "18");
  url.searchParams.set("accept-language", "en");

  const payload = await fetchNominatimJson(db, url);
  const place = normalizeResult(payload);
  setBounded(memoryReverseCache, cacheKey, { place, expiresAt: now.getTime() + CACHE_TTL_MS });
  if (cache) {
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
  }
  return place;
}
