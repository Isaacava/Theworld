import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getVerifiedBusiness, MONGO_ID } from "@/lib/businesses";
import { hasSameOrigin, isJsonRequest } from "@/lib/http";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ businessId: string }> };
const BOOKING_STATES = new Set(["accepted", "declined", "completed"]);

export async function GET(_request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  if (!MONGO_ID.test(businessId)) return NextResponse.json({ bookings: [], error: "That business identifier is invalid." }, { status: 400 });
  if (!isMongoConfigured()) return NextResponse.json({ bookings: [] });
  let user;
  try { user = await getCurrentUser(); } catch { return NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 }); }
  if (!user) return NextResponse.json({ error: "Sign in to manage booking requests." }, { status: 401 });
  try {
    const db = await getDatabase();
    const business = await getVerifiedBusiness(db, businessId);
    if (!business) return NextResponse.json({ bookings: [], error: "This business is not verified yet." }, { status: 404 });
    const isOwner = business.ownerId instanceof ObjectId && business.ownerId.equals(new ObjectId(user.id));
    if (!isOwner) return NextResponse.json({ bookings: [], error: "Only the verified owner can view booking requests." }, { status: 403 });
    const docs = await db.collection("businessBookings").find({ businessId: new ObjectId(businessId) }).sort({ createdAt: -1 }).limit(100).toArray();
    return NextResponse.json({ bookings: docs.map((doc) => ({
      id: String(doc._id), message: String(doc.message ?? ""), requestedFor: String(doc.requestedFor ?? ""),
      status: String(doc.status ?? "requested"),
      customer: { username: String(doc.customerUsername ?? "member"), displayName: String(doc.customerDisplayName ?? doc.customerUsername ?? "Member") },
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : new Date(String(doc.createdAt)).toISOString(),
    })) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Booking requests are temporarily unavailable." }, { status: 503 }); }
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  if (!MONGO_ID.test(businessId)) return NextResponse.json({ error: "That business identifier is invalid." }, { status: 400 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Send the booking request as JSON." }, { status: 415 });
  if (!isMongoConfigured()) return NextResponse.json({ error: "Booking requests are unavailable." }, { status: 503 });
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "The request body is invalid." }, { status: 400 }); }
  const values = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const message = typeof values.message === "string" ? values.message.trim().replace(/\u0000/g, "") : "";
  const requestedFor = typeof values.requestedFor === "string" ? values.requestedFor : "";
  const date = new Date(requestedFor);
  if (message.length < 2 || message.length > 500) return NextResponse.json({ error: "Add a message of 2–500 characters." }, { status: 400 });
  if (!Number.isFinite(date.getTime()) || date.getTime() < Date.now() || date.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: "Choose a date and time in the next 12 months." }, { status: 400 });
  }
  let user;
  try { user = await getCurrentUser(); } catch { return NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 }); }
  if (!user) return NextResponse.json({ error: "Sign in to request a booking." }, { status: 401 });
  try {
    const db = await getDatabase();
    const business = await getVerifiedBusiness(db, businessId);
    if (!business) return NextResponse.json({ error: "Only verified businesses can accept booking requests." }, { status: 404 });
    if (business.ownerId instanceof ObjectId && business.ownerId.equals(new ObjectId(user.id))) return NextResponse.json({ error: "You cannot book your own business." }, { status: 403 });
    const now = new Date();
    const doc = { businessId: new ObjectId(businessId), userId: new ObjectId(user.id), customerUsername: user.username, customerDisplayName: user.displayName, requestedFor: date.toISOString(), message, status: "requested", createdAt: now, updatedAt: now };
    const inserted = await db.collection("businessBookings").insertOne(doc);
    return NextResponse.json({ success: true, booking: { id: String(inserted.insertedId), requestedFor: date.toISOString(), status: "requested" }, message: "Request sent. The business has not confirmed the booking yet." }, { status: 201 });
  } catch { return NextResponse.json({ error: "We couldn't send the booking request. Please try again." }, { status: 503 }); }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  if (!MONGO_ID.test(businessId)) return NextResponse.json({ error: "That business identifier is invalid." }, { status: 400 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Send the booking update as JSON." }, { status: 415 });
  if (!isMongoConfigured()) return NextResponse.json({ error: "Booking requests are unavailable." }, { status: 503 });
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "The request body is invalid." }, { status: 400 }); }
  const values = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const bookingId = typeof values.bookingId === "string" ? values.bookingId : "";
  const status = typeof values.status === "string" ? values.status : "";
  if (!MONGO_ID.test(bookingId) || !BOOKING_STATES.has(status)) return NextResponse.json({ error: "Choose a valid booking and status." }, { status: 400 });
  let user;
  try { user = await getCurrentUser(); } catch { return NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 }); }
  if (!user) return NextResponse.json({ error: "Sign in to manage booking requests." }, { status: 401 });
  try {
    const db = await getDatabase();
    const business = await getVerifiedBusiness(db, businessId);
    if (!business || !(business.ownerId instanceof ObjectId) || !business.ownerId.equals(new ObjectId(user.id))) return NextResponse.json({ error: "Only the verified business owner can update bookings." }, { status: 403 });
    const result = await db.collection("businessBookings").updateOne(
      { _id: new ObjectId(bookingId), businessId: new ObjectId(businessId), status: { $in: ["requested", "accepted"] } },
      { $set: { status, updatedAt: new Date(), updatedBy: new ObjectId(user.id) } },
    );
    if (!result.matchedCount) return NextResponse.json({ error: "That booking is no longer awaiting a decision." }, { status: 409 });
    return NextResponse.json({ success: true, status, message: status === "completed" ? "Booking marked completed. The customer can link a review to this booking." : `Booking request ${status}.` }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "We couldn't update the booking. Please try again." }, { status: 503 }); }
}
