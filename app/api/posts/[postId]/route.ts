import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasSameOrigin, isJsonRequest } from "@/lib/http";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";
import { getCanonicalOsmPlaceMetadata, PlaceLookupError } from "@/lib/osm-place";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ postId: string }> };
const ID = /^[a-f\d]{24}$/i;

function publicPost(doc: Record<string, unknown>, extras: Record<string, unknown> = {}) {
  const date = doc.createdAt instanceof Date ? doc.createdAt : new Date(String(doc.createdAt));
  return {
    id: String(doc._id),
    body: String(doc.body ?? ""),
    type: String(doc.type ?? "thought"),
    placeKey: String(doc.placeKey ?? ""),
    placeName: String(doc.placeName ?? ""),
    author: { username: String(doc.authorUsername ?? "member"), displayName: String(doc.authorDisplayName ?? doc.authorUsername ?? "Member") },
    createdAt: Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString(),
    editedAt: doc.editedAt instanceof Date ? doc.editedAt.toISOString() : null,
    presenceVerifiedAt: doc.presenceVerifiedAt instanceof Date ? doc.presenceVerifiedAt.toISOString() : null,
    isRemoteQuestion: doc.isRemoteQuestion === true,
    taggedBusinesses: Array.isArray(doc.taggedBusinesses) ? doc.taggedBusinesses : [],
    images: Array.isArray(doc.images) ? doc.images.map((image) => String(image)).filter((id) => /^[a-f\d]{24}$/i.test(id)).slice(0, 3).map((id) => ({ id, url: `/api/uploads/${id}` })) : [],
    replyCount: typeof extras.replyCount === "number" ? extras.replyCount : 0,
    likesCount: typeof extras.likesCount === "number" ? extras.likesCount : 0,
    isLiked: extras.isLiked === true,
    isBookmarked: extras.isBookmarked === true,
  };
}

export async function GET(_request: Request, context: RouteContext) {
  const { postId } = await context.params;
  if (!ID.test(postId)) return NextResponse.json({ error: "That conversation identifier is invalid." }, { status: 400 });
  if (!isMongoConfigured()) return NextResponse.json({ error: "Community storage is unavailable." }, { status: 503 });
  try {
    const db = await getDatabase();
    const [viewer, post] = await Promise.all([
      getCurrentUser().catch(() => null),
      db.collection("posts").findOne({ _id: new ObjectId(postId), status: "visible" }),
    ]);
    if (!post) return NextResponse.json({ error: "That conversation could not be found." }, { status: 404 });
    const oid = new ObjectId(postId);
    const [replyCount, likesCount, liked, bookmarked, community] = await Promise.all([
      db.collection("replies").countDocuments({ postId: oid, status: "visible" }),
      db.collection("postLikes").countDocuments({ postId: oid }),
      viewer ? db.collection("postLikes").findOne({ postId: oid, userId: new ObjectId(viewer.id) }, { projection: { _id: 1 } }) : Promise.resolve(null),
      viewer ? db.collection("bookmarks").findOne({ postId: oid, userId: new ObjectId(viewer.id) }, { projection: { _id: 1 } }) : Promise.resolve(null),
      db.collection("communities").findOne({ placeKey: post.placeKey }, { projection: { coordinates: 1, displayName: 1, kind: 1, name: 1 } }),
    ]);
    let place = null;
    try {
      if (typeof post.placeKey === "string") place = await getCanonicalOsmPlaceMetadata(db, post.placeKey);
    } catch (error) {
      if (!(error instanceof PlaceLookupError)) throw error;
    }
    return NextResponse.json({
      post: publicPost(post as unknown as Record<string, unknown>, { replyCount, likesCount, isLiked: Boolean(liked), isBookmarked: Boolean(bookmarked) }),
      place: place ? { id: place.placeKey, name: place.name, subtitle: place.displayName.split(",").slice(1,3).join(",").trim(), displayName: place.displayName, kind: place.kind, coordinates: place.coordinates } : {
        id: String(post.placeKey ?? ""),
        name: String(post.placeName ?? "Mapped place"),
        subtitle: "",
        displayName: String(community?.displayName ?? post.placeName ?? "Mapped place"),
        kind: String(community?.kind ?? "Mapped place"),
        coordinates: Array.isArray(community?.coordinates) ? community.coordinates : null,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "That conversation is temporarily unavailable." }, { status: 503 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { postId } = await context.params;
  if (!ID.test(postId)) return NextResponse.json({ error: "That conversation identifier is invalid." }, { status: 400 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Send the post update as JSON." }, { status: 415 });
  if (!isMongoConfigured()) return NextResponse.json({ error: "Post editing is unavailable." }, { status: 503 });
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "The request body is invalid." }, { status: 400 }); }
  const body = input && typeof input === "object" && typeof (input as Record<string, unknown>).body === "string"
    ? ((input as Record<string, unknown>).body as string).trim().replace(/\u0000/g, "") : "";
  if (body.length < 2 || body.length > 500) return NextResponse.json({ error: "A post must contain 2–500 characters." }, { status: 400 });
  let user;
  try { user = await getCurrentUser(); } catch { return NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 }); }
  if (!user) return NextResponse.json({ error: "Sign in to edit your post." }, { status: 401 });
  try {
    const result = await (await getDatabase()).collection("posts").updateOne(
      { _id: new ObjectId(postId), authorId: new ObjectId(user.id), status: "visible" },
      { $set: { body, editedAt: new Date(), updatedAt: new Date() } },
    );
    if (!result.matchedCount) return NextResponse.json({ error: "Only the author can edit a visible post." }, { status: 403 });
    return NextResponse.json({ success: true, body, editedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "We couldn't save this edit. Please try again." }, { status: 503 }); }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { postId } = await context.params;
  if (!ID.test(postId)) return NextResponse.json({ error: "That conversation identifier is invalid." }, { status: 400 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  if (!isMongoConfigured()) return NextResponse.json({ error: "Post deletion is unavailable." }, { status: 503 });
  let user;
  try { user = await getCurrentUser(); } catch { return NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 }); }
  if (!user) return NextResponse.json({ error: "Sign in to delete your post." }, { status: 401 });
  try {
    const now = new Date();
    const result = await (await getDatabase()).collection("posts").updateOne(
      { _id: new ObjectId(postId), authorId: new ObjectId(user.id), status: "visible" },
      { $set: { status: "deleted", deletedAt: now, deletedBy: new ObjectId(user.id) } },
    );
    if (!result.matchedCount) return NextResponse.json({ error: "Only the author can delete a visible post." }, { status: 403 });
    return NextResponse.json({ success: true, message: "Post deleted." }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "We couldn't delete this post. Please try again." }, { status: 503 }); }
}
