import { MongoServerError, ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { businessDto, OSM_FEATURE_KEY } from "@/lib/businesses";
import { hasSameOrigin, isJsonRequest } from "@/lib/http";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";
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
type NearbyBusiness = {
  osmPlaceKey: string;
  name: string;
  category: string;
  address: string;
  coordinates: [number, number];
  source: "OpenStreetMap";
  isVerified: boolean;
  businessId: string | null;
  isOwner?: boolean;
  status: "nearby" | "pending" | "verified";
};

function haversineMeters(a: [number, number], b: [number, number]) {
  const radians = (n: number) => n * Math.PI / 180;
  const dLat = radians(b[1] - a[1]);
  const dLon = radians(b[0] - a[0]);
  const lat1 = radians(a[1]);
  const lat2 = radians(b[1]);
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(Math.max(0, 1 - q)));
}

function normalizeElement(item: OSMElement): Omit<NearbyBusiness, "isVerified" | "businessId" | "status"> | null {
  if (!["node", "way", "relation"].includes(String(item.type)) ||
      !Number.isSafeInteger(Number(item.id)) || Number(item.id) <= 0) return null;
  const tags = item.tags && typeof item.tags === "object" ? item.tags : {};
  const name = typeof tags.name === "string" ? tags.name.trim() :
    typeof tags.brand === "string" ? tags.brand.trim() : "";
  const latitude = Number(item.lat ?? item.center?.lat);
  const longitude = Number(item.lon ?? item.center?.lon);
  if (name.length < 2 || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  const category = [
    ["shop", "Shop"], ["amenity", "Local service"], ["office", "Office"],
    ["craft", "Craft business"], ["healthcare", "Healthcare"], ["tourism", "Visitor service"],
    ["leisure", "Leisure"],
  ].map(([key, label]) => typeof tags[key] === "string" ? [label, String(tags[key]).replace(/_/g, " ")] as const : null)
    .find(Boolean);
  const address = [
    [tags["addr:housenumber"], tags["addr:street"]].filter((v) => typeof v === "string").join(" "),
    tags["addr:suburb"], tags["addr:city"],
  ].filter((v) => typeof v === "string" && v).join(", ");
  return {
    osmPlaceKey: `${String(item.type)}-${Number(item.id)}`,
    name: name.slice(0, 160),
    category: category ? `${category[0]} · ${category[1].slice(0, 60)}` : "Local business",
    address: address.slice(0, 300),
    coordinates: [longitude, latitude],
    source: "OpenStreetMap",
  };
}

async function loadNearbyBusinesses(db: Awaited<ReturnType<typeof getDatabase>>, placeKey: string, center: [number, number]) {
  const now = new Date();
  const cache = db.collection<{ cacheKey: string; businesses: ReturnType<typeof normalizeElement>[]; expiresAt: Date }>("nearbyBusinessCache");
  const cached = await cache.findOne({ cacheKey: placeKey, expiresAt: { $gt: now } });
  if (cached && Array.isArray(cached.businesses)) return cached.businesses.filter(Boolean) as NonNullable<ReturnType<typeof normalizeElement>>[];

  // Share a database-backed request slot rather than allowing every serverless
  // instance to hammer the public Overpass service.
  const rates = db.collection<{ _id: string; nextAllowedAt: number }>("geocoderRateLimits");
  const current = Date.now();
  const previous = await rates.findOneAndUpdate(
    { _id: "overpass-global" },
    [{ $set: { nextAllowedAt: { $add: [{ $max: [{ $ifNull: ["$nextAllowedAt", current] }, current] }, 1000] } } }],
    { upsert: true, returnDocument: "before" },
  );
  const delay = Math.max(0, (previous?.nextAllowedAt ?? current) - current);
  if (delay > 2500) throw new Error("Nearby business lookup is busy. Try again shortly.");
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

  const lat = center[1];
  const lon = center[0];
  const query = `[out:json][timeout:8];(nwr(around:850,${lat},${lon})["name"]["shop"];nwr(around:850,${lat},${lon})["name"]["amenity"~"restaurant|cafe|fast_food|pharmacy|bank|marketplace|fuel|clinic|doctors|dentist|beauty_salon|bar|pub"];nwr(around:850,${lat},${lon})["name"]["office"];nwr(around:850,${lat},${lon})["name"]["craft"];nwr(around:850,${lat},${lon})["name"]["healthcare"];nwr(around:850,${lat},${lon})["name"]["tourism"~"hotel|guest_house|attraction|museum"];);out center tags 70;`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9500);
  let candidates: NonNullable<ReturnType<typeof normalizeElement>>[] = [];
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
    if (!response.ok) throw new Error("Nearby business data is temporarily unavailable.");
    const payload = await response.json() as { elements?: OSMElement[] };
    candidates = (Array.isArray(payload.elements) ? payload.elements : [])
      .map(normalizeElement)
      .filter((item): item is NonNullable<ReturnType<typeof normalizeElement>> => item !== null)
      .filter((item) => haversineMeters(center, item.coordinates) <= 900)
      .filter((item, index, all) => all.findIndex((candidate) => candidate.osmPlaceKey === item.osmPlaceKey) === index)
      .slice(0, 60);
  } finally {
    clearTimeout(timeout);
  }
  await cache.updateOne(
    { cacheKey: placeKey },
    { $set: { cacheKey: placeKey, businesses: candidates, fetchedAt: now, expiresAt: new Date(now.getTime() + 6 * 60 * 60 * 1000) } },
    { upsert: true },
  );
  return candidates;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const placeKey = url.searchParams.get("placeKey") || "";
  if (!OSM_FEATURE_KEY.test(placeKey)) return NextResponse.json({ error: "Choose a real mapped place first." }, { status: 400 });
  if (!isMongoConfigured()) return NextResponse.json({ businesses: [], nearby: [], error: "The business directory is not connected yet." }, { status: 503 });
  try {
    const db = await getDatabase();
    const user = await getCurrentUser().catch(() => null);
    // Canonical metadata provides an authoritative search centre without requiring
    // a potentially huge city polygon for a read-only directory request.
    const place = await getCanonicalOsmPlaceMetadata(db, placeKey);
    let nearby: NonNullable<ReturnType<typeof normalizeElement>>[] = [];
    let sourceUnavailable = false;
    try {
      nearby = await loadNearbyBusinesses(db, placeKey, place.coordinates);
    } catch {
      sourceUnavailable = true;
    }
    const keys = nearby.map((item) => item.osmPlaceKey);
    const conditions: Record<string, unknown>[] = [{ placeKey, status: "verified", verificationStatus: "verified" }];
    if (keys.length) conditions.push({ osmPlaceKey: { $in: keys }, status: "verified", verificationStatus: "verified" });
    if (user) conditions.push({ claimantId: new ObjectId(user.id), status: "pending" });
    const docs = await db.collection("businesses").find({ $or: conditions }).limit(100).toArray();
    const byOsmKey = new Map(docs.map((doc) => [String(doc.osmPlaceKey), doc]));
    const publicBusinesses = docs.filter((doc) => doc.status === "verified" || (user && doc.claimantId instanceof ObjectId && doc.claimantId.equals(new ObjectId(user.id))))
      .map((doc) => businessDto(doc as unknown as Record<string, unknown>, user?.id));
    const nearbyDtos: NearbyBusiness[] = nearby.map((candidate) => {
      const listing = byOsmKey.get(candidate.osmPlaceKey);
      return {
        ...candidate,
        isVerified: Boolean(listing?.status === "verified" && listing?.verificationStatus === "verified"),
        businessId: listing && listing.status === "verified" && listing.verificationStatus === "verified" ? String(listing._id) : null,
        isOwner: Boolean(user && listing?.ownerId instanceof ObjectId && listing.ownerId.equals(new ObjectId(user.id))),
        status: listing?.status === "verified" && listing?.verificationStatus === "verified" ? "verified" : listing?.status === "pending" ? "pending" : "nearby",
      };
    });
    // Include verified directory listings near the selected place even when a
    // particular POI was not returned by Overpass on this request.
    const listingKeys = new Set(nearbyDtos.map((item) => item.osmPlaceKey));
    for (const doc of docs) {
      if (doc.status !== "verified" || doc.verificationStatus !== "verified") continue;
      if (typeof doc.osmPlaceKey !== "string" || listingKeys.has(doc.osmPlaceKey)) continue;
      if (!Array.isArray(doc.coordinates) || doc.coordinates.length !== 2) continue;
      nearbyDtos.unshift({
        osmPlaceKey: doc.osmPlaceKey,
        name: String(doc.name ?? "Local business"),
        category: String(doc.category ?? "Local business"),
        address: String(doc.address ?? ""),
        coordinates: [Number(doc.coordinates[0]), Number(doc.coordinates[1])],
        source: "OpenStreetMap",
        isVerified: true,
        businessId: String(doc._id),
        isOwner: Boolean(user && doc.ownerId instanceof ObjectId && doc.ownerId.equals(new ObjectId(user.id))),
        status: "verified",
      });
    }
    return NextResponse.json({
      place: { placeKey, name: place.name, displayName: place.displayName, coordinates: place.coordinates },
      businesses: publicBusinesses,
      nearby: nearbyDtos,
      sourceUnavailable,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PlaceLookupError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ businesses: [], nearby: [], error: "We couldn't load nearby businesses. Please try again." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Send the business listing request as JSON." }, { status: 415 });
  if (!isMongoConfigured()) return NextResponse.json({ error: "Business listings are unavailable until the database is configured." }, { status: 503 });
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "The request body is invalid." }, { status: 400 }); }
  if (!input || typeof input !== "object") return NextResponse.json({ error: "Provide a business listing request." }, { status: 400 });
  const values = input as Record<string, unknown>;
  const placeKey = typeof values.placeKey === "string" ? values.placeKey : "";
  const osmPlaceKey = typeof values.osmPlaceKey === "string" ? values.osmPlaceKey : "";
  const proofUrl = typeof values.proofUrl === "string" ? values.proofUrl.trim() : "";
  const verificationNote = typeof values.verificationNote === "string" ? values.verificationNote.trim().slice(0, 800) : "";
  if (!OSM_FEATURE_KEY.test(placeKey) || !OSM_FEATURE_KEY.test(osmPlaceKey)) return NextResponse.json({ error: "Choose a real mapped street and business." }, { status: 400 });
  let proof: URL;
  try { proof = new URL(proofUrl); } catch { return NextResponse.json({ error: "Add an official business website or other public proof link." }, { status: 400 }); }
  if (proof.protocol !== "https:" || proof.href.length > 500) return NextResponse.json({ error: "The business proof link must be a valid HTTPS URL." }, { status: 400 });
  let user;
  try { user = await getCurrentUser(); } catch { return NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 }); }
  if (!user) return NextResponse.json({ error: "Sign in to request a business listing." }, { status: 401 });
  try {
    const db = await getDatabase();
    const nearbyCache = await db.collection("nearbyBusinessCache").findOne({
      cacheKey: placeKey,
      expiresAt: { $gt: new Date() },
    });
    const cachedCandidates = Array.isArray(nearbyCache?.businesses) ? nearbyCache.businesses : [];
    const candidate = cachedCandidates.find((value) =>
      value && typeof value === "object" && (value as Record<string, unknown>).osmPlaceKey === osmPlaceKey
    ) as Record<string, unknown> | undefined;
    if (!candidate || typeof candidate.name !== "string" || typeof candidate.category !== "string") {
      return NextResponse.json({ error: "Choose a named shop or service from the nearby business directory before requesting verification." }, { status: 422 });
    }
    const [place, business] = await Promise.all([
      getCanonicalOsmPlaceMetadata(db, placeKey),
      getCanonicalOsmPlaceMetadata(db, osmPlaceKey),
    ]);
    if (haversineMeters(place.coordinates, business.coordinates) > 1200) return NextResponse.json({ error: "That business is not close enough to the selected street or neighbourhood." }, { status: 422 });
    const collection = db.collection("businesses");
    const existing = await collection.findOne({ osmPlaceKey });
    if (existing?.status === "verified" && existing.verificationStatus === "verified") return NextResponse.json({ error: "This business is already verified in THE WORLD." }, { status: 409 });
    if (existing?.status === "pending") return NextResponse.json({ error: "A listing verification request already exists for this business." }, { status: 409 });
    if (existing?._id) await collection.deleteOne({ _id: existing._id, status: "rejected" });
    const document = {
      osmPlaceKey,
      placeKey,
      name: business.name,
      category: business.kind,
      address: business.displayName,
      coordinates: business.coordinates,
      officialWebsite: proof.href,
      proofUrl: proof.href,
      verificationNote,
      claimantId: new ObjectId(user.id),
      claimantUsername: user.username,
      ownerId: null,
      status: "pending",
      verificationStatus: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const inserted = await collection.insertOne(document);
    return NextResponse.json({ success: true, business: businessDto({ ...document, _id: inserted.insertedId }, user.id), message: "Your listing is awaiting manual verification. It will not be marked verified until the review is complete." }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PlaceLookupError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof MongoServerError && error.code === 11000) return NextResponse.json({ error: "A listing request already exists for this mapped business." }, { status: 409 });
    return NextResponse.json({ error: "We couldn't submit this listing request. Please try again." }, { status: 503 });
  }
}
