import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ username: string }>;
};

type PublicUserRecord = {
  _id: ObjectId;
  username: string;
  displayName?: string;
  bio?: string;
  createdAt?: Date | string;
};

function safeIso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

function validUsername(value: string): boolean {
  return /^[a-z0-9_]{3,20}$/.test(value);
}

export async function GET(_request: Request, context: RouteContext) {
  const { username: rawUsername } = await context.params;
  const username = typeof rawUsername === "string" ? rawUsername.trim().toLowerCase() : "";

  if (!validUsername(username)) {
    return NextResponse.json({ error: "That profile could not be found." }, { status: 404 });
  }
  if (!isMongoConfigured()) {
    return NextResponse.json({ error: "Public profiles are temporarily unavailable." }, { status: 503 });
  }

  try {
    const db = await getDatabase();
    const user = await db.collection<PublicUserRecord>("users").findOne(
      { username },
      {
        projection: {
          _id: 1,
          username: 1,
          displayName: 1,
          bio: 1,
          createdAt: 1,
        },
      },
    );

    if (!user || !(user._id instanceof ObjectId)) {
      return NextResponse.json({ error: "This profile does not exist." }, { status: 404 });
    }

    const userId = user._id;
    const [postCount, replyCount, recentPosts] = await Promise.all([
      db.collection("posts").countDocuments({ authorId: userId, status: "visible" }),
      db.collection("replies").countDocuments({ authorId: userId, status: "visible" }),
      db.collection("posts")
        .find({ authorId: userId, status: "visible" })
        .sort({ createdAt: -1 })
        .limit(25)
        .project({
          body: 1,
          type: 1,
          placeKey: 1,
          placeName: 1,
          placeDisplayName: 1,
          createdAt: 1,
          presenceVerifiedAt: 1,
          isRemoteQuestion: 1,
          replyCount: 1,
          images: 1,
        })
        .toArray(),
    ]);

    const posts = recentPosts.map((post) => {
      const id = post._id instanceof ObjectId ? post._id.toHexString() : String(post._id);
      const placeKey = typeof post.placeKey === "string" && /^(node|way|relation)-[1-9]\d{0,17}$/.test(post.placeKey)
        ? post.placeKey
        : "";
      return {
        id,
        body: typeof post.body === "string" ? post.body : "",
        type: typeof post.type === "string" ? post.type : "thought",
        placeKey,
        placeName: typeof post.placeDisplayName === "string" && post.placeDisplayName
          ? post.placeDisplayName
          : typeof post.placeName === "string" ? post.placeName : "A mapped place",
        createdAt: safeIso(post.createdAt),
        presenceVerifiedAt: post.presenceVerifiedAt instanceof Date
          ? post.presenceVerifiedAt.toISOString()
          : null,
        isRemoteQuestion: post.isRemoteQuestion === true,
        replyCount: typeof post.replyCount === "number" ? post.replyCount : 0,
        images: Array.isArray(post.images)
          ? post.images.map((image) => String(image)).filter((id) => /^[a-f\d]{24}$/i.test(id)).slice(0, 3).map((id) => ({ id, url: `/api/uploads/${id}` }))
          : [],
      };
    });

    return NextResponse.json({
      profile: {
        username: user.username,
        displayName: typeof user.displayName === "string" && user.displayName.trim()
          ? user.displayName.trim()
          : user.username,
        bio: typeof user.bio === "string" ? user.bio : "",
        createdAt: safeIso(user.createdAt),
      },
      stats: { posts: postCount, replies: replyCount },
      posts,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "We couldn't load this profile. Please try again." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
