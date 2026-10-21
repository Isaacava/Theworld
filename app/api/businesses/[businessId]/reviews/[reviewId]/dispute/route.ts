import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { MONGO_ID } from "@/lib/businesses";
import { hasSameOrigin, isJsonRequest } from "@/lib/http";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ businessId: string; reviewId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { businessId, reviewId } = await context.params;
  if (!MONGO_ID.test(businessId) || !MONGO_ID.test(reviewId)) return NextResponse.json({ error: "That business or review identifier is invalid." }, { status: 400 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Send the dispute as JSON." }, { status: 415 });
  if (!isMongoConfigured()) return NextResponse.json({ error: "Review disputes are unavailable." }, { status: 503 });
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "The request body is invalid." }, { status: 400 }); }
  const reason = input && typeof input === "object" && typeof (input as Record<string, unknown>).reason === "string"
    ? ((input as Record<string, unknown>).reason as string).trim().slice(0, 500) : "";
  if (reason.length < 10) return NextResponse.json({ error: "Explain the dispute in at least 10 characters." }, { status: 400 });
  let user;
  try { user = await getCurrentUser(); } catch { return NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 }); }
  if (!user) return NextResponse.json({ error: "Sign in with the verified business owner's account to dispute a review." }, { status: 401 });
  try {
    const db = await getDatabase();
    const business = await db.collection("businesses").findOne({
      _id: new ObjectId(businessId), status: "verified", verificationStatus: "verified", ownerId: new ObjectId(user.id),
    });
    if (!business) return NextResponse.json({ error: "Only the verified owner of this business can dispute its reviews." }, { status: 403 });
    const result = await db.collection("businessReviews").updateOne(
      { _id: new ObjectId(reviewId), businessId: new ObjectId(businessId), status: "visible" },
      { $set: { status: "disputed", disputeReason: reason, disputedAt: new Date(), disputedBy: new ObjectId(user.id), disputeStatus: "pending" } },
    );
    if (!result.matchedCount) return NextResponse.json({ error: "That review is unavailable or already disputed." }, { status: 404 });
    return NextResponse.json({ success: true, message: "The review is hidden from public ratings while a moderator checks the dispute. A dispute is not a permanent deletion." }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "We couldn't submit the dispute. Please try again." }, { status: 503 });
  }
}
