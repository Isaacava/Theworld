import { ObjectId, MongoServerError } from "mongodb";
import { NextResponse } from "next/server";
import { attachSessionCookie, createPasswordHash, createSession, type PublicUser } from "@/lib/auth";
import { hasSameOrigin, isJsonRequest } from "@/lib/http";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";

function validEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

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
    return NextResponse.json({ error: "Provide an email, username, and password." }, { status: 400 });
  }

  const values = input as Record<string, unknown>;
  const email = typeof values.email === "string" ? values.email.trim().toLowerCase() : "";
  const username = typeof values.username === "string" ? values.username.trim().toLowerCase() : "";
  const password = typeof values.password === "string" ? values.password : "";

  if (!validEmail(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return NextResponse.json(
      { error: "Username must be 3–20 characters using letters, numbers, or underscores." },
      { status: 400 },
    );
  }
  if (password.length < 10 || password.length > 128) {
    return NextResponse.json({ error: "Password must contain 10–128 characters." }, { status: 400 });
  }

  try {
    const db = await getDatabase();
    const { salt, hash } = await createPasswordHash(password);
    const now = new Date();
    const user = {
      email,
      username,
      displayName: username,
      passwordSalt: salt,
      passwordHash: hash,
      createdAt: now,
    };

    const inserted = await db.collection("users").insertOne(user);
    const token = await createSession(inserted.insertedId as ObjectId);
    const publicUser: PublicUser = {
      id: inserted.insertedId.toHexString(),
      email,
      username,
      displayName: username,
      createdAt: now.toISOString(),
    };
    const response = NextResponse.json({ user: publicUser }, { status: 201 });
    attachSessionCookie(response, token);
    return response;
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      return NextResponse.json(
        { error: "That email or username is already registered." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Account creation failed. Check the database setup and try again." },
      { status: 503 },
    );
  }
}
