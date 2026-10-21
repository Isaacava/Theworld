import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasSameOrigin, isJsonRequest } from "@/lib/http";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ postId: string; replyId: string }> };
const ID = /^[a-f\d]{24}$/i;

export async function PATCH(request: Request, context: RouteContext) {
  const { postId, replyId } = await context.params;
  if (!ID.test(postId) || !ID.test(replyId)) return NextResponse.json({ error: "That reply identifier is invalid." }, { status: 400 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Send the reply update as JSON." }, { status: 415 });
  if (!isMongoConfigured()) return NextResponse.json({ error: "Reply editing is unavailable." }, { status: 503 });
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "The request body is invalid." }, { status: 400 }); }
  const body = input && typeof input === "object" && typeof (input as Record<string, unknown>).body === "string"
    ? ((input as Record<string, unknown>).body as string).trim().replace(/\u0000/g, "") : "";
  if (body.length < 2 || body.length > 300) return NextResponse.json({ error: "A reply must contain 2–300 characters." }, { status: 400 });
  let user;
  try { user = await getCurrentUser(); } catch { return NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 }); }
  if (!user) return NextResponse.json({ error: "Sign in to edit your reply." }, { status: 401 });
  try {
    const result = await (await getDatabase()).collection("replies").updateOne(
      { _id: new ObjectId(replyId), postId: new ObjectId(postId), authorId: new ObjectId(user.id), status: "visible" },
      { $set: { body, editedAt: new Date(), updatedAt: new Date() } },
    );
    if (!result.matchedCount) return NextResponse.json({ error: "Only the author can edit a visible reply." }, { status: 403 });
    return NextResponse.json({ success: true, body, editedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "We couldn't save this reply edit." }, { status: 503 }); }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { postId, replyId } = await context.params;
  if (!ID.test(postId) || !ID.test(replyId)) return NextResponse.json({ error: "That reply identifier is invalid." }, { status: 400 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  if (!isMongoConfigured()) return NextResponse.json({ error: "Reply deletion is unavailable." }, { status: 503 });
  let user;
  try { user = await getCurrentUser(); } catch { return NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 }); }
  if (!user) return NextResponse.json({ error: "Sign in to delete your reply." }, { status: 401 });
  try {
    const result = await (await getDatabase()).collection("replies").updateOne(
      { _id: new ObjectId(replyId), postId: new ObjectId(postId), authorId: new ObjectId(user.id), status: "visible" },
      { $set: { status: "deleted", deletedAt: new Date(), deletedBy: new ObjectId(user.id) } },
    );
    if (!result.matchedCount) return NextResponse.json({ error: "Only the author can delete a visible reply." }, { status: 403 });
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "We couldn't delete this reply." }, { status: 503 }); }
}
