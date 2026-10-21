import { GridFSBucket, ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasSameOrigin } from "@/lib/http";
import { getDatabase, isMongoConfigured } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 2_500_000;
const MAX_USER_IMAGES_PER_DAY = 50;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function sniffImageType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
    return NextResponse.json({ error: "Upload an image using the image picker." }, { status: 415 });
  }
  if (!isMongoConfigured()) return NextResponse.json({ error: "Image uploads are unavailable until storage is configured." }, { status: 503 });

  let user;
  try { user = await getCurrentUser(); } catch { return NextResponse.json({ error: "The account service is temporarily unavailable." }, { status: 503 }); }
  if (!user) return NextResponse.json({ error: "Sign in before uploading images." }, { status: 401 });

  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "The upload form is invalid." }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose an image file." }, { status: 400 });
  if (file.size < 16 || file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Each image must be smaller than 2.5 MB." }, { status: 413 });
  }

  let buffer: Buffer;
  try { buffer = Buffer.from(await file.arrayBuffer()); } catch {
    return NextResponse.json({ error: "The selected image could not be read." }, { status: 400 });
  }
  const detectedType = sniffImageType(buffer);
  if (!detectedType || !ALLOWED_MIME_TYPES.has(detectedType)) {
    return NextResponse.json({ error: "Only real JPEG, PNG, and WebP image files are supported. SVG and other active formats are not allowed." }, { status: 415 });
  }

  try {
    const db = await getDatabase();
    const userId = new ObjectId(user.id);
    const bucket = new GridFSBucket(db, { bucketName: "postImages" });
    const files = db.collection("postImages.files");
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const uploadedToday = await files.countDocuments({ "metadata.userId": userId, uploadDate: { $gte: dayAgo } });
    if (uploadedToday >= MAX_USER_IMAGES_PER_DAY) {
      return NextResponse.json({ error: "You've reached the daily image-upload limit. Try again tomorrow." }, { status: 429 });
    }

    // Remove unreferenced temporary uploads older than 30 minutes for this user.
    const expired = await files.find({ "metadata.userId": userId, uploadDate: { $lt: new Date(now.getTime() - 30 * 60 * 1000) } })
      .project({ _id: 1 }).limit(20).toArray();
    for (const old of expired) {
      if (!(old._id instanceof ObjectId)) continue;
      const attached = await db.collection("posts").findOne({ images: old._id }, { projection: { _id: 1 } });
      if (!attached) {
        try { await bucket.delete(old._id); } catch { /* A stale cleanup must not block a fresh upload. */ }
      }
    }

    const safeFilename = file.name.replace(/[\\/]/g, "_").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "community-image";
    const stream = bucket.openUploadStream(safeFilename, {
      contentType: detectedType,
      metadata: { userId, username: user.username, uploadedAt: now },
    });
    await new Promise<void>((resolve, reject) => {
      stream.once("error", reject);
      stream.once("finish", resolve);
      stream.end(buffer);
    });
    const imageId = String(stream.id);
    return NextResponse.json({
      image: { id: imageId, url: `/api/uploads/${imageId}`, mimeType: detectedType, size: buffer.length },
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[uploads] Image upload failed", error instanceof Error ? { name: error.name, message: error.message } : "Unknown error");
    return NextResponse.json({ error: "We couldn't upload that image. Please try a smaller file or try again." }, { status: 503 });
  }
}
