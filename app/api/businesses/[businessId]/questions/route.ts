import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getVerifiedBusiness, MONGO_ID } from "@/lib/businesses";
import { hasSameOrigin, isJsonRequest } from "@/lib/http";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  if (!MONGO_ID.test(businessId)) return NextResponse.json({ questions: [], error: "That business identifier is invalid." }, { status: 400 });
  if (!isMongoConfigured()) return NextResponse.json({ questions: [] });
  try {
    const db = await getDatabase();
    const business = await getVerifiedBusiness(db, businessId);
    if (!business) return NextResponse.json({ questions: [], error: "This business is not verified yet." }, { status: 404 });
    const docs = await db.collection("businessQuestions").find({ businessId: new ObjectId(businessId), status: "visible" }).sort({ createdAt: -1 }).limit(50).toArray();
    return NextResponse.json({
      questions: docs.map((doc) => ({
        id: String(doc._id), body: String(doc.body ?? ""),
        author: { username: String(doc.authorUsername ?? "member"), displayName: String(doc.authorDisplayName ?? doc.authorUsername ?? "Member") },
        createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : new Date(String(doc.createdAt)).toISOString(),
        answer: typeof doc.answer === "string" ? doc.answer : null,
        answeredAt: doc.answeredAt instanceof Date ? doc.answeredAt.toISOString() : null,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ questions: [], error: "Business questions are temporarily unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  if (!MONGO_ID.test(businessId)) return NextResponse.json({ error: "That business identifier is invalid." }, { status: 400 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Send the question as JSON." }, { status: 415 });
  if (!isMongoConfigured()) return NextResponse.json({ error: "Business questions are unavailable." }, { status: 503 });
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "The request body is invalid." }, { status: 400 }); }
  const body = input && typeof input === "object" && typeof (input as Record<string, unknown>).body === "string"
    ? ((input as Record<string, unknown>).body as string).trim().replace(/\u0000/g, "") : "";
  if (body.length < 2 || body.length > 500) return NextResponse.json({ error: "Write a question of 2–500 characters." }, { status: 400 });
  let user;
  try { user = await getCurrentUser(); } catch { return NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 }); }
  if (!user) return NextResponse.json({ error: "Sign in to ask this business a question." }, { status: 401 });
  try {
    const db = await getDatabase();
    const business = await getVerifiedBusiness(db, businessId);
    if (!business) return NextResponse.json({ error: "Only verified businesses can receive questions." }, { status: 404 });
    const now = new Date();
    const doc = { businessId: new ObjectId(businessId), userId: new ObjectId(user.id), authorUsername: user.username, authorDisplayName: user.displayName, body, status: "visible", answer: null, answeredAt: null, createdAt: now };
    const result = await db.collection("businessQuestions").insertOne(doc);
    return NextResponse.json({ question: { id: String(result.insertedId), body, author: { username: user.username, displayName: user.displayName }, createdAt: now.toISOString(), answer: null, answeredAt: null } }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "We couldn't send your question. Please try again." }, { status: 503 });
  }
}
