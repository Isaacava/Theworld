import { MongoServerError, ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasSameOrigin, isJsonRequest } from "@/lib/http";
import { createNotification } from "@/lib/notifications";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ postId: string }> };
type Action = "like" | "unlike" | "bookmark" | "unbookmark";
const validPostId = (value: string) => /^[a-f\d]{24}$/i.test(value);
function placeCoordinates(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [longitude, latitude] = value;
  if (typeof longitude !== "number" || !Number.isFinite(longitude) ||
      typeof latitude !== "number" || !Number.isFinite(latitude) ||
      longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
  return [longitude, latitude];
}

export async function POST(request: Request, context: RouteContext) {
  const { postId } = await context.params;
  if (!validPostId(postId)) return NextResponse.json({ error: "That post identifier is invalid." }, { status: 400 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Send a post action as JSON." }, { status: 415 });
  if (!isMongoConfigured()) return NextResponse.json({ error: "Post interactions are unavailable until MongoDB is configured." }, { status: 503 });

  let values: Record<string, unknown>;
  try {
    const input: unknown = await request.json();
    if (!input || typeof input !== "object") return NextResponse.json({ error: "Choose a valid post action." }, { status: 400 });
    values = input as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "The request body is invalid." }, { status: 400 });
  }
  const action = values.action;
  if (action !== "like" && action !== "unlike" && action !== "bookmark" && action !== "unbookmark") {
    return NextResponse.json({ error: "Choose like, unlike, bookmark, or unbookmark." }, { status: 400 });
  }

  let user;
  try { user = await getCurrentUser(); } catch {
    return NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 });
  }
  if (!user) return NextResponse.json({ error: "Sign in to like or save posts." }, { status: 401 });

  try {
    const db = await getDatabase();
    const userId = new ObjectId(user.id);
    const postObjectId = new ObjectId(postId);
    const post = await db.collection("posts").findOne({ _id: postObjectId, status: "visible" });
    if (!post) return NextResponse.json({ error: "That post is no longer available." }, { status: 404 });

    if (action === "unlike") {
      await db.collection("postLikes").deleteOne({ postId: postObjectId, userId });
    } else if (action === "like") {
      try {
        const result = await db.collection("postLikes").updateOne(
          { postId: postObjectId, userId },
          { $setOnInsert: { postId: postObjectId, userId, createdAt: new Date() } },
          { upsert: true },
        );
        if (result.upsertedId && post.authorId instanceof ObjectId && !post.authorId.equals(userId)) {
          try {
            const community = await db.collection("communities").findOne(
              { placeKey: post.placeKey }, { projection: { coordinates: 1 } },
            );
            await createNotification(db, {
              recipientId: post.authorId,
              actorId: userId,
              actorUsername: user.username,
              actorDisplayName: user.displayName,
              type: "like",
              postId: postObjectId,
              placeKey: String(post.placeKey ?? ""),
              placeName: String(post.placeName ?? "a place"),
              coordinates: placeCoordinates(community?.coordinates),
              eventKey: `like:${String(result.upsertedId)}`,
            });
          } catch (error) {
            console.warn("[THE WORLD] Could not create like notification:", error);
          }
        }
      } catch (error) {
        if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
      }
    } else if (action === "bookmark") {
      try {
        await db.collection("bookmarks").updateOne(
          { postId: postObjectId, userId },
          { $setOnInsert: { postId: postObjectId, userId, createdAt: new Date() } },
          { upsert: true },
        );
      } catch (error) {
        if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
      }
    } else {
      await db.collection("bookmarks").deleteOne({ postId: postObjectId, userId });
    }

    const [likesCount, liked, bookmarked] = await Promise.all([
      db.collection("postLikes").countDocuments({ postId: postObjectId }),
      db.collection("postLikes").findOne({ postId: postObjectId, userId }, { projection: { _id: 1 } }),
      db.collection("bookmarks").findOne({ postId: postObjectId, userId }, { projection: { _id: 1 } }),
    ]);
    return NextResponse.json({
      success: true, likesCount, isLiked: Boolean(liked), isBookmarked: Boolean(bookmarked),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "We couldn't update that post. Please try again." }, { status: 503 });
  }
}
