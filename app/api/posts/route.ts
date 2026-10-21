import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasSameOrigin, isJsonRequest } from "@/lib/http";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";
import { allowedRadius, validCoordinates } from "@/lib/location-check";
import { distanceToGeoJsonMeters } from "@/lib/place-geometry.mjs";
import { getCanonicalOsmPlace, getCanonicalOsmPlaceMetadata, PlaceLookupError } from "@/lib/osm-place";
import { createNotification } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OSM_PLACE_KEY = /^(node|way|relation)-[1-9]\d{0,17}$/;
const POST_TYPES = new Set(["thought", "question", "discovery", "update"]);

type LocationInput = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

function isValidLocationInput(value: Partial<LocationInput> | undefined): value is LocationInput {
  return Boolean(
    value &&
    typeof value.latitude === "number" &&
    typeof value.longitude === "number" &&
    typeof value.accuracy === "number" &&
    validCoordinates(value.longitude, value.latitude) &&
    Number.isFinite(value.accuracy) &&
    value.accuracy > 0 &&
    value.accuracy <= 100
  );
}

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
    isRemoteQuestion: document.isRemoteQuestion === true,
    replyCount: typeof document.replyCount === "number" ? document.replyCount : 0,
    likesCount: typeof document.likesCount === "number" ? document.likesCount : 0,
    isLiked: document.isLiked === true,
    isBookmarked: document.isBookmarked === true,
    taggedBusinesses: Array.isArray(document.taggedBusinesses)
      ? document.taggedBusinesses.filter((item): item is { businessId: string; name: string } => Boolean(item && typeof item === "object" && typeof (item as { businessId?: unknown }).businessId === "string" && typeof (item as { name?: unknown }).name === "string")).slice(0, 3)
      : [],
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const placeKey = url.searchParams.get("placeKey") || "";
  const requestedType = url.searchParams.get("type") || "";
  const unansweredOnly = url.searchParams.get("unanswered") === "1";
  const before = url.searchParams.get("before") || "";
  if (!OSM_PLACE_KEY.test(placeKey)) {
    return NextResponse.json({ posts: [], totalCount: 0, hasMore: false, nextCursor: null, configured: isMongoConfigured(), message: "Choose a named mapped place to view its live community." });
  }
  if (requestedType && !POST_TYPES.has(requestedType)) return NextResponse.json({ error: "Choose a valid conversation filter." }, { status: 400 });
  if (before && !/^[a-f\d]{24}$/i.test(before)) return NextResponse.json({ error: "That feed cursor is invalid." }, { status: 400 });
  if (!isMongoConfigured()) return NextResponse.json({ posts: [], totalCount: 0, hasMore: false, nextCursor: null, configured: false, message: "Community storage is not connected yet. Configure MongoDB to enable persistent posts." }, { status: 503 });

  try {
    const db = await getDatabase();
    const viewer = await getCurrentUser().catch(() => null);
    const viewerId = viewer ? new ObjectId(viewer.id) : null;
    const pipeline: Record<string, unknown>[] = [
      { $match: { placeKey, status: "visible" } },
      { $lookup: {
        from: "replies",
        localField: "_id",
        foreignField: "postId",
        pipeline: [{ $match: { status: "visible" } }, { $project: { _id: 1 } }],
        as: "replyRecords",
      } },
      { $addFields: { replyCount: { $size: "$replyRecords" } } },
    ];
    if (requestedType) pipeline.push({ $match: { type: requestedType } });
    if (unansweredOnly) pipeline.push({ $match: { type: "question", replyCount: 0 } });
    const itemStages: Record<string, unknown>[] = [];
    if (before) itemStages.push({ $match: { _id: { $lt: new ObjectId(before) } } });
    itemStages.push(
      { $sort: { _id: -1 } },
      { $limit: 31 },
      { $project: { body: 1, type: 1, placeKey: 1, placeName: 1, authorUsername: 1, authorDisplayName: 1, createdAt: 1, presenceVerifiedAt: 1, isRemoteQuestion: 1, replyCount: 1, taggedBusinesses: 1 } },
    );
    pipeline.push({ $facet: { items: itemStages, total: [{ $count: "count" }] } });
    const aggregated = await db.collection("posts").aggregate(pipeline).toArray();
    const facet = aggregated[0] as { items?: Record<string, unknown>[]; total?: { count?: number }[] } | undefined;
    const fetched = facet?.items ?? [];
    const hasMore = fetched.length > 30;
    const documents = fetched.slice(0, 30);
    const totalCount = Number(facet?.total?.[0]?.count ?? 0);

    const postIds = documents.map((document) => document._id).filter((value): value is ObjectId => value instanceof ObjectId);
    const [likeGroups, viewerLikes, viewerBookmarks] = await Promise.all([
      postIds.length ? db.collection("postLikes").aggregate([
        { $match: { postId: { $in: postIds } } },
        { $group: { _id: "$postId", count: { $sum: 1 } } },
      ]).toArray() : Promise.resolve([]),
      viewerId && postIds.length ? db.collection("postLikes").find({ postId: { $in: postIds }, userId: viewerId }).project({ postId: 1 }).toArray() : Promise.resolve([]),
      viewerId && postIds.length ? db.collection("bookmarks").find({ postId: { $in: postIds }, userId: viewerId }).project({ postId: 1 }).toArray() : Promise.resolve([]),
    ]);
    const likeCounts = new Map<string, number>(likeGroups.map((row) => {
      const record = row as unknown as { _id: ObjectId; count: number };
      return [String(record._id), Number(record.count)] as [string, number];
    }));
    const liked = new Set(viewerLikes.map((row) => String((row as unknown as { postId: ObjectId }).postId)));
    const bookmarked = new Set(viewerBookmarks.map((row) => String((row as unknown as { postId: ObjectId }).postId)));
    const posts = documents.map((document) => {
      const id = String(document._id);
      return publicPost({
        ...document,
        likesCount: likeCounts.get(id) ?? 0,
        isLiked: liked.has(id),
        isBookmarked: bookmarked.has(id),
      });
    });
    return NextResponse.json({
      configured: true,
      posts,
      totalCount,
      hasMore,
      nextCursor: hasMore && documents.length ? String(documents[documents.length - 1]._id) : null,
      filters: { type: requestedType || "all", unanswered: unansweredOnly },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ posts: [], totalCount: 0, hasMore: false, nextCursor: null, configured: true, message: "The community feed is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
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
  const rawBusinessIds = Array.isArray(values.businessIds) ? values.businessIds : [];
  const isRemoteQuestion = type === "question" && values.isRemoteQuestion === true;
  const verifiedLocation = isValidLocationInput(location) ? location : null;
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
  if (!isRemoteQuestion && !verifiedLocation) {
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

    if (!isRemoteQuestion && (recentAttempts >= 10 || dailyAttempts >= 50)) {
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

    if (!isRemoteQuestion) {
      await presenceAttempts.insertOne({
        userId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 25 * 60 * 60 * 1000),
      });
    }

    // Remote questions need a real place identity, but must not need a full
    // city polygon just to ask for local knowledge. Presence-verified posts
    // always use the canonical geometry path.
    const placeMetadata = isRemoteQuestion
      ? await getCanonicalOsmPlaceMetadata(db, placeKey)
      : null;
    const canonicalPlace = isRemoteQuestion
      ? null
      : await getCanonicalOsmPlace(db, placeKey);
    const placeName = placeMetadata?.name ?? canonicalPlace!.name;
    const placeDisplayName = placeMetadata?.displayName ?? canonicalPlace!.displayName;
    const placeKind = placeMetadata?.kind ?? canonicalPlace!.kind;
    const placeCoordinates = placeMetadata?.coordinates ?? canonicalPlace!.coordinates;
    let presenceVerifiedAt: Date | null = null;
    let radius = 0;

    if (!isRemoteQuestion) {
      if (!verifiedLocation) {
        return NextResponse.json(
          { error: "A sufficiently accurate location check is required." },
          { status: 422 },
        );
      }
      const currentCoordinates: [number, number] = [verifiedLocation.longitude, verifiedLocation.latitude];
      const place = canonicalPlace!;
      const isAreaGeometry = place.geojson.type === "Polygon" || place.geojson.type === "MultiPolygon";
      // Polygon interiors already represent the allowed area. Do not allow the
      // broad "city radius" outside an area's mapped boundary.
      radius = isAreaGeometry ? 0 : allowedRadius(place.kind);
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

      const permittedDistance = radius + Math.min(verifiedLocation.accuracy, 25);
      if (distanceMeters > permittedDistance) {
        return NextResponse.json(
          { error: "You appear to be too far from this place to post in LIVE HERE. Use Ask Locals if you want to enquire from elsewhere." },
          { status: 403 },
        );
      }

      presenceVerifiedAt = new Date();
    }
    await db.collection("communities").updateOne(
      { placeKey },
      {
        // Keep each update path in only one operator. MongoDB rejects paths
        // such as "name" appearing in both $setOnInsert and $set.
        $setOnInsert: {
          placeKey,
          createdAt: now,
        },
        $set: {
          lastActiveAt: now,
          name: placeName,
          displayName: placeDisplayName,
          kind: placeKind,
          coordinates: placeCoordinates,
        },
      },
      { upsert: true },
    );

    if (rawBusinessIds.length > 3) {
      return NextResponse.json({ error: "Tag no more than three verified businesses in a post." }, { status: 400 });
    }
    const businessIds = [...new Set(rawBusinessIds.filter((value): value is string => typeof value === "string"))];
    if (businessIds.some((id) => !/^[a-f\d]{24}$/i.test(id))) {
      return NextResponse.json({ error: "Choose valid verified business tags." }, { status: 400 });
    }
    let taggedBusinesses: { businessId: string; name: string }[] = [];
    if (businessIds.length) {
      const businessDocs = await db.collection("businesses").find({
        _id: { $in: businessIds.map((id) => new ObjectId(id)) },
        placeKey,
        status: "verified",
        verificationStatus: "verified",
      }).project({ name: 1 }).toArray();
      if (businessDocs.length !== businessIds.length) {
        return NextResponse.json({ error: "Only verified businesses listed for this community can be tagged." }, { status: 422 });
      }
      taggedBusinesses = businessDocs.map((doc) => ({ businessId: String(doc._id), name: String(doc.name ?? "Local business") }));
    }
    const document = {
      placeKey,
      placeName,
      placeDisplayName,
      taggedBusinesses,
      body,
      type,
      authorId: userId,
      authorUsername: user.username,
      authorDisplayName: user.displayName,
      status: "visible",
      createdAt: now,
      presenceVerifiedAt,
      isRemoteQuestion,
      presenceMethod: isRemoteQuestion ? "remote-question" : "server-validated-osm-geometry-proximity",
      verificationRadiusMeters: isRemoteQuestion ? null : radius,
      verificationGeometryType: canonicalPlace?.geojson.type ?? null,
    };
    const result = await posts.insertOne(document);
    // New posts in a followed community notify its followers. Notification
    // failures never roll back the successful post.
    try {
      const followers = await db.collection("followedPlaces")
        .find({ placeKey, userId: { $ne: userId } })
        .project({ userId: 1 })
        .limit(500)
        .toArray();
      await Promise.allSettled(followers.filter((row) => row.userId instanceof ObjectId).map((row) => createNotification(db, {
        recipientId: row.userId as ObjectId,
        actorId: userId,
        actorUsername: user.username,
        actorDisplayName: user.displayName,
        type: "new_post",
        postId: result.insertedId,
        placeKey,
        placeName,
        coordinates: placeCoordinates,
        eventKey: `new-post:${String(result.insertedId)}:${String(row.userId)}`,
      })));
    } catch (notificationError) {
      console.warn("[THE WORLD] Could not notify community followers of new post:", notificationError);
    }
    return NextResponse.json(
      { post: publicPost({ ...document, _id: result.insertedId }) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof PlaceLookupError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(
      "[posts] Failed to publish a community post",
      error instanceof Error ? { name: error.name, message: error.message } : "Unknown error",
    );
    return NextResponse.json(
      { error: "We couldn't publish this post. Please try again. If the problem continues, try another mapped place." },
      { status: 503 },
    );
  }
}
