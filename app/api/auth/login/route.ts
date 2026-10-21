import { NextResponse } from "next/server";
import { attachSessionCookie, createSession, verifyPassword, type PublicUser } from "@/lib/auth";
import { hasSameOrigin, isJsonRequest } from "@/lib/http";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  }
  if (!isJsonRequest(request)) {
    return NextResponse.json({ error: "Send account details as JSON." }, { status: 415 });
  }
  if (!isMongoConfigured()) {
    return NextResponse.json({ error: "Accounts are not enabled until MongoDB is configured." }, { status: 503 });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body is invalid." }, { status: 400 });
  }
  if (!input || typeof input !== "object") {
    return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  }

  const values = input as Record<string, unknown>;
  const email = typeof values.email === "string" ? values.email.trim().toLowerCase() : "";
  const password = typeof values.password === "string" ? values.password : "";
  if (!email || password.length < 1 || password.length > 128) {
    return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  }

  try {
    const db = await getDatabase();
    const user = await db.collection("users").findOne({
      email,
    }) as {
      _id: import("mongodb").ObjectId;
      email: string;
      username: string;
      displayName: string;
      bio?: string;
      passwordSalt: string;
      passwordHash: string;
      createdAt: Date;
    } | null;

    const matches = user
      ? await verifyPassword(password, user.passwordSalt, user.passwordHash)
      : false;

    if (!user || !matches) {
      return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    }

    const token = await createSession(user._id);
    const publicUser: PublicUser = {
      id: user._id.toHexString(),
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString(),
    };
    const response = NextResponse.json({ user: publicUser });
    attachSessionCookie(response, token);
    return response;
  } catch {
    return NextResponse.json(
      { error: "Sign in is temporarily unavailable. Check the database setup and try again." },
      { status: 503 },
    );
  }
}
