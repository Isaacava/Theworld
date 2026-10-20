"use client";

export type PlaceSearchResult = {
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

const SEARCH_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const REVERSE_ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const resultCache = new Map<string, PlaceSearchResult[]>();
const reverseCache = new Map<string, PlaceSearchResult | null>();
let lastRequestStartedAt = 0;
let requestQueue: Promise<void> = Promise.resolve();

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function fetchNominatim(url: URL): Promise<unknown> {
  const task = requestQueue.then(async () => {
    const delay = Math.max(0, 1100 - (Date.now() - lastRequestStartedAt));
    if (delay > 0) await wait(delay);
    lastRequestStartedAt = Date.now();
  });
  requestQueue = task.catch(() => undefined);
  await task;

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { "Accept-Language": "en" },
    cache: "no-store",
    referrerPolicy: "strict-origin-when-cross-origin",
  });
  if (response.status === 429) {
    throw new Error("Place search is temporarily busy. Please wait a moment before trying again.");
  }
  if (!response.ok) {
    throw new Error("We couldn't look up this place right now. Please try again.");
  }
  return response.json() as Promise<unknown>;
}

/**
 * Prototype-only place search using the public Nominatim service.
 *
 * Requests are submitted only after the user submits the search form (not on
 * each keystroke), cached in memory for this browser session, and spaced out
 * by at least 1.1 seconds in this JavaScript runtime. That is suitable only
 * for early testing with a small number of people. A public launch needs a
 * shared rate limit and cache, or a geocoding provider designed for production.
 */
export async function searchPlaces(
  rawQuery: string,
): Promise<PlaceSearchResult[]> {
  const query = rawQuery.trim().replace(/\s+/g, " ");
  if (query.length < 2) {
    return [];
  }

  const cacheKey = query.toLocaleLowerCase();
  const cached = resultCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "6");
  url.searchParams.set("accept-language", "en");

  const payload: unknown = await fetchNominatim(url);
  if (!Array.isArray(payload)) {
    throw new Error("The place search returned an unexpected response.");
  }

  const results = (payload as PlaceSearchResult[]).filter(
    (item) =>
      item &&
      typeof item.display_name === "string" &&
      Number.isFinite(Number(item.lat)) &&
      Number.isFinite(Number(item.lon)),
  );

  resultCache.set(cacheKey, results);
  return results;
}


/**
 * Reverse geocode a map tap into a nearby named feature. Results are cached
 * by rounded coordinates. This is a low-volume prototype integration only.
 */
export async function reversePlace(latitude: number, longitude: number): Promise<PlaceSearchResult | null> {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error("That map position is not valid.");
  }

  const cacheKey = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  if (reverseCache.has(cacheKey)) return reverseCache.get(cacheKey) ?? null;

  const url = new URL(REVERSE_ENDPOINT);
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "18");
  url.searchParams.set("accept-language", "en");

  const payload = await fetchNominatim(url);
  if (!payload || typeof payload !== "object" ||
      !("display_name" in payload) ||
      typeof (payload as { display_name?: unknown }).display_name !== "string") {
    reverseCache.set(cacheKey, null);
    return null;
  }

  const item = payload as PlaceSearchResult;
  if (typeof item.lat !== "string" || typeof item.lon !== "string" ||
      !Number.isFinite(Number(item.lat)) || !Number.isFinite(Number(item.lon))) {
    reverseCache.set(cacheKey, null);
    return null;
  }

  reverseCache.set(cacheKey, item);
  return item;
}

export function getPlaceTitle(place: PlaceSearchResult): string {
  return place.name?.trim() || place.display_name.split(",")[0]?.trim() || "Unknown place";
}

export function getPlaceSubtitle(place: PlaceSearchResult): string {
  const parts = place.display_name.split(",").map((part) => part.trim());
  return parts.slice(1, 4).join(", ") || place.display_name;
}

export function getPlaceKind(place: PlaceSearchResult): string {
  const raw = place.addresstype || place.type || place.category || "place";
  return raw.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function getPlaceZoom(place: PlaceSearchResult): number {
  const kind = (place.addresstype || place.type || place.category || "").toLowerCase();

  if (kind.includes("country") || kind === "continent") return 4;
  if (kind.includes("state") || kind.includes("county") || kind.includes("region")) return 7;
  if (kind.includes("city") || kind.includes("town") || kind.includes("municipality")) return 10.5;
  if (kind.includes("suburb") || kind.includes("neighbourhood") || kind.includes("neighborhood")) return 13;
  if (
    kind.includes("road") ||
    kind.includes("street") ||
    kind.includes("restaurant") ||
    kind.includes("building") ||
    kind.includes("shop") ||
    kind.includes("amenity")
  ) {
    return 16;
  }
  return 12;
}
