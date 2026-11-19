import { z } from "zod";

export const QUEUE_NAMES = {
  prepare: "rowsmith-prepare",
  enrich: "rowsmith-enrich",
} as const;

export const PreparePayload = z.object({ jobId: z.string() });
export const EnrichPayload = z.object({ jobId: z.string(), rowId: z.string() });

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
export type PreparePayload = z.infer<typeof PreparePayload>;
export type EnrichPayload = z.infer<typeof EnrichPayload>;
