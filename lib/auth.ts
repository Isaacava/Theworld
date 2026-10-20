import "server-only";

import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";

const SESSION_COOKIE = "theworld_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export type PublicUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  createdAt: string;
};

type UserRecord = {
  _id: ObjectId;
  email: string;
  username: string;
  displayName: string;
  passwordSalt: string;
  passwordHash: string;
  createdAt: Date;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey as Buffer);
    });
  });
}

export async function createPasswordHash(password: string): Promise<{
  salt: string;
  hash: string;
}> {
  const salt = randomBytes(16);
  const hash = await derivePassword(password, salt);
  return { salt: salt.toString("base64"), hash: hash.toString("base64") };
}

export async function verifyPassword(
  password: string,
  saltBase64: string,
  expectedBase64: string,
): Promise<boolean> {
  try {
    const salt = Buffer.from(saltBase64, "base64");
    const expected = Buffer.from(expectedBase64, "base64");
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = await derivePassword(password, salt);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export async function createSession(userId: ObjectId): Promise<string> {
  const db = await getDatabase();
  const token = randomBytes(32).toString("base64url");
  const now = new Date();

  await db.collection("sessions").insertOne({
    tokenHash: hashToken(token),
    userId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  });

  return token;
}

export function attachSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function deleteCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return;

  const db = await getDatabase();
  await db.collection("sessions").deleteOne({ tokenHash: hashToken(token) });
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = await getDatabase();
  const session = await db.collection("sessions").findOne({
    tokenHash: hashToken(token),
    expiresAt: { $gt: new Date() },
  });
  if (!session || !(session.userId instanceof ObjectId)) return null;

  const user = await db.collection<UserRecord>("users").findOne({ _id: session.userId });
  if (!user) return null;

  return {
    id: user._id.toHexString(),
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
  };
}
