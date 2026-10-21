import { MongoServerError, ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { businessDto, MONGO_ID } from "@/lib/businesses";
import { hasSameOrigin, isJsonRequest } from "@/lib/http";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function adminContext() {
  if (!isMongoConfigured()) return { response: NextResponse.json({ error: "Moderation is unavailable until MongoDB is configured." }, { status: 503 }) };
  let user;
  try { user = await getCurrentUser(); } catch { return { response: NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 }) }; }
  if (!user) return { response: NextResponse.json({ error: "Sign in to continue." }, { status: 401 }) };
  const db = await getDatabase();
  const record = await db.collection("users").findOne({ _id: new ObjectId(user.id) }, { projection: { role: 1 } });
  if (record?.role !== "admin") return { response: NextResponse.json({ error: "This area is restricted to moderators." }, { status: 403 }) };
  return { db, user };
}

export async function GET() {
  const context = await adminContext();
  if ("response" in context) return context.response;
  try {
    const [pending, disputed] = await Promise.all([
      context.db.collection("businesses").find({ status: "pending", verificationStatus: "pending" }).sort({ createdAt: 1 }).limit(100).toArray(),
      context.db.collection("businessReviews").find({ status: "disputed", disputeStatus: "pending" }).sort({ disputedAt: 1 }).limit(100).toArray(),
    ]);
    const businessIds = [...new Set(disputed.map((r) => r.businessId).filter((v): v is ObjectId => v instanceof ObjectId))];
    const businessDocs = businessIds.length ? await context.db.collection("businesses").find({ _id: { $in: businessIds } }).project({ name: 1, status: 1 }).toArray() : [];
    const businessNames = new Map(businessDocs.map((doc) => [String(doc._id), String(doc.name ?? "Business")]));
    return NextResponse.json({
      businesses: pending.map((doc) => ({
        ...businessDto(doc as unknown as Record<string, unknown>),
        claimedBy: String(doc.claimantUsername ?? "member"),
        proofUrl: String(doc.proofUrl ?? ""),
        verificationNote: String(doc.verificationNote ?? ""),
        createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : new Date(String(doc.createdAt)).toISOString(),
      })),
      disputedReviews: disputed.map((doc) => ({
        id: String(doc._id),
        businessId: doc.businessId instanceof ObjectId ? doc.businessId.toHexString() : "",
        businessName: businessNames.get(String(doc.businessId)) ?? "Business",
        rating: Number(doc.rating ?? 0),
        body: String(doc.body ?? ""),
        authorUsername: String(doc.authorUsername ?? "member"),
        disputeReason: String(doc.disputeReason ?? ""),
        disputedAt: doc.disputedAt instanceof Date ? doc.disputedAt.toISOString() : new Date(String(doc.disputedAt)).toISOString(),
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The business verification queue could not be loaded." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Send the moderation decision as JSON." }, { status: 415 });
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "The request body is invalid." }, { status: 400 }); }
  const values = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const action = typeof values.action === "string" ? values.action : "";
  const id = typeof values.id === "string" ? values.id : "";
  const note = typeof values.note === "string" ? values.note.trim().slice(0, 500) : "";
  if (!MONGO_ID.test(id)) return NextResponse.json({ error: "That record identifier is invalid." }, { status: 400 });
  if (!["verify_business", "reject_business", "publish_review", "remove_review"].includes(action)) return NextResponse.json({ error: "Choose a supported moderation action." }, { status: 400 });
  if ((action === "reject_business" || action === "remove_review") && note.length < 8) return NextResponse.json({ error: "Add a short moderation reason (at least 8 characters)." }, { status: 400 });
  const context = await adminContext();
  if ("response" in context) return context.response;
  const now = new Date();
  try {
    if (action === "verify_business" || action === "reject_business") {
      const business = await context.db.collection("businesses").findOne({ _id: new ObjectId(id), status: "pending", verificationStatus: "pending" });
      if (!business) return NextResponse.json({ error: "That listing is no longer awaiting verification." }, { status: 409 });
      const status = action === "verify_business" ? "verified" : "rejected";
      const update: Record<string, unknown> = {
        status,
        verificationStatus: status,
        moderatedAt: now,
        moderatedBy: new ObjectId(context.user.id),
        moderationNote: note || null,
        updatedAt: now,
      };
      if (status === "verified") update.ownerId = business.claimantId;
      const result = await context.db.collection("businesses").updateOne({ _id: new ObjectId(id), status: "pending" }, { $set: update });
      if (!result.matchedCount) return NextResponse.json({ error: "The listing changed. Refresh the queue and try again." }, { status: 409 });
      return NextResponse.json({ success: true, status, message: status === "verified" ? "Business verified. The claimant is now its listed owner." : "Business listing rejected." }, { headers: { "Cache-Control": "no-store" } });
    }
    const targetStatus = action === "publish_review" ? "visible" : "removed";
    const result = await context.db.collection("businessReviews").updateOne(
      { _id: new ObjectId(id), status: "disputed", disputeStatus: "pending" },
      { $set: { status: targetStatus, disputeStatus: targetStatus === "visible" ? "resolved-published" : "resolved-removed", moderatedAt: now, moderatedBy: new ObjectId(context.user.id), moderationNote: note || null } },
    );
    if (!result.matchedCount) return NextResponse.json({ error: "That disputed review has already been handled." }, { status: 409 });
    return NextResponse.json({ success: true, status: targetStatus, message: targetStatus === "visible" ? "Review restored to public ratings." : "Review removed from public ratings." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) return NextResponse.json({ error: "That moderation decision has already been applied." }, { status: 409 });
    return NextResponse.json({ error: "We couldn't save the moderation decision." }, { status: 503 });
  }
}
