import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { OSM_FEATURE_KEY } from "@/lib/businesses";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";
import { getCanonicalOsmPlaceMetadata, PlaceLookupError } from "@/lib/osm-place";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const placeKey = new URL(request.url).searchParams.get("placeKey") || "";
  if (!OSM_FEATURE_KEY.test(placeKey)) return NextResponse.json({ error: "Choose a valid mapped place." }, { status: 400 });
  if (!isMongoConfigured()) return NextResponse.json({ error: "Place details are unavailable." }, { status: 503 });
  try {
    const place = await getCanonicalOsmPlaceMetadata(await getDatabase(), placeKey);
    return NextResponse.json({
      place: { id: place.placeKey, name: place.name, subtitle: place.displayName.split(",").slice(1,3).join(",").trim(), displayName: place.displayName, kind: place.kind, coordinates: place.coordinates, zoom: /city|town|municipality/i.test(place.kind) ? 10 : 15 },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PlaceLookupError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "We couldn't resolve that mapped place." }, { status: 503 });
  }
}
