import { NextResponse } from "next/server";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";
import { NominatimError, searchNominatim } from "@/lib/nominatim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") || "";
  if (query.trim().length < 2) {
    return NextResponse.json({ results: [] });
  }
  if (query.length > 160) {
    return NextResponse.json({ error: "Search terms must be 160 characters or fewer." }, { status: 400 });
  }

  try {
    const db = isMongoConfigured() ? await getDatabase() : null;
    const results = await searchNominatim(db, query);
    return NextResponse.json(
      { results, cache: "short-lived" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof NominatimError ? error.status : 503;
    const message = error instanceof Error
      ? error.message
      : "Place search is temporarily unavailable.";
    return NextResponse.json(
      { error: message },
      { status, headers: status === 503 ? { "Retry-After": "2", "Cache-Control": "no-store" } : { "Cache-Control": "no-store" } },
    );
  }
}
