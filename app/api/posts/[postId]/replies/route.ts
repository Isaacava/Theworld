import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasSameOrigin, isJsonRequest } from "@/lib/http";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";
import { allowedRadius, validCoordinates } from "@/lib/location-check";
import { distanceToGeoJsonMeters } from "@/lib/place-geometry.mjs";
import { getCanonicalOsmPlace, PlaceLookupError } from "@/lib/osm-place";
import { createNotification } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ postId: string }>;
};

type LocationInput = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

function publicReply(document: Record<string, unknown>) {
  const createdAt = document.createdAt instanceof Date
    ? document.createdAt.toISOString()
    : new Date(String(document.createdAt)).toISOString();

  return {
    id: String(document._id),
    postId: String(document.postId),
    body: document.body,
    placeKey: document.placeKey,
    placeName: document.placeName,
    author: {
      username: document.authorUsername,
      displayName: document.authorDisplayName,
    },
    createdAt,
    presenceVerifiedAt: document.presenceVerifiedAt instanceof Date
      ? document.presenceVerifiedAt.toISOString()
      : null,
    editedAt: document.editedAt instanceof Date ? document.editedAt.toISOString() : null,
  };
}

function validPostId(value: string): boolean {
  return /^[a-f\d]{24}$/i.test(value);
}

