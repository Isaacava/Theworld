import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isMongoConfigured()) {
    return NextResponse.json({ configured: false, user: null });
  }

  try {
    return NextResponse.json({ configured: true, user: await getCurrentUser() });
  } catch {
    return NextResponse.json(
      { configured: true, user: null, error: "Account service is temporarily unavailable." },
      { status: 503 },
    );
  }
}
