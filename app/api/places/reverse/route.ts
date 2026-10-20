import { NextResponse } from "next/server";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";
import { NominatimError, reverseNominatim } from "@/lib/nominatim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const latitude = Number(params.get("lat"));
  const longitude = Number(params.get("lon"));

  if (
    !params.has("lat") || !params.has("lon") ||
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180
  ) {
    return NextResponse.json({ error: "Provide valid latitude and longitude values." }, { status: 400 });
  }

  try {
    const db = isMongoConfigured() ? await getDatabase() : null;
    const place = await reverseNominatim(db, latitude, longitude);
    return NextResponse.json(
      { place },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof NominatimError ? error.status : 503;
    const message = error instanceof Error
      ? error.message
      : "Place lookup is temporarily unavailable.";
    return NextResponse.json(
      { error: message },
      { status, headers: status === 503 ? { "Retry-After": "2", "Cache-Control": "no-store" } : { "Cache-Control": "no-store" } },
    );
  }
}
