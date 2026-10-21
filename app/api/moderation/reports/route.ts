import { MongoServerError, ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasSameOrigin, isJsonRequest } from "@/lib/http";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OBJECT_ID = /^[a-f\d]{24}$/i;
const VALID_STATUSES = new Set(["reviewed", "dismissed"]);

async function getAdminContext() {
  if (!isMongoConfigured()) return { response: NextResponse.json({ error: "Moderation is temporarily unavailable." }, { status: 503 }) };
  let user;
  try { user = await getCurrentUser(); } catch {
    return { response: NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 }) };
  }
  if (!user) return { response: NextResponse.json({ error: "Sign in to continue." }, { status: 401 }) };
  try {
    const db = await getDatabase();
    const record = await db.collection("users").findOne({ _id: new ObjectId(user.id) }, { projection: { role: 1 } });
    if (record?.role !== "admin") return { response: NextResponse.json({ error: "This area is restricted to moderators." }, { status: 403 }) };
    return { db, user };
  } catch {
    return { response: NextResponse.json({ error: "The moderation service is temporarily unavailable." }, { status: 503 }) };
  }
}

function safeIso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

export async function GET(request: Request) {
  const context = await getAdminContext();
  if ("response" in context) return context.response;
  const requestedStatus = new URL(request.url).searchParams.get("status") || "open";
  if (!["open", "reviewed", "dismissed", "all"].includes(requestedStatus)) {
    return NextResponse.json({ error: "Choose a valid report status." }, { status: 400 });
  }

  try {
    const filter = requestedStatus === "all" ? {} : { status: requestedStatus };
    const [records, openCount, totalCount] = await Promise.all([
      context.db.collection("reports").find(filter).sort({ createdAt: -1 }).limit(100).toArray(),
      context.db.collection("reports").countDocuments({ status: "open" }),
      context.db.collection("reports").countDocuments({}),
    ]);

    const postIds = records.filter((record) => record.targetType === "post" && record.targetId instanceof ObjectId).map((record) => record.targetId as ObjectId);
    const replyIds = records.filter((record) => record.targetType === "reply" && record.targetId instanceof ObjectId).map((record) => record.targetId as ObjectId);
    const [postTargets, replyTargets] = await Promise.all([
      postIds.length ? context.db.collection("posts").find({ _id: { $in: postIds } }).project({ status: 1 }).toArray() : Promise.resolve([]),
      replyIds.length ? context.db.collection("replies").find({ _id: { $in: replyIds } }).project({ status: 1 }).toArray() : Promise.resolve([]),
    ]);

    const contentStatuses = new Map<string, "visible" | "hidden" | "missing">();
    for (const target of postTargets) contentStatuses.set(`post:${String(target._id)}`, target.status === "visible" ? "visible" : "hidden");
    for (const target of replyTargets) contentStatuses.set(`reply:${String(target._id)}`, target.status === "visible" ? "visible" : "hidden");

    const reports = records.map((record) => {
      const targetType = record.targetType === "reply" ? "reply" : "post";
      const targetId = record.targetId instanceof ObjectId ? record.targetId.toHexString() : "";
      return {
        id: record._id instanceof ObjectId ? record._id.toHexString() : String(record._id),
        targetType,
        targetId,
        contentStatus: contentStatuses.get(`${targetType}:${targetId}`) ?? "missing",
        contentAction: typeof record.contentAction === "string" ? record.contentAction : null,
        contentActionAt: record.contentActionAt ? safeIso(record.contentActionAt) : null,
        contentActionByUsername: typeof record.contentActionByUsername === "string" ? record.contentActionByUsername : null,
        reporterUsername: typeof record.reporterUsername === "string" ? record.reporterUsername : "unknown",
        targetAuthorUsername: typeof record.targetAuthorUsername === "string" ? record.targetAuthorUsername : "unknown",
        targetBody: typeof record.targetBody === "string" ? record.targetBody : "",
        placeName: typeof record.placeName === "string" ? record.placeName : "",
        reason: typeof record.reason === "string" ? record.reason : "other",
        details: typeof record.details === "string" ? record.details : "",
        status: typeof record.status === "string" ? record.status : "open",
        createdAt: safeIso(record.createdAt),
        moderatedAt: record.moderatedAt ? safeIso(record.moderatedAt) : null,
        moderatorUsername: typeof record.moderatorUsername === "string" ? record.moderatorUsername : null,
      };
    });
    return NextResponse.json({ reports, openCount, totalCount }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "We couldn't load reports. Please try again." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Send the moderation update as JSON." }, { status: 415 });

  const context = await getAdminContext();
  if ("response" in context) return context.response;
  let input: unknown;
  try { input = await request.json(); } catch {
    return NextResponse.json({ error: "The request body is invalid." }, { status: 400 });
  }
  if (!input || typeof input !== "object") return NextResponse.json({ error: "Choose a report and the moderation action." }, { status: 400 });

  const values = input as Record<string, unknown>;
  const reportId = typeof values.reportId === "string" ? values.reportId : "";
  const contentAction = typeof values.contentAction === "string" ? values.contentAction : "";
  const status = typeof values.status === "string" ? values.status : "";
  if (!OBJECT_ID.test(reportId)) return NextResponse.json({ error: "That report identifier is invalid." }, { status: 400 });

  try {
    const db = context.db;
    const now = new Date();
    const moderatorId = new ObjectId(context.user.id);

    if (Object.prototype.hasOwnProperty.call(values, "contentAction")) {
      if (contentAction !== "hide" && contentAction !== "restore") {
        return NextResponse.json({ error: "Choose whether to hide or restore the reported content." }, { status: 400 });
      }
      const report = await db.collection("reports").findOne({ _id: new ObjectId(reportId) });
      if (!report || !(report.targetId instanceof ObjectId)) {
        return NextResponse.json({ error: "That report or its target is no longer available." }, { status: 404 });
      }
      const targetType = report.targetType === "reply" ? "reply" : report.targetType === "post" ? "post" : "";
      if (!targetType) return NextResponse.json({ error: "This report has an unsupported target." }, { status: 400 });

      const targetCollection = db.collection(targetType === "post" ? "posts" : "replies");
      const target = await targetCollection.findOne({ _id: report.targetId }, { projection: { status: 1 } });
      if (!target) return NextResponse.json({ error: "The reported content no longer exists." }, { status: 404 });

      const expectedStatus = contentAction === "hide" ? "visible" : "hidden";
      const nextContentStatus = contentAction === "hide" ? "hidden" : "visible";
      if (target.status !== expectedStatus) {
        return NextResponse.json({ error: target.status === nextContentStatus
          ? `This content is already ${nextContentStatus === "hidden" ? "hidden" : "visible"}.`
          : "The content state has changed. Refresh the queue and try again." }, { status: 409 });
      }

      const changed = await targetCollection.updateOne(
        { _id: report.targetId, status: expectedStatus },
        { $set: {
          status: nextContentStatus,
          moderationUpdatedAt: now,
          moderationUpdatedBy: moderatorId,
          moderationUpdatedByUsername: context.user.username,
        } },
      );
      if (changed.matchedCount === 0) return NextResponse.json({ error: "The content state changed. Refresh the queue and try again." }, { status: 409 });

      await db.collection("reports").updateOne(
        { _id: report._id },
        { $set: {
          contentAction,
          contentStatus: nextContentStatus,
          contentActionAt: now,
          contentActionBy: moderatorId,
          contentActionByUsername: context.user.username,
        } },
      );
      return NextResponse.json({ success: true, contentAction, contentStatus: nextContentStatus, contentActionAt: now.toISOString() }, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (!VALID_STATUSES.has(status)) return NextResponse.json({ error: "Choose a valid report status." }, { status: 400 });
    const result = await db.collection("reports").updateOne(
      { _id: new ObjectId(reportId), status: "open" },
      { $set: { status, moderatedAt: now, moderatorId, moderatorUsername: context.user.username } },
    );
    if (result.matchedCount === 0) return NextResponse.json({ error: "This report was already reviewed or no longer exists." }, { status: 409 });
    return NextResponse.json({ success: true, status, moderatedAt: now.toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) return NextResponse.json({ error: "This report has already been updated." }, { status: 409 });
    return NextResponse.json({ error: "We couldn't save this moderation update." }, { status: 503 });
  }
}