export async function GET(request: Request, context: RouteContext) {
  const { postId } = await context.params;
  if (!validPostId(postId)) {
    return NextResponse.json({ replies: [], error: "That conversation identifier is invalid." }, { status: 400 });
  }
  if (!isMongoConfigured()) {
    return NextResponse.json({ replies: [], hasMore: false, nextCursor: null, message: "Community storage is not connected yet." }, { status: 503 });
  }
  const before = new URL(request.url).searchParams.get("before") || "";
  if (before && !/^[a-f\d]{24}$/i.test(before)) {
    return NextResponse.json({ replies: [], error: "That reply cursor is invalid." }, { status: 400 });
  }

  try {
    const db = await getDatabase();
    const parentId = new ObjectId(postId);
    const parent = await db.collection("posts").findOne({ _id: parentId, status: "visible" });
    if (!parent) return NextResponse.json({ replies: [], error: "That conversation is no longer available." }, { status: 404 });

    const filter: Record<string, unknown> = { postId: parentId, status: "visible" };
    if (before) filter._id = { $lt: new ObjectId(before) };
    const found = await db.collection("replies")
      .find(filter)
      .sort({ _id: -1 })
      .limit(51)
      .project({
        postId: 1, body: 1, placeKey: 1, placeName: 1, authorUsername: 1,
        authorDisplayName: 1, createdAt: 1, presenceVerifiedAt: 1, editedAt: 1,
      })
      .toArray();
    const hasMore = found.length > 50;
    const pageRecords = found.slice(0, 50);
    pageRecords.reverse();
    return NextResponse.json({
      replies: pageRecords.map((reply) => publicReply(reply as unknown as Record<string, unknown>)),
      hasMore,
      nextCursor: hasMore && pageRecords.length ? String(pageRecords[0]._id) : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ replies: [], hasMore: false, nextCursor: null, error: "Replies are temporarily unavailable. Please try again." }, { status: 503 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { postId } = await context.params;
  if (!validPostId(postId)) {
    return NextResponse.json({ error: "That conversation identifier is invalid." }, { status: 400 });
  }
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  }
  if (!isJsonRequest(request)) {
    return NextResponse.json({ error: "Send your reply as JSON." }, { status: 415 });
  }
  if (!isMongoConfigured()) {
    return NextResponse.json({ error: "Replies are disabled until MongoDB is configured." }, { status: 503 });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body is invalid." }, { status: 400 });
  }
  if (!input || typeof input !== "object") {
    return NextResponse.json({ error: "Provide a reply and a location check." }, { status: 400 });
  }

  const values = input as Record<string, unknown>;
  const body = typeof values.body === "string" ? values.body.trim().replace(/\u0000/g, "") : "";
  const location = values.location as Partial<LocationInput> | undefined;

  if (body.length < 2 || body.length > 300) {
    return NextResponse.json({ error: "A reply must contain 2–300 characters." }, { status: 400 });
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
      { error: "A sufficiently accurate location check is required to reply here." },
      { status: 422 },
    );
  }

  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return NextResponse.json(
      { error: "The account service is temporarily unavailable. Please try again." },
      { status: 503 },
    );
  }
  if (!user) {
    return NextResponse.json({ error: "Sign in before replying to a local conversation." }, { status: 401 });
  }

  try {
    const db = await getDatabase();
    const userId = new ObjectId(user.id);
    const parentId = new ObjectId(postId);
    const now = new Date();
    const lastMinute = new Date(now.getTime() - 60_000);
    const lastDay = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const replies = db.collection("replies");
    const presenceAttempts = db.collection("presenceAttempts");

    const [parent, recentAttempts, dailyAttempts, recentReplies, dailyReplies] = await Promise.all([
      db.collection("posts").findOne({ _id: parentId, status: "visible" }),
      presenceAttempts.countDocuments({ userId, createdAt: { $gte: lastMinute } }),
      presenceAttempts.countDocuments({ userId, createdAt: { $gte: lastDay } }),
      replies.countDocuments({ authorId: userId, createdAt: { $gte: lastMinute } }),
      replies.countDocuments({ authorId: userId, createdAt: { $gte: lastDay } }),
    ]);

    if (!parent) {
      return NextResponse.json({ error: "That conversation is no longer available." }, { status: 404 });
    }
    if (recentAttempts >= 10 || dailyAttempts >= 50) {
      return NextResponse.json(
        { error: recentAttempts >= 10
          ? "Too many location checks. Please wait a minute before trying again."
          : "You've reached the prototype's daily location-check limit." },
        { status: 429 },
      );
    }
    if (recentReplies >= 5 || dailyReplies >= 50) {
      return NextResponse.json(
        { error: recentReplies >= 5
          ? "Please wait a moment before replying again."
          : "You've reached the prototype's daily reply limit." },
        { status: 429 },
      );
    }

    await presenceAttempts.insertOne({
      userId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 25 * 60 * 60 * 1000),
    });

    const placeKey = typeof parent.placeKey === "string" ? parent.placeKey : "";
    const place = await getCanonicalOsmPlace(db, placeKey);
    const currentCoordinates: [number, number] = [location.longitude, location.latitude];
    const isAreaGeometry = place.geojson.type === "Polygon" || place.geojson.type === "MultiPolygon";
    const radius = isAreaGeometry ? 0 : allowedRadius(place.kind);
    const distance = distanceToGeoJsonMeters(currentCoordinates, place.geojson);

    if (!Number.isFinite(distance)) {
      return NextResponse.json(
        { error: "This mapped place has no usable shape for a local presence check." },
        { status: 422 },
      );
    }

    const permittedDistance = radius + Math.min(location.accuracy, 25);
    if (distance > permittedDistance) {
      return NextResponse.json(
        { error: "You appear to be too far from this place to reply in LIVE HERE. Move closer to the mapped area and try again." },
        { status: 403 },
      );
    }

    const verifiedAt = new Date();
    const document = {
      postId: parentId,
      placeKey,
      placeName: place.name,
      body,
      authorId: userId,
      authorUsername: user.username,
      authorDisplayName: user.displayName,
      status: "visible",
      createdAt: verifiedAt,
      presenceVerifiedAt: verifiedAt,
      presenceMethod: "server-validated-osm-geometry-proximity",
      verificationGeometryType: place.geojson.type,
    };
    const inserted = await replies.insertOne(document);
    if (parent.authorId instanceof ObjectId && !parent.authorId.equals(userId)) {
      try {
        await createNotification(db, {
          recipientId: parent.authorId,
          actorId: userId,
          actorUsername: user.username,
          actorDisplayName: user.displayName,
          type: "reply",
          postId: parentId,
          placeKey,
          placeName: place.name,
          coordinates: place.coordinates,
          eventKey: `reply:${inserted.insertedId.toHexString()}`,
        });
      } catch (notificationError) {
        console.warn("[THE WORLD] Could not create reply notification:", notificationError);
      }
    }
    return NextResponse.json(
      { reply: publicReply({ ...document, _id: inserted.insertedId }) },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof PlaceLookupError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "We couldn't publish this reply. Check the database connection and try again." },
      { status: 503 },
    );
  }
}
