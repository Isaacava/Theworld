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
const resultCache = new Map<string, PlaceSearchResult[]>();
let lastRequestStartedAt = 0;

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

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

  const delay = Math.max(0, 1100 - (Date.now() - lastRequestStartedAt));
  if (delay > 0) {
    await wait(delay);
  }

  lastRequestStartedAt = Date.now();

  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "6");
  url.searchParams.set("accept-language", "en");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { "Accept-Language": "en" },
    cache: "no-store",
  });

  if (response.status === 429) {
    throw new Error(
      "Place search is temporarily busy. Please wait a moment before trying again.",
    );
  }
  if (!response.ok) {
    throw new Error("We couldn't search places right now. Please try again.");
  }

  const payload: unknown = await response.json();
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
