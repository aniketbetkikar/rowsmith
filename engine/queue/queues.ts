import { Queue, type DefaultJobOptions } from "bullmq";
import { QUEUE_NAMES, type EnrichPayload } from "@engine/contracts/queue-names";
import { getRedis } from "./connection";

// Gemini 503s ("high demand") can last a minute or two: 5 attempts with
// waits of 10, 20, 40 and 80 s ride out most spikes before a row fails.
export const ENRICH_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 10_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

let enrichQueue: Queue<EnrichPayload> | undefined;

/** Producer for per-row enrich jobs (used by the prepare processor). */
export function getEnrichQueue(): Queue<EnrichPayload> {
  enrichQueue ??= new Queue<EnrichPayload>(QUEUE_NAMES.enrich, {
    connection: getRedis(),
    defaultJobOptions: ENRICH_JOB_OPTIONS,
  });
  return enrichQueue;
}

/**
 * BullMQ custom ids cannot contain ":", so the spec's separator is "-".
 * Each retry round gets its own suffix: BullMQ ignores ids it still holds.
 */
export function enrichJobId(jobId: string, rowId: string, retry = 0): string {
  return retry > 0 ? `${jobId}-${rowId}-r${retry}` : `${jobId}-${rowId}`;
}

export async function closeQueues(): Promise<void> {
  const queue = enrichQueue;
  enrichQueue = undefined;
  await queue?.close();
}
