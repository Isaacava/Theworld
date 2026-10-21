import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

export async function GET() {
  if (!isMongoConfigured()) return NextResponse.json({ bookmarks: [] }, { status: 503 });
  let user;
  try { user = await getCurrentUser(); } catch {
    return NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 });
  }
  if (!user) return NextResponse.json({ error: "Sign in to view your saved posts." }, { status: 401 });

  try {
    const db = await getDatabase();
    const userId = new ObjectId(user.id);
    const saved = await db.collection("bookmarks").find({ userId }).sort({ createdAt: -1 }).limit(50).toArray();
    if (!saved.length) return NextResponse.json({ bookmarks: [] }, { headers: { "Cache-Control": "no-store" } });

    const postIds = saved.map((item) => item.postId).filter((id) => id instanceof ObjectId);
    const posts = await db.collection("posts").find({ _id: { $in: postIds }, status: "visible" }).toArray();
    const placeKeys = [...new Set(posts.map((post) => String(post.placeKey ?? "")).filter(Boolean))];
    const ids = posts.map((post) => post._id);
    const [communities, likeGroups, replyGroups] = await Promise.all([
      placeKeys.length ? db.collection("communities").find({ placeKey: { $in: placeKeys } }).project({ placeKey: 1, coordinates: 1, displayName: 1 }).toArray() : Promise.resolve([]),
      ids.length ? db.collection("postLikes").aggregate([{ $match: { postId: { $in: ids } } }, { $group: { _id: "$postId", count: { $sum: 1 } } }]).toArray() : Promise.resolve([]),
      ids.length ? db.collection("replies").aggregate([{ $match: { postId: { $in: ids }, status: "visible" } }, { $group: { _id: "$postId", count: { $sum: 1 } } }]).toArray() : Promise.resolve([]),
    ]);

    const postMap = new Map(posts.map((post) => [String(post._id), post]));
    const communityMap = new Map(communities.map((community: { placeKey: string }) => [community.placeKey, community]));
    const likeMap = new Map<string, number>(likeGroups.map((entry: { _id: ObjectId; count: number }) => [String(entry._id), Number(entry.count)]));
    const replyMap = new Map<string, number>(replyGroups.map((entry: { _id: ObjectId; count: number }) => [String(entry._id), Number(entry.count)]));

    const bookmarks = saved.flatMap((item) => {
      const post = postMap.get(String(item.postId));
      if (!post) return [];
      const community = communityMap.get(String(post.placeKey ?? "")) as { coordinates?: unknown; displayName?: string } | undefined;
      const coordinates = Array.isArray(community?.coordinates) && community.coordinates.length === 2 &&
        community.coordinates.every((n: unknown) => typeof n === "number" && Number.isFinite(n)) ? community.coordinates : null;
      return [{
        id: String(item._id),
        savedAt: iso(item.createdAt),
        post: {
          id: String(post._id),
          body: String(post.body ?? ""),
          type: String(post.type ?? "thought"),
          placeKey: String(post.placeKey ?? ""),
          placeName: String(post.placeName ?? "Unknown place"),
          placeDisplayName: String(community?.displayName ?? post.placeDisplayName ?? post.placeName ?? "Unknown place"),
          coordinates,
          author: { username: String(post.authorUsername ?? "unknown"), displayName: String(post.authorDisplayName ?? post.authorUsername ?? "unknown") },
          createdAt: iso(post.createdAt),
          likesCount: likeMap.get(String(post._id)) ?? 0,
          replyCount: replyMap.get(String(post._id)) ?? 0,
        },
      }];
    });
    return NextResponse.json({ bookmarks }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Saved posts are temporarily unavailable." }, { status: 503 });
  }
}
