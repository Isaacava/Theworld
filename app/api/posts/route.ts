import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasSameOrigin, isJsonRequest } from "@/lib/http";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";
import { allowedRadius, validCoordinates } from "@/lib/location-check";
import { distanceToGeoJsonMeters } from "@/lib/place-geometry.mjs";
import { getCanonicalOsmPlace, PlaceLookupError } from "@/lib/osm-place";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OSM_PLACE_KEY = /^(node|way|relation)-[1-9]\d{0,17}$/;
const POST_TYPES = new Set(["thought", "question", "discovery", "update"]);

type LocationInput = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

type PlaceKeyInput = {
  placeKey: string;
};

function publicPost(document: Record<string, unknown>) {
  const createdAt = document.createdAt instanceof Date
    ? document.createdAt.toISOString()
    : new Date(String(document.createdAt)).toISOString();

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
    createdAt,
    presenceVerifiedAt: document.presenceVerifiedAt instanceof Date
      ? document.presenceVerifiedAt.toISOString()
      : null,
    replyCount: typeof document.replyCount === "number" ? document.replyCount : 0,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const placeKey = url.searchParams.get("placeKey") || "";
  if (!OSM_PLACE_KEY.test(placeKey)) {
    return NextResponse.json({
      posts: [],
      configured: isMongoConfigured(),
      message: "Choose a named mapped place to view its live community.",
    });
  }
  if (!isMongoConfigured()) {
    return NextResponse.json(
      {
        posts: [],
        configured: false,
        message: "Community storage is not connected yet. Configure MongoDB to enable persistent posts.",
      },
      { status: 503 },
    );
  }

  try {
    const db = await getDatabase();
    const documents = await db.collection("posts")
      .aggregate([
        { $match: { placeKey, status: "visible" } },
        { $sort: { createdAt: -1 } },
        { $limit: 30 },
        {
          $lookup: {
            from: "replies",
            localField: "_id",
            foreignField: "postId",
            pipeline: [{ $match: { status: "visible" } }, { $project: { _id: 1 } }],
            as: "replyRecords",
          },
        },
        { $addFields: { replyCount: { $size: "$replyRecords" } } },
        {
          $project: {
            replyRecords: 0,
            body: 1,
            type: 1,
            placeKey: 1,
            placeName: 1,
            authorUsername: 1,
            authorDisplayName: 1,
            createdAt: 1,
            presenceVerifiedAt: 1,
            replyCount: 1,
          },
        },
      ])
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
    return NextResponse.json(
      { error: "Posting is disabled until MongoDB is configured." },
      { status: 503 },
    );
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
  const placeInput = values.place as Partial<PlaceKeyInput> | undefined;
  const location = values.location as Partial<LocationInput> | undefined;
  const placeKey = typeof placeInput?.placeKey === "string" ? placeInput.placeKey : "";

  if (!OSM_PLACE_KEY.test(placeKey)) {
    return NextResponse.json(
      { error: "Posts must be attached to a named mapped place." },
      { status: 400 },
    );
  }
  if (body.length < 2 || body.length > 500) {
    return NextResponse.json({ error: "A post must contain 2–500 characters." }, { status: 400 });
  }
  if (!POST_TYPES.has(type)) {
    return NextResponse.json({ error: "Choose a valid post type." }, { status: 400 });
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
    return NextResponse.json({ error: "Sign in before posting to a local community." }, { status: 401 });
  }

  try {
    const db = await getDatabase();
    const userId = new ObjectId(user.id);
    const now = new Date();
    const lastMinute = new Date(now.getTime() - 60_000);
    const lastDay = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const posts = db.collection("posts");
    const presenceAttempts = db.collection("presenceAttempts");

    // Rate-limit attempts as well as successful posts, so arbitrary map IDs
    // cannot be used to generate unlimited external geocoder lookups.
    const [recentAttempts, dailyAttempts, recentPosts, dailyPosts] = await Promise.all([
      presenceAttempts.countDocuments({ userId, createdAt: { $gte: lastMinute } }),
      presenceAttempts.countDocuments({ userId, createdAt: { $gte: lastDay } }),
      posts.countDocuments({ authorId: userId, createdAt: { $gte: lastMinute } }),
      posts.countDocuments({ authorId: userId, createdAt: { $gte: lastDay } }),
    ]);

    if (recentAttempts >= 10 || dailyAttempts >= 50) {
      return NextResponse.json(
        { error: recentAttempts >= 10
          ? "Too many location checks. Please wait a minute before trying again."
          : "You've reached the prototype's daily location-check limit." },
        { status: 429 },
      );
    }
    if (recentPosts >= 3 || dailyPosts >= 25) {
      return NextResponse.json(
        { error: recentPosts >= 3
          ? "Please wait a moment before posting again."
          : "You've reached the prototype's daily posting limit." },
        { status: 429 },
      );
    }

    await presenceAttempts.insertOne({
      userId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 25 * 60 * 60 * 1000),
    });

    // Crucially, do not trust name, type, centre coordinates, or geometry sent
    // by the browser. Resolve the OSM ID on the server and use canonical data.
    const place = await getCanonicalOsmPlace(db, placeKey);
    const currentCoordinates: [number, number] = [location.longitude, location.latitude];
    const isAreaGeometry = place.geojson.type === "Polygon" || place.geojson.type === "MultiPolygon";
    // Polygon interiors already represent the allowed area. Do not allow the
    // broad "city radius" outside an area's mapped boundary.
    const radius = isAreaGeometry ? 0 : allowedRadius(place.kind);
    let distanceMeters: number;

    try {
      distanceMeters = distanceToGeoJsonMeters(currentCoordinates, place.geojson);
    } catch {
      return NextResponse.json(
        { error: "We couldn't verify the mapped shape of this place. Choose another mapped location." },
        { status: 422 },
      );
    }

    if (!Number.isFinite(distanceMeters)) {
      return NextResponse.json(
        { error: "This mapped place has no usable geometry for a local presence check." },
        { status: 422 },
      );
    }

    // GPS accuracy is an uncertainty estimate. A small, capped allowance helps
    // with normal device error without letting a claimed 100 m accuracy expand
    // the permitted area without bound.
    const permittedDistance = radius + Math.min(location.accuracy, 25);
    if (distanceMeters > permittedDistance) {
      return NextResponse.json(
        { error: "You appear to be too far from this place to post in LIVE HERE. Move closer to the mapped area and try again." },
        { status: 403 },
      );
    }

    const presenceVerifiedAt = new Date();
    await db.collection("communities").updateOne(
      { placeKey },
      {
        $setOnInsert: {
          placeKey,
          name: place.name,
          displayName: place.displayName,
          kind: place.kind,
          coordinates: place.coordinates,
          createdAt: presenceVerifiedAt,
        },
        $set: {
          lastActiveAt: presenceVerifiedAt,
          name: place.name,
          displayName: place.displayName,
          kind: place.kind,
          coordinates: place.coordinates,
        },
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
      createdAt: presenceVerifiedAt,
      presenceVerifiedAt,
      presenceMethod: "server-validated-osm-geometry-proximity",
      verificationRadiusMeters: radius,
      verificationGeometryType: place.geojson.type,
    };
    const result = await posts.insertOne(document);
    return NextResponse.json(
      { post: publicPost({ ...document, _id: result.insertedId }) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof PlaceLookupError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "We couldn't publish this post. Check the database connection and try again." },
      { status: 503 },
    );
  }
}
