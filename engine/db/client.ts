import { MongoClient, ObjectId, type Db } from "mongodb";
import { z } from "zod";
import { getDbEnv } from "@engine/config/env";

// One client per process. Cached on globalThis so Next.js hot reloads in
// dev reuse the connection instead of opening a new pool each time.
const cache = globalThis as typeof globalThis & {
  __rowsmithMongo?: MongoClient;
};

export function getMongoClient(): MongoClient {
  cache.__rowsmithMongo ??= new MongoClient(getDbEnv().MONGODB_URI, {
    // Optional fields set to undefined are omitted, not stored as null.
    ignoreUndefined: true,
  });
  return cache.__rowsmithMongo;
}

/** The database named in MONGODB_URI. */
export function getDb(): Db {
  return getMongoClient().db();
}

export async function closeDb(): Promise<void> {
  const client = cache.__rowsmithMongo;
  cache.__rowsmithMongo = undefined;
  await client?.close();
}

export const ObjectIdSchema = z.instanceof(ObjectId);

const HEX_ID = /^[a-f\d]{24}$/i;

/** Parses a 24-char hex id; null for anything else. */
export function toObjectId(id: string): ObjectId | null {
  return HEX_ID.test(id) ? ObjectId.createFromHexString(id) : null;
}

export async function ensureIndexes(): Promise<void> {
  const db = getDb();
  await Promise.all([
    db.collection("rows").createIndex({ jobId: 1, index: 1 }),
    db.collection("rows").createIndex({ jobId: 1, keyNorm: 1 }),
    db.collection("jobs").createIndex({ createdAt: -1 }),
  ]);
}
