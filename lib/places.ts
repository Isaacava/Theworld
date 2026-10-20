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

const searchCache = new Map<string, PlaceSearchResult[]>();
const reverseCache = new Map<string, PlaceSearchResult | null>();

async function readApiPayload<T>(url: URL): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new Error("The place service couldn't be reached. Check your connection and try again.");
  }

  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload &&
      typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : "The place service is temporarily unavailable. Please try again.";
    throw new Error(message);
  }
  return payload as T;
}

/**
 * Search the prototype's same-origin API. The server applies shared request
 * throttling and Mongo-backed caching when MongoDB is configured, so browsers
 * do not each send their own requests directly to the public Nominatim service.
 */
export async function searchPlaces(rawQuery: string): Promise<PlaceSearchResult[]> {
  const query = rawQuery.trim().replace(/\s+/g, " ");
  if (query.length < 2) return [];
  if (query.length > 160) {
    throw new Error("Search terms must be 160 characters or fewer.");
  }

  const cacheKey = query.toLocaleLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const url = new URL("/api/places/search", window.location.origin);
  url.searchParams.set("q", query);
  const payload = await readApiPayload<{ results?: unknown }>(url);
  const results = Array.isArray(payload.results)
    ? (payload.results as PlaceSearchResult[]).filter(
        (item) =>
          item &&
          typeof item.display_name === "string" &&
          ["node", "way", "relation"].includes(item.osm_type) &&
          Number.isSafeInteger(Number(item.osm_id)) &&
          Number.isFinite(Number(item.lat)) &&
          Number.isFinite(Number(item.lon)),
      )
    : [];

  searchCache.set(cacheKey, results);
  return results;
}

/**
 * Resolve a map tap to the nearest named OSM feature through the server API.
 * The coordinate is used only for this explicit lookup; it is not published
 * as the user's current device position.
 */
export async function reversePlace(
  latitude: number,
  longitude: number,
): Promise<PlaceSearchResult | null> {
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error("That map position is not valid.");
  }

  const cacheKey = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  if (reverseCache.has(cacheKey)) return reverseCache.get(cacheKey) ?? null;

  const url = new URL("/api/places/reverse", window.location.origin);
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));

  const payload = await readApiPayload<{ place?: unknown }>(url);
  const result = payload.place as PlaceSearchResult | null | undefined;
  if (
    !result ||
    typeof result.display_name !== "string" ||
    !["node", "way", "relation"].includes(result.osm_type) ||
    !Number.isFinite(Number(result.lat)) ||
    !Number.isFinite(Number(result.lon))
  ) {
    reverseCache.set(cacheKey, null);
    return null;
  }

  reverseCache.set(cacheKey, result);
  return result;
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
