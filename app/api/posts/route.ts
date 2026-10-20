import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasSameOrigin, isJsonRequest } from "@/lib/http";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OSM_PLACE_KEY = /^(node|way|relation)-[1-9]\d{0,17}$/;
const POST_TYPES = new Set(["thought", "question", "discovery", "update"]);

type PlaceInput = {
  placeKey: string;
  name: string;
  displayName: string;
  kind: string;
  coordinates: [number, number];
};

type LocationInput = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

function validCoordinates(longitude: unknown, latitude: unknown): boolean {
  return typeof longitude === "number" &&
    typeof latitude === "number" &&
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 &&
    Number.isFinite(latitude) && latitude >= -90 && latitude <= 90;
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const [longitudeA, latitudeA] = a;
  const [longitudeB, latitudeB] = b;
  const deltaLatitude = radians(latitudeB - latitudeA);
  const deltaLongitude = radians(longitudeB - longitudeA);
  const first = radians(latitudeA);
  const second = radians(latitudeB);
  const chord = Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(first) * Math.cos(second) * Math.sin(deltaLongitude / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(chord), Math.sqrt(Math.max(0, 1 - chord)));
}

function allowedRadius(kind: string): number {
  const normalized = kind.toLowerCase();
  if (/street|road|path|highway/.test(normalized)) return 250;
  if (/building|restaurant|shop|amenity|venue|point of interest/.test(normalized)) return 180;
  if (/neighbourhood|neighborhood|suburb|village|district/.test(normalized)) return 1500;
  if (/city|town|municipality/.test(normalized)) return 8000;
  return 300;
}

