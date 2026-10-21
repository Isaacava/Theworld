import "server-only";

import { MongoClient, type Db } from "mongodb";

type MongoGlobal = typeof globalThis & {
  __theWorldMongoClientPromise?: Promise<MongoClient>;
  __theWorldIndexPromises?: Record<string, Promise<void>>;
};

const mongoGlobal = globalThis as MongoGlobal;

export function isMongoConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI?.trim());
}

export async function getDatabase(): Promise<Db> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    throw new Error("MONGODB_URI is not configured.");
  }

  if (!mongoGlobal.__theWorldMongoClientPromise) {
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
    });
    mongoGlobal.__theWorldMongoClientPromise = client.connect();
  }

  const client = await mongoGlobal.__theWorldMongoClientPromise;
  const dbName = process.env.MONGODB_DB?.trim() || "theworld";
  const db = client.db(dbName);

  if (!mongoGlobal.__theWorldIndexPromises) {
    mongoGlobal.__theWorldIndexPromises = {};
  }

  if (!mongoGlobal.__theWorldIndexPromises[dbName]) {
    mongoGlobal.__theWorldIndexPromises[dbName] = Promise.all([
      db.collection("users").createIndex({ email: 1 }, { unique: true, name: "users_email_unique" }),
      db.collection("users").createIndex({ username: 1 }, { unique: true, name: "users_username_unique" }),
      db.collection("sessions").createIndex({ tokenHash: 1 }, { unique: true, name: "sessions_token_hash_unique" }),
      db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "sessions_expiry_ttl" }),
      db.collection("posts").createIndex({ placeKey: 1, createdAt: -1 }, { name: "posts_place_recent" }),
      db.collection("posts").createIndex({ authorId: 1, createdAt: -1 }, { name: "posts_author_recent" }),
      db.collection("replies").createIndex({ postId: 1, createdAt: 1 }, { name: "replies_post_recent" }),
      db.collection("replies").createIndex({ authorId: 1, createdAt: -1 }, { name: "replies_author_recent" }),
      db.collection("postLikes").createIndex({ postId: 1, userId: 1 }, { unique: true, name: "post_likes_post_user_unique" }),
      db.collection("postLikes").createIndex({ userId: 1, createdAt: -1 }, { name: "post_likes_user_recent" }),
      db.collection("bookmarks").createIndex({ postId: 1, userId: 1 }, { unique: true, name: "bookmarks_post_user_unique" }),
      db.collection("bookmarks").createIndex({ userId: 1, createdAt: -1 }, { name: "bookmarks_user_recent" }),
      db.collection("notifications").createIndex({ recipientId: 1, createdAt: -1 }, { name: "notifications_recipient_recent" }),
      db.collection("notifications").createIndex({ recipientId: 1, readAt: 1, createdAt: -1 }, { name: "notifications_unread_recent" }),
      db.collection("notifications").createIndex({ eventKey: 1 }, { unique: true, sparse: true, name: "notifications_event_unique" }),
      db.collection("reports").createIndex({ reporterId: 1, targetType: 1, targetId: 1 }, { unique: true, name: "reports_reporter_target_unique" }),
      db.collection("reports").createIndex({ status: 1, createdAt: -1 }, { name: "reports_status_recent" }),
      db.collection("followedPlaces").createIndex({ userId: 1, placeKey: 1 }, { unique: true, name: "followed_places_user_place_unique" }),
      db.collection("followedPlaces").createIndex({ userId: 1, followedAt: -1 }, { name: "followed_places_user_recent" }),
      db.collection("communities").createIndex({ placeKey: 1 }, { unique: true, name: "communities_place_key_unique" }),
      db.collection("placeVerificationCache").createIndex({ placeKey: 1 }, { unique: true, name: "place_verification_place_key_unique" }),
      db.collection("placeVerificationCache").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "place_verification_expiry_ttl" }),
      db.collection("presenceAttempts").createIndex({ userId: 1, createdAt: -1 }, { name: "presence_attempts_user_recent" }),
      db.collection("presenceAttempts").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "presence_attempts_expiry_ttl" }),
      db.collection("geocoderSearchCache").createIndex({ cacheKey: 1 }, { unique: true, name: "geocoder_search_cache_key_unique" }),
      db.collection("geocoderSearchCache").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "geocoder_search_cache_expiry_ttl" }),
      db.collection("geocoderReverseCache").createIndex({ cacheKey: 1 }, { unique: true, name: "geocoder_reverse_cache_key_unique" }),
      db.collection("geocoderReverseCache").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "geocoder_reverse_cache_expiry_ttl" }),
    ]).then(() => undefined);
  }

  await mongoGlobal.__theWorldIndexPromises[dbName];
  return db;
}
