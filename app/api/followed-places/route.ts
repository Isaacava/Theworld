import { MongoServerError, ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasSameOrigin, isJsonRequest } from "@/lib/http";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLACE_KEY = /^(node|way|relation)-[1-9]\d{0,17}$/;
const MAX_FOLLOWED_PLACES = 100;

function safeIso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

function publicFollowedPlace(record: Record<string, unknown>) {
  const coordinates = record.coordinates;
  if (
    !Array.isArray(coordinates) ||
    coordinates.length !== 2 ||
    typeof coordinates[0] !== "number" ||
    typeof coordinates[1] !== "number" ||
    !Number.isFinite(coordinates[0]) ||
    !Number.isFinite(coordinates[1]) ||
    coordinates[0] < -180 || coordinates[0] > 180 ||
    coordinates[1] < -90 || coordinates[1] > 90
  ) return null;

  const zoom = typeof record.zoom === "number" && Number.isFinite(record.zoom)
    ? Math.max(1, Math.min(20, record.zoom))
    : 14;

  return {
    placeKey: typeof record.placeKey === "string" ? record.placeKey : "",
    name: typeof record.name === "string" ? record.name : "Mapped place",
    displayName: typeof record.displayName === "string" ? record.displayName : "",
    subtitle: typeof record.subtitle === "string" ? record.subtitle : "",
    kind: typeof record.kind === "string" ? record.kind : "Mapped place",
    coordinates: [coordinates[0], coordinates[1]] as [number, number],
    zoom,
    followedAt: safeIso(record.followedAt),
  };
}

async function currentUserOrResponse() {
  try {
    const user = await getCurrentUser();
    return user ?? { response: NextResponse.json({ error: "Sign in to use followed places." }, { status: 401 }) };
  } catch {
    return { response: NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 }) };
  }
}

export async function GET() {
  if (!isMongoConfigured()) return NextResponse.json({ places: [], error: "Followed places are unavailable until MongoDB is configured." }, { status: 503 });
  const context = await currentUserOrResponse();
  if ("response" in context) return context.response;

  try {
    const records = await (await getDatabase()).collection("followedPlaces")
      .find({ userId: new ObjectId(context.id) })
      .sort({ followedAt: -1 })
      .limit(MAX_FOLLOWED_PLACES)
      .toArray();
    const places = records
      .map((record) => publicFollowedPlace(record as unknown as Record<string, unknown>))
      .filter((place): place is NonNullable<typeof place> => place !== null);
    return NextResponse.json({ places }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ places: [], error: "We couldn't load your followed places." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Send followed-place updates as JSON." }, { status: 415 });
  if (!isMongoConfigured()) return NextResponse.json({ error: "Followed places are unavailable until MongoDB is configured." }, { status: 503 });

  let input: unknown;
  try { input = await request.json(); } catch {
    return NextResponse.json({ error: "The request body is invalid." }, { status: 400 });
  }
  if (!input || typeof input !== "object") return NextResponse.json({ error: "Choose a mapped place to follow." }, { status: 400 });

  const values = input as Record<string, unknown>;
  const action = typeof values.action === "string" ? values.action : "";
  const placeKey = typeof values.placeKey === "string" ? values.placeKey : "";
  if (action !== "follow" && action !== "unfollow") return NextResponse.json({ error: "Choose whether to follow or unfollow this place." }, { status: 400 });
  if (!PLACE_KEY.test(placeKey)) return NextResponse.json({ error: "Follow a named place from the map search." }, { status: 400 });

  const context = await currentUserOrResponse();
  if ("response" in context) return context.response;

  try {
    const db = await getDatabase();
    const userId = new ObjectId(context.id);
    const followedPlaces = db.collection("followedPlaces");
    const filter = { userId, placeKey };

    if (action === "unfollow") {
      const result = await followedPlaces.deleteOne(filter);
      if (result.deletedCount === 0) return NextResponse.json({ error: "This place is not in your followed list." }, { status: 404 });
      return NextResponse.json({ following: false }, { headers: { "Cache-Control": "no-store" } });
    }

    const name = typeof values.name === "string" ? values.name.trim().slice(0, 180) : "";
    const displayName = typeof values.displayName === "string" ? values.displayName.trim().slice(0, 500) : "";
    const subtitle = typeof values.subtitle === "string" ? values.subtitle.trim().slice(0, 180) : "";
    const kind = typeof values.kind === "string" ? values.kind.trim().slice(0, 60) : "Mapped place";
    const coordinates = values.coordinates;
    const zoom = typeof values.zoom === "number" && Number.isFinite(values.zoom) ? Math.max(1, Math.min(20, values.zoom)) : 14;

    if (name.length < 2 || !displayName) return NextResponse.json({ error: "The mapped place details are incomplete." }, { status: 400 });
    if (
      !Array.isArray(coordinates) ||
      coordinates.length !== 2 ||
      typeof coordinates[0] !== "number" ||
      typeof coordinates[1] !== "number" ||
      !Number.isFinite(coordinates[0]) ||
      !Number.isFinite(coordinates[1]) ||
      coordinates[0] < -180 || coordinates[0] > 180 ||
      coordinates[1] < -90 || coordinates[1] > 90
    ) return NextResponse.json({ error: "The place coordinates are invalid." }, { status: 400 });

    const existing = await followedPlaces.findOne(filter, { projection: { _id: 1 } });
    if (!existing) {
      const count = await followedPlaces.countDocuments({ userId });
      if (count >= MAX_FOLLOWED_PLACES) return NextResponse.json({ error: "You can follow up to 100 places. Unfollow a place before adding another." }, { status: 429 });
    }

    const now = new Date();
    await followedPlaces.updateOne(
      filter,
      { $setOnInsert: {
        ...filter,
        name,
        displayName,
        subtitle,
        kind,
        coordinates: [coordinates[0], coordinates[1]],
        zoom,
        followedAt: now,
      } },
      { upsert: true },
    );
    return NextResponse.json({ following: true, alreadyFollowing: Boolean(existing) }, {
      status: existing ? 200 : 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      return NextResponse.json({ following: true, alreadyFollowing: true }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "We couldn't update your followed places." }, { status: 503 });
  }
}
