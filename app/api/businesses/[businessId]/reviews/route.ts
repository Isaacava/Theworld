import { MongoServerError, ObjectId } from "mongodb";
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
  if (!MONGO_ID.test(businessId)) return NextResponse.json({ reviews: [], error: "That business listing is invalid." }, { status: 400 });
  if (!isMongoConfigured()) return NextResponse.json({ reviews: [], averageRating: 0, reviewCount: 0 });
  try {
    const db = await getDatabase();
    const business = await getVerifiedBusiness(db, businessId);
    if (!business) return NextResponse.json({ reviews: [], error: "This business is not verified yet." }, { status: 404 });
    const docs = await db.collection("businessReviews").find({ businessId: new ObjectId(businessId), status: "visible" }).sort({ createdAt: -1 }).limit(50).toArray();
    const aggregate = await db.collection("businessReviews").aggregate([
      { $match: { businessId: new ObjectId(businessId), status: "visible" } },
      { $group: { _id: null, count: { $sum: 1 }, average: { $avg: "$rating" } } },
    ]).toArray();
    const rollup = aggregate[0] as { count?: number; average?: number } | undefined;
    return NextResponse.json({
      reviews: docs.map((doc) => ({
        id: String(doc._id),
        rating: Number(doc.rating),
        body: String(doc.body ?? ""),
        author: { username: String(doc.authorUsername ?? "member"), displayName: String(doc.authorDisplayName ?? doc.authorUsername ?? "Member") },
        createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : new Date(String(doc.createdAt)).toISOString(),
        verificationStatus: doc.verificationStatus === "verified" ? "verified" : "unverified",
        bookingId: doc.bookingId ? String(doc.bookingId) : null,
      })),
      averageRating: Number(rollup?.average ?? 0),
      reviewCount: Number(rollup?.count ?? 0),
      totalCount: Number(rollup?.count ?? 0),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ reviews: [], error: "Reviews are temporarily unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  if (!MONGO_ID.test(businessId)) return NextResponse.json({ error: "That business listing is invalid." }, { status: 400 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Send the review as JSON." }, { status: 415 });
  if (!isMongoConfigured()) return NextResponse.json({ error: "Reviews are temporarily unavailable." }, { status: 503 });
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "The request body is invalid." }, { status: 400 }); }
  if (!input || typeof input !== "object") return NextResponse.json({ error: "Provide a rating and review." }, { status: 400 });
  const values = input as Record<string, unknown>;
  const rating = Number(values.rating);
  const body = typeof values.body === "string" ? values.body.trim().replace(/\u0000/g, "") : "";
  const bookingIdRaw = typeof values.bookingId === "string" ? values.bookingId : "";
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return NextResponse.json({ error: "Choose a rating from one to five stars." }, { status: 400 });
  if (body.length < 5 || body.length > 1000) return NextResponse.json({ error: "Write a review of 5–1,000 characters." }, { status: 400 });
  let user;
  try { user = await getCurrentUser(); } catch { return NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 }); }
  if (!user) return NextResponse.json({ error: "Sign in to review a business." }, { status: 401 });
  try {
    const db = await getDatabase();
    const business = await getVerifiedBusiness(db, businessId);
    if (!business) return NextResponse.json({ error: "Only verified businesses can receive reviews." }, { status: 404 });
    if (business.ownerId instanceof ObjectId && business.ownerId.toHexString() === user.id) return NextResponse.json({ error: "Business owners cannot review their own listing." }, { status: 403 });
    let verifiedBooking: ObjectId | null = null;
    if (bookingIdRaw) {
      if (!MONGO_ID.test(bookingIdRaw)) return NextResponse.json({ error: "That booking identifier is invalid." }, { status: 400 });
      const bookingId = new ObjectId(bookingIdRaw);
      const booking = await db.collection("businessBookings").findOne({
        _id: bookingId, businessId: new ObjectId(businessId), userId: new ObjectId(user.id), status: "completed",
      });
      if (!booking) return NextResponse.json({ error: "Only a completed booking can mark this review as booking-verified." }, { status: 422 });
      verifiedBooking = bookingId;
    }
    const now = new Date();
    const document = {
      businessId: new ObjectId(businessId),
      userId: new ObjectId(user.id),
      authorUsername: user.username,
      authorDisplayName: user.displayName,
      rating,
      body,
      status: "visible",
      verificationStatus: verifiedBooking ? "verified" : "unverified",
      bookingId: verifiedBooking,
      createdAt: now,
      updatedAt: now,
    };
    const inserted = await db.collection("businessReviews").insertOne(document);
    return NextResponse.json({
      review: {
        id: String(inserted.insertedId), rating, body,
        author: { username: user.username, displayName: user.displayName },
        createdAt: now.toISOString(),
        verificationStatus: verifiedBooking ? "verified" : "unverified",
        bookingId: verifiedBooking ? String(verifiedBooking) : null,
      },
      message: verifiedBooking ? "Review published with a completed-booking verification." : "Review published. It is not labelled booking-verified because no completed booking was linked.",
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) return NextResponse.json({ error: "You've already reviewed this business. One review per account helps keep ratings fair." }, { status: 409 });
    return NextResponse.json({ error: "We couldn't submit your review. Please try again." }, { status: 503 });
  }
}
