import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getCurrentUser, type PublicUser } from "@/lib/auth";
import { hasSameOrigin, isJsonRequest } from "@/lib/http";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isMongoConfigured()) return NextResponse.json({ configured: false, user: null });
  try {
    return NextResponse.json({ configured: true, user: await getCurrentUser() }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { configured: true, user: null, error: "Account service is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  }
  if (!isJsonRequest(request)) {
    return NextResponse.json({ error: "Send profile details as JSON." }, { status: 415 });
  }
  if (!isMongoConfigured()) {
    return NextResponse.json({ error: "Profiles are unavailable until MongoDB is configured." }, { status: 503 });
  }

  let input: unknown;
  try { input = await request.json(); } catch {
    return NextResponse.json({ error: "The request body is invalid." }, { status: 400 });
  }
  if (!input || typeof input !== "object") {
    return NextResponse.json({ error: "Provide your profile details." }, { status: 400 });
  }

  let current: PublicUser | null;
  try { current = await getCurrentUser(); } catch {
    return NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 });
  }
  if (!current) return NextResponse.json({ error: "Sign in to edit your profile." }, { status: 401 });

  const values = input as Record<string, unknown>;
  const updates: { displayName?: string; bio?: string; updatedAt?: Date } = {};
  if (Object.prototype.hasOwnProperty.call(values, "displayName")) {
    const displayName = typeof values.displayName === "string"
      ? values.displayName.trim().replace(/\u0000/g, "").replace(/\s+/g, " ")
      : "";
    if (displayName.length < 2 || displayName.length > 40) {
      return NextResponse.json({ error: "Display name must contain 2–40 characters." }, { status: 400 });
    }
    updates.displayName = displayName;
  }
  if (Object.prototype.hasOwnProperty.call(values, "bio")) {
    const bio = typeof values.bio === "string" ? values.bio.trim().replace(/\u0000/g, "") : "";
    if (bio.length > 160) {
      return NextResponse.json({ error: "Your bio must be 160 characters or fewer." }, { status: 400 });
    }
    updates.bio = bio;
  }
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "There are no profile changes to save." }, { status: 400 });
  }

  try {
    updates.updatedAt = new Date();
    await (await getDatabase()).collection("users").updateOne(
      { _id: new ObjectId(current.id) },
      { $set: updates },
    );
    const user: PublicUser = {
      ...current,
      displayName: updates.displayName ?? current.displayName,
      bio: updates.bio ?? current.bio ?? "",
    };
    return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "We couldn't save your profile. Please try again." }, { status: 503 });
  }
}
