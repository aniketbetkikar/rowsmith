import { z } from "zod";

export const JobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);

export const RowStatusSchema = z.enum([
  "pending",
  "done",
  "failed",
  "duplicate",
]);

export const JobModeSchema = z.enum(["preview", "full"]);

export type JobStatus = z.infer<typeof JobStatusSchema>;
export type RowStatus = z.infer<typeof RowStatusSchema>;
export type JobMode = z.infer<typeof JobModeSchema>;

/** Max rows processed per job mode. Shared so the app can enforce them. */
export const ROW_CAPS = {
  preview: 5,
  full: 25, // free demo cap
} as const satisfies Record<JobMode, number>;
