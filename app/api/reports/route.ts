import { MongoServerError, ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasSameOrigin, isJsonRequest } from "@/lib/http";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES = new Set(["post", "reply"]);
const VALID_REASONS = new Set(["spam", "harassment", "misinformation", "unsafe", "privacy", "other"]);
const OBJECT_ID = /^[a-f\d]{24}$/i;

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Send the report as JSON." }, { status: 415 });
  if (!isMongoConfigured()) return NextResponse.json({ error: "Reporting is temporarily unavailable." }, { status: 503 });

  let input: unknown;
  try { input = await request.json(); } catch {
    return NextResponse.json({ error: "The request body is invalid." }, { status: 400 });
  }
  if (!input || typeof input !== "object") return NextResponse.json({ error: "Choose content and a reason for reporting it." }, { status: 400 });

  const values = input as Record<string, unknown>;
  const targetType = typeof values.targetType === "string" ? values.targetType : "";
  const targetIdValue = typeof values.targetId === "string" ? values.targetId : "";
  const reason = typeof values.reason === "string" ? values.reason : "";
  const details = typeof values.details === "string" ? values.details.trim().replace(/\u0000/g, "") : "";

  if (!VALID_TYPES.has(targetType) || !OBJECT_ID.test(targetIdValue)) {
    return NextResponse.json({ error: "Choose a valid post or reply to report." }, { status: 400 });
  }
  if (!VALID_REASONS.has(reason)) return NextResponse.json({ error: "Choose a reason for the report." }, { status: 400 });
  if (details.length > 300) return NextResponse.json({ error: "Additional details must be 300 characters or fewer." }, { status: 400 });

  let currentUser;
  try { currentUser = await getCurrentUser(); } catch {
    return NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 });
  }
  if (!currentUser) return NextResponse.json({ error: "Sign in before reporting community content." }, { status: 401 });

  try {
    const db = await getDatabase();
    const reporterId = new ObjectId(currentUser.id);
    const targetId = new ObjectId(targetIdValue);
    const reports = db.collection("reports");
    const recentCount = await reports.countDocuments({
      reporterId,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    if (recentCount >= 10) return NextResponse.json({ error: "You've reached the reporting limit for today. Please try again later." }, { status: 429 });

    let target: {
      [key: string]: unknown;
      authorId?: ObjectId;
      authorUsername?: string;
      body?: string;
      placeName?: string;
      postId?: ObjectId;
    } | null = null;
    let parentPostId: ObjectId | null = null;

    if (targetType === "post") {
      target = await db.collection("posts").findOne(
        { _id: targetId, status: "visible" },
        { projection: { authorId: 1, authorUsername: 1, body: 1, placeName: 1 } },
      );
      parentPostId = target ? targetId : null;
    } else {
      target = await db.collection("replies").findOne(
        { _id: targetId, status: "visible" },
        { projection: { authorId: 1, authorUsername: 1, body: 1, placeName: 1, postId: 1 } },
      );
      if (target?.postId instanceof ObjectId) {
        const parent = await db.collection("posts").findOne({ _id: target.postId, status: "visible" }, { projection: { _id: 1 } });
        if (!parent) target = null;
        else parentPostId = target.postId;
      } else {
        target = null;
      }
    }

    if (!target || !parentPostId) return NextResponse.json({ error: "That content is no longer available to report." }, { status: 404 });
    if (target.authorId instanceof ObjectId && target.authorId.equals(reporterId)) {
      return NextResponse.json({ error: "You can't report your own content." }, { status: 400 });
    }

    await reports.insertOne({
      reporterId,
      reporterUsername: currentUser.username,
      targetType,
      targetId,
      postId: parentPostId,
      targetAuthorId: target.authorId instanceof ObjectId ? target.authorId : null,
      targetAuthorUsername: typeof target.authorUsername === "string" ? target.authorUsername : "unknown",
      targetBody: typeof target.body === "string" ? target.body.slice(0, 500) : "",
      placeName: typeof target.placeName === "string" ? target.placeName.slice(0, 180) : "",
      reason,
      details,
      status: "open",
      createdAt: new Date(),
    });

    return NextResponse.json({ message: "Thank you. Your report has been sent to the moderation team." }, { status: 201 });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      return NextResponse.json({ error: "You've already reported this content. The team can review your earlier report." }, { status: 409 });
    }
    return NextResponse.json({ error: "We couldn't send this report. Please try again." }, { status: 503 });
  }
}
