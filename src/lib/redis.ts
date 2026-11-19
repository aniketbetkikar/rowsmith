import "server-only";
import { Redis } from "ioredis";
import { env } from "./env";

// One connection per server process, reused across dev hot reloads.
const cache = globalThis as typeof globalThis & { __rowsmithRedis?: Redis };

/** Shared Redis client for the rate limiter and the queue producer. */
export function getRedis(): Redis {
  cache.__rowsmithRedis ??= new Redis(env.REDIS_URL, {
    // Fail requests quickly when Redis is down instead of queueing them.
    maxRetriesPerRequest: 2,
    connectTimeout: 5000,
  });
  return cache.__rowsmithRedis;
}
