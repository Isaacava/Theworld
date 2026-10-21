import type { Db, ObjectId } from "mongodb";

export type NotificationType = "reply" | "like" | "new_post";
export type NewNotification = {
  recipientId: ObjectId;
  actorId: ObjectId;
  actorUsername: string;
  actorDisplayName: string;
  type: NotificationType;
  postId: ObjectId;
  placeKey: string;
  placeName: string;
  coordinates?: [number, number] | null;
  eventKey: string;
};

export async function createNotification(db: Db, input: NewNotification): Promise<void> {
  if (input.recipientId.equals(input.actorId)) return;
  await db.collection("notifications").updateOne(
    { eventKey: input.eventKey },
    { $setOnInsert: { ...input, coordinates: input.coordinates ?? null, createdAt: new Date(), readAt: null } },
    { upsert: true },
  );
}
