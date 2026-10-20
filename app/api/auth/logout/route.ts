import { NextResponse } from "next/server";
import { clearSessionCookie, deleteCurrentSession } from "@/lib/auth";
import { hasSameOrigin } from "@/lib/http";
import { isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  }

  if (isMongoConfigured()) {
    try {
      await deleteCurrentSession();
    } catch {
      // The browser cookie is still cleared if the database is temporarily unavailable.
    }
  }

  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  return response;
}
