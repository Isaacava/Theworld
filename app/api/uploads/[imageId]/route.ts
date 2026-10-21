import { GridFSBucket, ObjectId } from "mongodb";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ imageId: string }> };
const IMAGE_ID = /^[a-f\d]{24}$/i;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function GET(_request: Request, context: RouteContext) {
  const { imageId } = await context.params;
  if (!IMAGE_ID.test(imageId)) return NextResponse.json({ error: "That image identifier is invalid." }, { status: 400 });
  if (!isMongoConfigured()) return NextResponse.json({ error: "Image storage is unavailable." }, { status: 503 });
  try {
    const db = await getDatabase();
    const id = new ObjectId(imageId);
    const file = await db.collection("postImages.files").findOne({ _id: id });
    if (!file || typeof file.contentType !== "string" || !ALLOWED_MIME_TYPES.has(file.contentType)) {
      return NextResponse.json({ error: "That image is no longer available." }, { status: 404 });
    }
    // Images are public only while referenced by a visible community post.
    const post = await db.collection("posts").findOne({ images: id, status: "visible" }, { projection: { _id: 1 } });
    if (!post) return NextResponse.json({ error: "That image is no longer available." }, { status: 404 });
    const stream = new GridFSBucket(db, { bucketName: "postImages" }).openDownloadStream(id);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.length ?? ""),
        "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "same-site",
      },
    });
  } catch {
    return NextResponse.json({ error: "We couldn't load that image." }, { status: 503 });
  }
}
