import "server-only";
import { Queue } from "bullmq";
import { PreparePayload, QUEUE_NAMES } from "@engine/contracts/queue-names";
import { getRedis } from "./redis";

const cache = globalThis as typeof globalThis & {
  __rowsmithPrepareQueue?: Queue<PreparePayload>;
};

/** Producer for the prepare queue (the app never runs workers). */
export function getPrepareQueue(): Queue<PreparePayload> {
  cache.__rowsmithPrepareQueue ??= new Queue<PreparePayload>(QUEUE_NAMES.prepare, {
    connection: getRedis(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });
  return cache.__rowsmithPrepareQueue;
}

/**
 * Enqueues the prepare step once per job and once per retry round (the
 * BullMQ id dedupes repeats).
 */
export async function enqueuePrepare(jobId: string, retry = 0): Promise<void> {
  const data = PreparePayload.parse({ jobId });
  const id = retry > 0 ? `prepare-${jobId}-r${retry}` : `prepare-${jobId}`;
  await getPrepareQueue().add("prepare", data, { jobId: id });
}
