import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { MONGO_ID } from "@/lib/businesses";
import { hasSameOrigin, isJsonRequest } from "@/lib/http";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ businessId: string; questionId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { businessId, questionId } = await context.params;
  if (!MONGO_ID.test(businessId) || !MONGO_ID.test(questionId)) return NextResponse.json({ error: "That business question is invalid." }, { status: 400 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Send the business answer as JSON." }, { status: 415 });
  if (!isMongoConfigured()) return NextResponse.json({ error: "Business questions are unavailable." }, { status: 503 });
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "The request body is invalid." }, { status: 400 }); }
  const answer = input && typeof input === "object" && typeof (input as Record<string, unknown>).answer === "string"
    ? ((input as Record<string, unknown>).answer as string).trim().replace(/\u0000/g, "") : "";
  if (answer.length < 2 || answer.length > 1000) return NextResponse.json({ error: "Write an answer of 2–1,000 characters." }, { status: 400 });
  let user;
  try { user = await getCurrentUser(); } catch { return NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 }); }
  if (!user) return NextResponse.json({ error: "Sign in to answer as the business owner." }, { status: 401 });
  try {
    const db = await getDatabase();
    const owned = await db.collection("businesses").findOne({ _id: new ObjectId(businessId), status: "verified", verificationStatus: "verified", ownerId: new ObjectId(user.id) });
    if (!owned) return NextResponse.json({ error: "Only the verified business owner can answer here." }, { status: 403 });
    const now = new Date();
    const result = await db.collection("businessQuestions").updateOne(
      { _id: new ObjectId(questionId), businessId: new ObjectId(businessId), status: "visible" },
      { $set: { answer, answeredAt: now, answeredBy: new ObjectId(user.id), answeredByUsername: user.username } },
    );
    if (!result.matchedCount) return NextResponse.json({ error: "That question is no longer available." }, { status: 404 });
    return NextResponse.json({ success: true, answer, answeredAt: now.toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "We couldn't save the answer. Please try again." }, { status: 503 });
  }
}
