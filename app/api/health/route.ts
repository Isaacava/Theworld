import { NextResponse } from "next/server";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isMongoConfigured()) {
    return NextResponse.json({
      status: "degraded",
      app: "THE WORLD",
      databaseConfigured: false,
      databaseConnected: false,
      note: "Set MONGODB_URI in the deployment environment to enable persistence.",
    }, { status: 503 });
  }

  try {
    const db = await getDatabase();
    await db.command({ ping: 1 });
    return NextResponse.json({
      status: "ok",
      app: "THE WORLD",
      databaseConfigured: true,
      databaseConnected: true,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({
      status: "degraded",
      app: "THE WORLD",
      databaseConfigured: true,
      databaseConnected: false,
      note: "MongoDB is configured but the connection check failed. Verify Atlas network access and credentials.",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