function publicPost(document: Record<string, unknown>) {
  return {
    id: String(document._id),
    body: document.body,
    type: document.type,
    placeKey: document.placeKey,
    placeName: document.placeName,
    author: {
      username: document.authorUsername,
      displayName: document.authorDisplayName,
    },
    createdAt: document.createdAt instanceof Date
      ? document.createdAt.toISOString()
      : new Date(String(document.createdAt)).toISOString(),
    presenceVerifiedAt: document.presenceVerifiedAt instanceof Date
      ? document.presenceVerifiedAt.toISOString()
      : null,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const placeKey = url.searchParams.get("placeKey") || "";
  if (!OSM_PLACE_KEY.test(placeKey)) {
    return NextResponse.json({ posts: [], configured: isMongoConfigured(), message: "Choose a named mapped place to view its live community." });
  }
  if (!isMongoConfigured()) {
    return NextResponse.json(
      { posts: [], configured: false, message: "Community storage is not connected yet. Configure MongoDB to enable persistent posts." },
      { status: 503 },
    );
  }

  try {
    const db = await getDatabase();
    const documents = await db.collection("posts")
      .find({ placeKey, status: "visible" })
      .sort({ createdAt: -1 })
      .limit(30)
      .project({
        body: 1,
        type: 1,
        placeKey: 1,
        placeName: 1,
        authorUsername: 1,
        authorDisplayName: 1,
        createdAt: 1,
        presenceVerifiedAt: 1,
      })
      .toArray();

    return NextResponse.json({
      configured: true,
      posts: documents.map((document) => publicPost(document as unknown as Record<string, unknown>)),
    });
  } catch {
    return NextResponse.json(
      { posts: [], configured: true, message: "The community feed is temporarily unavailable." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  }
  if (!isJsonRequest(request)) {
    return NextResponse.json({ error: "Send a post as JSON." }, { status: 415 });
  }
  if (!isMongoConfigured()) {
    return NextResponse.json({ error: "Posting is disabled until MongoDB is configured." }, { status: 503 });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body is invalid." }, { status: 400 });
  }
  if (!input || typeof input !== "object") {
    return NextResponse.json({ error: "Provide a post and the selected place." }, { status: 400 });
  }

  const values = input as Record<string, unknown>;
  const body = typeof values.body === "string" ? values.body.trim().replace(/\u0000/g, "") : "";
  const type = typeof values.type === "string" ? values.type : "thought";
  const place = values.place as Partial<PlaceInput> | undefined;
  const location = values.location as Partial<LocationInput> | undefined;
  const placeKey = typeof place?.placeKey === "string" ? place.placeKey : "";

  if (!OSM_PLACE_KEY.test(placeKey)) {
    return NextResponse.json({ error: "Posts must be attached to a named mapped place." }, { status: 400 });
  }
  if (body.length < 2 || body.length > 500) {
    return NextResponse.json({ error: "A post must contain 2–500 characters." }, { status: 400 });
  }
  if (!POST_TYPES.has(type)) {
    return NextResponse.json({ error: "Choose a valid post type." }, { status: 400 });
  }
  if (
    typeof place?.name !== "string" || place.name.length < 1 || place.name.length > 160 ||
    typeof place.displayName !== "string" || place.displayName.length < 1 || place.displayName.length > 500 ||
    typeof place.kind !== "string" || place.kind.length > 80 ||
    !Array.isArray(place.coordinates) || place.coordinates.length !== 2 ||
    !validCoordinates(place.coordinates[0], place.coordinates[1])
  ) {
    return NextResponse.json({ error: "The selected place details are invalid." }, { status: 400 });
  }
  if (
    typeof location?.latitude !== "number" ||
    typeof location.longitude !== "number" ||
    typeof location.accuracy !== "number" ||
    !validCoordinates(location.longitude, location.latitude) ||
    !Number.isFinite(location.accuracy) ||
    location.accuracy <= 0 ||
    location.accuracy > 100
  ) {
    return NextResponse.json(
      { error: "A sufficiently accurate location check is required. Try outdoors or choose a nearby community." },
      { status: 422 },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in before posting to a local community." }, { status: 401 });
  }

  const targetCoordinates: [number, number] = [place.coordinates[0], place.coordinates[1]];
  const currentCoordinates: [number, number] = [location.longitude, location.latitude];
  const radius = allowedRadius(place.kind);
  const distance = haversineMeters(targetCoordinates, currentCoordinates);

  if (distance > radius) {
    return NextResponse.json(
      { error: "You appear to be too far from this place to post in LIVE HERE. Tap the map closer to your current location and try again." },
      { status: 403 },
    );
  }

  try {
    const db = await getDatabase();
    const userId = new ObjectId(user.id);
    const now = new Date();
    const lastMinute = new Date(now.getTime() - 60_000);
    const today = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const posts = db.collection("posts");

    const [recentCount, dailyCount] = await Promise.all([
      posts.countDocuments({ authorId: userId, createdAt: { $gte: lastMinute } }),
      posts.countDocuments({ authorId: userId, createdAt: { $gte: today } }),
    ]);
    if (recentCount >= 3 || dailyCount >= 25) {
      return NextResponse.json(
        { error: recentCount >= 3 ? "Please wait a moment before posting again." : "You've reached the prototype's daily posting limit." },
        { status: 429 },
      );
    }

    await db.collection("communities").updateOne(
      { placeKey },
      {
        $setOnInsert: {
          placeKey,
          name: place.name,
          displayName: place.displayName,
          kind: place.kind,
          coordinates: targetCoordinates,
          createdAt: now,
        },
        $set: { lastActiveAt: now },
      },
      { upsert: true },
    );

    const document = {
      placeKey,
      placeName: place.name,
      placeDisplayName: place.displayName,
      body,
      type,
      authorId: userId,
      authorUsername: user.username,
      authorDisplayName: user.displayName,
      status: "visible",
      createdAt: now,
      presenceVerifiedAt: now,
      presenceMethod: "browser-geolocation-proximity",
      verificationRadiusMeters: radius,
    };
    const result = await posts.insertOne(document);
    return NextResponse.json(
      { post: publicPost({ ...document, _id: result.insertedId }) },
      { status: 201 },
    );
  } catch {
    return NextResponse.json(
      { error: "We couldn't publish this post. Check the database setup and try again." },
      { status: 503 },
    );
  }
}
