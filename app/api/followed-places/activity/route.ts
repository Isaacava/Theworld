import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isMongoConfigured()) return NextResponse.json({ activity: [], error: "Followed activity is unavailable." }, { status: 503 });
  let user;
  try { user = await getCurrentUser(); } catch { return NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 }); }
  if (!user) return NextResponse.json({ error: "Sign in to see followed-community activity." }, { status: 401 });
  try {
    const db = await getDatabase();
    const userId = new ObjectId(user.id);
    const follows = await db.collection("followedPlaces").find({ userId }).sort({ followedAt: -1 }).limit(100).toArray();
    if (!follows.length) return NextResponse.json({ activity: [], places: [] }, { headers: { "Cache-Control": "no-store" } });
    const keys = follows.map((item) => String(item.placeKey));
    const docs = await db.collection("posts").aggregate([
      { $match: { placeKey: { $in: keys }, status: "visible" } },
      { $sort: { _id: -1 } },
      { $limit: 30 },
      { $lookup: { from: "replies", localField: "_id", foreignField: "postId", pipeline: [{ $match: { status: "visible" } }, { $project: { _id: 1 } }], as: "replyRecords" } },
      { $addFields: { replyCount: { $size: "$replyRecords" } } },
      { $project: { body: 1, type: 1, placeKey: 1, placeName: 1, authorUsername: 1, authorDisplayName: 1, createdAt: 1, replyCount: 1, isRemoteQuestion: 1, taggedBusinesses: 1 } },
    ]).toArray();
    const placeMap = new Map(follows.map((item) => [String(item.placeKey), {
      placeKey: String(item.placeKey), name: String(item.name ?? "Mapped place"), displayName: String(item.displayName ?? item.name ?? "Mapped place"),
      coordinates: Array.isArray(item.coordinates) ? item.coordinates : null,
    }]));
    return NextResponse.json({
      places: [...placeMap.values()],
      activity: docs.map((doc) => ({
        id: String(doc._id), body: String(doc.body ?? ""), type: String(doc.type ?? "thought"),
        placeKey: String(doc.placeKey ?? ""), placeName: String(doc.placeName ?? "Mapped place"),
        author: { username: String(doc.authorUsername ?? "member"), displayName: String(doc.authorDisplayName ?? doc.authorUsername ?? "Member") },
        createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : new Date(String(doc.createdAt)).toISOString(),
        replyCount: Number(doc.replyCount ?? 0), isRemoteQuestion: doc.isRemoteQuestion === true,
        taggedBusinesses: Array.isArray(doc.taggedBusinesses) ? doc.taggedBusinesses : [],
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ activity: [], error: "We couldn't load followed-community activity." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
