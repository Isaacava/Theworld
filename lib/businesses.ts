import "server-only";

import { ObjectId, type Db } from "mongodb";
import { getCurrentUser } from "@/lib/auth";

export const OSM_FEATURE_KEY = /^(node|way|relation)-[1-9]\d{0,17}$/;
export const MONGO_ID = /^[a-f\d]{24}$/i;

export type PublicBusiness = {
  id: string;
  osmPlaceKey: string;
  name: string;
  category: string;
  address: string;
  coordinates: [number, number];
  status: "pending" | "verified" | "rejected";
  isVerified: boolean;
  isOwner: boolean;
  proofUrl?: string;
  website?: string;
};

export async function currentUserSafe() {
  try {
    return await getCurrentUser();
  } catch {
    return null;
  }
}

export async function isAdmin(db: Db, userId: string): Promise<boolean> {
  if (!ObjectId.isValid(userId)) return false;
  const user = await db.collection("users").findOne(
    { _id: new ObjectId(userId) },
    { projection: { role: 1 } },
  );
  return user?.role === "admin";
}

export function businessDto(record: Record<string, unknown>, currentUserId?: string): PublicBusiness {
  const coords = Array.isArray(record.coordinates) && record.coordinates.length === 2 &&
    typeof record.coordinates[0] === "number" && typeof record.coordinates[1] === "number"
    ? [record.coordinates[0], record.coordinates[1]] as [number, number]
    : [0, 0] as [number, number];
  const status = record.status === "verified" || record.status === "rejected" ? record.status : "pending";
  return {
    id: String(record._id ?? ""),
    osmPlaceKey: typeof record.osmPlaceKey === "string" ? record.osmPlaceKey : "",
    name: typeof record.name === "string" ? record.name : "Local business",
    category: typeof record.category === "string" ? record.category : "Business",
    address: typeof record.address === "string" ? record.address : "",
    coordinates: coords,
    status,
    isVerified: status === "verified" && record.verificationStatus === "verified",
    isOwner: Boolean(currentUserId && record.ownerId instanceof ObjectId && record.ownerId.toHexString() === currentUserId),
    ...(typeof record.proofUrl === "string" ? { proofUrl: record.proofUrl } : {}),
    ...(typeof record.officialWebsite === "string" ? { website: record.officialWebsite } : {}),
  };
}

export async function getVerifiedBusiness(db: Db, value: string) {
  if (!MONGO_ID.test(value)) return null;
  const record = await db.collection("businesses").findOne({
    _id: new ObjectId(value),
    status: "verified",
    verificationStatus: "verified",
  });
  return record;
}
