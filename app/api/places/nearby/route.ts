import { NextResponse } from "next/server";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";
import { OSM_FEATURE_KEY } from "@/lib/businesses";
import { getCanonicalOsmPlaceMetadata, PlaceLookupError } from "@/lib/osm-place";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OSMElement = {
  type?: unknown;
  id?: unknown;
  lat?: unknown;
  lon?: unknown;
  center?: { lat?: unknown; lon?: unknown };
  tags?: Record<string, unknown>;
};

type NearbyCommunity = {
  id: string;
  osmPlaceKey: string;
  name: string;
  subtitle: string;
  displayName: string;
  kind: string;
  coordinates: [number, number];
  zoom: number;
  distanceMeters: number;
  conversationCount: number;
};

function distanceMeters(a: [number, number], b: [number, number]) {
  const radians = (n: number) => n * Math.PI / 180;
  const dLat = radians(b[1] - a[1]);
  const dLon = radians(b[0] - a[0]);
  const lat1 = radians(a[1]);
  const lat2 = radians(b[1]);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 80);
}

function normalizeElement(
  item: OSMElement,
  origin: [number, number],
  selectedPlaceKey: string,
  selectedPlaceName: string,
): Omit<NearbyCommunity, "conversationCount"> | null {
  if (!["node", "way", "relation"].includes(String(item.type)) ||
      !Number.isSafeInteger(Number(item.id)) || Number(item.id) <= 0) return null;
  const tags = item.tags && typeof item.tags === "object" ? item.tags : {};
  const name = typeof tags.name === "string" ? tags.name.trim() : "";
  const latitude = Number(item.lat ?? item.center?.lat);
  const longitude = Number(item.lon ?? item.center?.lon);
  if (name.length < 2 || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;

  const osmPlaceKey = `${String(item.type)}-${Number(item.id)}`;
  if (osmPlaceKey === selectedPlaceKey || name.toLocaleLowerCase() === selectedPlaceName.toLocaleLowerCase()) return null;

  const placeKind = typeof tags.place === "string" ? tags.place : "";
  const highwayKind = typeof tags.highway === "string" ? tags.highway : "";
  if (!placeKind && !highwayKind) return null;
  const kind = placeKind ? titleCase(placeKind) : "Street";
  const coords: [number, number] = [longitude, latitude];
  const suffix = [
    tags["addr:suburb"],
    tags["addr:city"],
    tags["addr:state"],
    tags["addr:country"],
  ].filter((value) => typeof value === "string" && value.trim()).join(", ");
  const displayName = suffix ? `${name}, ${suffix}` : `${name}, near ${selectedPlaceName}`;
  const zoom = /city|municipality/i.test(placeKind) ? 10 :
    /town|village|borough|district/i.test(placeKind) ? 12 :
    /neighbourhood|neighborhood|suburb|quarter|locality|hamlet/i.test(placeKind) ? 13 : 15;

  return {
    id: osmPlaceKey,
    osmPlaceKey,
    name: name.slice(0, 160),
    subtitle: placeKind ? `${kind} · nearby mapped place` : "Street · nearby mapped place",
    displayName: displayName.slice(0, 500),
    kind,
    coordinates: coords,
    zoom,
    distanceMeters: Math.round(distanceMeters(origin, coords)),
  };
}

async function loadNearbyCommunities(
  db: Awaited<ReturnType<typeof getDatabase>>,
  placeKey: string,
  placeName: string,
  center: [number, number],
  isCityLike: boolean,
) {
  const now = new Date();
  const cache = db.collection<{
    cacheKey: string;
    communities: Omit<NearbyCommunity, "conversationCount">[];
    radiusMeters: number;
    fetchedAt: Date;
    expiresAt: Date;
  }>("nearbyCommunityCache");
  const [freshCache, staleCache] = await Promise.all([
    cache.findOne({ cacheKey: placeKey, expiresAt: { $gt: now } }),
    cache.findOne({ cacheKey: placeKey }),
  ]);
  const radiusMeters = isCityLike ? 12000 : 3500;
  if (freshCache && Array.isArray(freshCache.communities)) {
    return { communities: freshCache.communities, radiusMeters: freshCache.radiusMeters || radiusMeters, cached: true, stale: false };
  }

  const rates = db.collection<{ _id: string; nextAllowedAt: number }>("geocoderRateLimits");
  const current = Date.now();
  const previous = await rates.findOneAndUpdate(
    { _id: "overpass-global" },
    [{ $set: { nextAllowedAt: { $add: [{ $max: [{ $ifNull: ["$nextAllowedAt", current] }, current] }, 1000] } } }],
    { upsert: true, returnDocument: "before" },
  );
  const delay = Math.max(0, (previous?.nextAllowedAt ?? current) - current);
  if (delay > 2500) throw new Error("Nearby map discovery is busy. Try again shortly.");
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

  const lat = center[1];
  const lon = center[0];
  const places = `nwr(around:${radiusMeters},${lat},${lon})["name"]["place"~"neighbourhood|suburb|quarter|borough|district|city|town|village|hamlet|locality|isolated_dwelling"];`;
  const streets = isCityLike ? "" :
    `nwr(around:${radiusMeters},${lat},${lon})["name"]["highway"~"residential|living_street|pedestrian|tertiary|unclassified"];`;
  const query = `[out:json][timeout:8];(${places}${streets});out center tags 100;`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9500);
  let candidates: Omit<NearbyCommunity, "conversationCount">[] = [];
  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "Accept": "application/json",
        "User-Agent": "THE-WORLD-prototype/0.1 (https://github.com/Isaacava/Theworld)",
      },
      body: new URLSearchParams({ data: query }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Nearby map data is temporarily unavailable.");
    const payload = await response.json() as { elements?: OSMElement[] };
    const normalized = (Array.isArray(payload.elements) ? payload.elements : [])
      .map((item) => normalizeElement(item, center, placeKey, placeName))
      .filter((item): item is Omit<NearbyCommunity, "conversationCount"> => item !== null)
      .filter((item) => item.distanceMeters <= radiusMeters)
      .sort((a, b) => {
        const aIsPlace = a.kind !== "Street";
        const bIsPlace = b.kind !== "Street";
        return Number(bIsPlace) - Number(aIsPlace) || a.distanceMeters - b.distanceMeters;
      });

    const seen = new Set<string>();
    candidates = normalized.filter((item) => {
      const key = `${item.name.toLocaleLowerCase()}|${item.kind.toLocaleLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 40);

    await cache.updateOne(
      { cacheKey: placeKey },
      { $set: { cacheKey: placeKey, communities: candidates, radiusMeters, fetchedAt: now, expiresAt: new Date(now.getTime() + 6 * 60 * 60 * 1000) } },
      { upsert: true },
    );
    return { communities: candidates, radiusMeters, cached: false, stale: false };
  } catch (error) {
    if (staleCache && Array.isArray(staleCache.communities)) {
      return { communities: staleCache.communities, radiusMeters: staleCache.radiusMeters || radiusMeters, cached: true, stale: true };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  const placeKey = new URL(request.url).searchParams.get("placeKey") || "";
  if (!OSM_FEATURE_KEY.test(placeKey)) return NextResponse.json({ error: "Choose a real mapped place first." }, { status: 400 });
  if (!isMongoConfigured()) return NextResponse.json({ error: "Nearby place discovery is unavailable until storage is connected." }, { status: 503 });

  try {
    const db = await getDatabase();
    const place = await getCanonicalOsmPlaceMetadata(db, placeKey);
    const isCityLike = /city|town|municipality|village/i.test(place.kind);
    const loaded = await loadNearbyCommunities(db, placeKey, place.name, place.coordinates, isCityLike);
    const [originLon, originLat] = place.coordinates;
    const latitudeDelta = loaded.radiusMeters / 111320;
    const longitudeDelta = loaded.radiusMeters / (111320 * Math.max(0.2, Math.cos(originLat * Math.PI / 180)));
    // Also include previously active THE WORLD communities. This is how city
    // screens discover streets with real posts even when Overpass omits their
    // individual road features from its bounded result set.
    const persistedCommunities = await db.collection("communities").find({
      placeKey: { $ne: placeKey },
      "coordinates.0": { $gte: originLon - longitudeDelta, $lte: originLon + longitudeDelta },
      "coordinates.1": { $gte: originLat - latitudeDelta, $lte: originLat + latitudeDelta },
    }).project({ placeKey: 1, name: 1, displayName: 1, kind: 1, coordinates: 1, lastActiveAt: 1 })
      .sort({ lastActiveAt: -1 }).limit(300).toArray();

    const candidateMap = new Map(loaded.communities.map((item) => [item.osmPlaceKey, item]));
    for (const doc of persistedCommunities) {
      const key = String(doc.placeKey ?? "");
      if (!OSM_FEATURE_KEY.test(key) || key === placeKey ||
          !Array.isArray(doc.coordinates) || doc.coordinates.length !== 2 ||
          typeof doc.coordinates[0] !== "number" || typeof doc.coordinates[1] !== "number") continue;
      const coordinates: [number, number] = [doc.coordinates[0], doc.coordinates[1]];
      const distance = Math.round(distanceMeters(place.coordinates, coordinates));
      if (distance > loaded.radiusMeters) continue;
      const name = typeof doc.name === "string" ? doc.name.trim() : "";
      if (name.length < 2) continue;
      const displayName = typeof doc.displayName === "string" && doc.displayName.trim()
        ? doc.displayName.slice(0, 500)
        : `${name}, near ${place.name}`;
      const rawKind = typeof doc.kind === "string" ? doc.kind : "Mapped place";
      const kind = /road|street|highway|residential|tertiary|unclassified|pedestrian/i.test(rawKind) ? "Street" : rawKind;
      const metadata = {
        id: key,
        osmPlaceKey: key,
        name: name.slice(0, 160),
        subtitle: displayName.split(",").slice(1, 3).join(", ").trim() || `${kind} · nearby mapped place`,
        displayName,
        kind,
        coordinates,
        zoom: /city|municipality/i.test(kind) ? 10 : /town|village|neighbourhood|neighborhood|suburb|quarter|district/i.test(kind) ? 13 : 15,
        distanceMeters: distance,
      };
      const existing = candidateMap.get(key);
      candidateMap.set(key, existing ? { ...metadata, ...existing, distanceMeters: distance } : metadata);
    }

    const allCandidates = [...candidateMap.values()];
    const keys = allCandidates.map((item) => item.osmPlaceKey);
    const counts = keys.length ? await db.collection("posts").aggregate([
      { $match: { placeKey: { $in: keys }, status: "visible" } },
      { $group: { _id: "$placeKey", count: { $sum: 1 } } },
    ]).toArray() : [];
    const countMap = new Map(counts.map((row) => [String(row._id), Number(row.count ?? 0)]));
    const orderedCandidates = allCandidates.sort((a, b) =>
      Number((countMap.get(b.osmPlaceKey) ?? 0) > 0) - Number((countMap.get(a.osmPlaceKey) ?? 0) > 0) ||
      a.distanceMeters - b.distanceMeters
    );
    const seenPlaceNames = new Set<string>();
    const visibleCandidates = orderedCandidates.filter((item) => {
      const identity = `${item.name.toLocaleLowerCase()}|${item.kind.toLocaleLowerCase()}`;
      if (seenPlaceNames.has(identity)) return false;
      seenPlaceNames.add(identity);
      return true;
    }).slice(0, 40);
    const communities: NearbyCommunity[] = visibleCandidates.map((item) => ({
      ...item,
      conversationCount: countMap.get(item.osmPlaceKey) ?? 0,
    }));
    const communityCoordinates = new Map(allCandidates.map((item) => [item.osmPlaceKey, item.coordinates]));
    const activityDocs = keys.length ? await db.collection("posts").aggregate([
      { $match: { placeKey: { $in: keys }, status: "visible" } },
      { $sort: { _id: -1 } },
      { $limit: 20 },
      { $lookup: {
        from: "replies",
        localField: "_id",
        foreignField: "postId",
        pipeline: [{ $match: { status: "visible" } }, { $project: { _id: 1 } }],
        as: "replyRecords",
      } },
      { $addFields: { replyCount: { $size: "$replyRecords" } } },
      { $project: { body: 1, type: 1, placeKey: 1, placeName: 1, placeDisplayName: 1, authorUsername: 1, authorDisplayName: 1, createdAt: 1, replyCount: 1, isRemoteQuestion: 1 } },
    ]).toArray() : [];
    const activity = activityDocs.flatMap((doc) => {
      const placeKeyValue = String(doc.placeKey ?? "");
      const coordinates = communityCoordinates.get(placeKeyValue);
      if (!coordinates) return [];
      const createdAt = doc.createdAt instanceof Date ? doc.createdAt.toISOString() : new Date(String(doc.createdAt ?? "")).toISOString();
      return [{
        id: String(doc._id),
        body: String(doc.body ?? ""),
        type: String(doc.type ?? "thought"),
        placeKey: placeKeyValue,
        placeName: String(doc.placeName ?? "Nearby place"),
        placeDisplayName: String(doc.placeDisplayName ?? doc.placeName ?? "Nearby place"),
        author: {
          username: String(doc.authorUsername ?? "member"),
          displayName: String(doc.authorDisplayName ?? doc.authorUsername ?? "Member"),
        },
        createdAt: Number.isFinite(new Date(createdAt).getTime()) ? createdAt : new Date(0).toISOString(),
        replyCount: Number(doc.replyCount ?? 0),
        isRemoteQuestion: doc.isRemoteQuestion === true,
        coordinates,
      }];
    });
    return NextResponse.json({
      place: { id: place.placeKey, name: place.name, kind: place.kind, coordinates: place.coordinates },
      communities,
      activity,
      radiusMeters: loaded.radiusMeters,
      cached: loaded.cached,
      stale: loaded.stale,
      source: "OpenStreetMap",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PlaceLookupError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nearby place discovery is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
