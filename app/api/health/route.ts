import { NextResponse } from "next/server";
import { isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    app: "THE WORLD",
    databaseConfigured: isMongoConfigured(),
    note: isMongoConfigured()
      ? "Database environment variable is present; connectivity is checked on database requests."
      : "Set MONGODB_URI in the deployment environment to enable persistence.",
  });
}
