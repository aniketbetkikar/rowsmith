import { Redis } from "ioredis";
import { getRedisEnv } from "@engine/config/env";

let connection: Redis | undefined;

/** Shared ioredis connection for BullMQ queues and workers. */
export function getRedis(): Redis {
  connection ??= new Redis(getRedisEnv().REDIS_URL, {
    // Required by BullMQ: blocking commands must not time out.
    maxRetriesPerRequest: null,
  });
  return connection;
}

export async function closeRedis(): Promise<void> {
  const current = connection;
  connection = undefined;
  await current?.quit();
}
