import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasSameOrigin, isJsonRequest } from "@/lib/http";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}
function toCoordinates(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [longitude, latitude] = value;
  if (typeof longitude !== "number" || !Number.isFinite(longitude) ||
      typeof latitude !== "number" || !Number.isFinite(latitude) ||
      longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
  return [longitude, latitude];
}
function isObjectId(value: string): boolean { return /^[a-f\d]{24}$/i.test(value); }

export async function GET() {
  if (!isMongoConfigured()) return NextResponse.json({ notifications: [], unreadCount: 0 }, { status: 503 });
  let user;
  try { user = await getCurrentUser(); } catch {
    return NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 });
  }
  if (!user) return NextResponse.json({ error: "Sign in to view notifications." }, { status: 401 });

  try {
    const db = await getDatabase();
    const recipientId = new ObjectId(user.id);
    const [docs, unreadCount] = await Promise.all([
      db.collection("notifications").find({ recipientId }).sort({ createdAt: -1 }).limit(30).toArray(),
      db.collection("notifications").countDocuments({ recipientId, readAt: null }),
    ]);
    const notifications = docs.map((item) => ({
      id: String(item._id),
      type: item.type === "reply" ? "reply" : "like",
      actor: {
        username: String(item.actorUsername ?? "someone"),
        displayName: String(item.actorDisplayName ?? item.actorUsername ?? "Someone"),
      },
      postId: String(item.postId ?? ""),
      placeKey: String(item.placeKey ?? ""),
      placeName: String(item.placeName ?? "a place"),
      coordinates: toCoordinates(item.coordinates),
      createdAt: iso(item.createdAt),
      readAt: item.readAt ? iso(item.readAt) : null,
    }));
    return NextResponse.json({ notifications, unreadCount }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Notifications are temporarily unavailable." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Send notification updates as JSON." }, { status: 415 });
  if (!isMongoConfigured()) return NextResponse.json({ error: "Notifications are unavailable until MongoDB is configured." }, { status: 503 });

  let values: Record<string, unknown>;
  try {
    const input: unknown = await request.json();
    if (!input || typeof input !== "object") return NextResponse.json({ error: "Choose a notification to mark as read." }, { status: 400 });
    values = input as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "The request body is invalid." }, { status: 400 });
  }
  let user;
  try { user = await getCurrentUser(); } catch {
    return NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 });
  }
  if (!user) return NextResponse.json({ error: "Sign in to update notifications." }, { status: 401 });

  try {
    const db = await getDatabase();
    const recipientId = new ObjectId(user.id);
    const readAt = new Date();
    if (values.markAll === true) {
      await db.collection("notifications").updateMany({ recipientId, readAt: null }, { $set: { readAt } });
      return NextResponse.json({ success: true, markedAll: true });
    }
    const notificationId = typeof values.notificationId === "string" ? values.notificationId : "";
    if (!isObjectId(notificationId)) return NextResponse.json({ error: "That notification identifier is invalid." }, { status: 400 });
    await db.collection("notifications").updateOne(
      { _id: new ObjectId(notificationId), recipientId }, { $set: { readAt } },
    );
    return NextResponse.json({ success: true, markedAll: false });
  } catch {
    return NextResponse.json({ error: "We couldn't update your notifications." }, { status: 503 });
  }
}
