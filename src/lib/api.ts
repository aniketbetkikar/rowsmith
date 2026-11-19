// Request/response schemas for the API routes. Shared with client
// components (no "server-only"), so both sides use the same shapes.
import { z } from "zod";
import { ColumnSummarySchema } from "@engine/contracts/columns";
import { JobConfigSchema } from "@engine/contracts/job-config";
import { JobModeSchema, JobStatusSchema, RowStatusSchema } from "@engine/contracts/job-status";
import { EvidenceSchema, SourceSchema } from "@engine/contracts/row-result";

/** Upload limits (app-spec section 5). */
export const MAX_CSV_BYTES = 1_000_000;
export const MAX_CSV_ROWS = 500;

export const CreateJobBodySchema = z.object({
  csv: z.string().min(1, "The CSV is empty."),
  config: JobConfigSchema,
  mode: JobModeSchema,
  /** Optional on every run; stored with the job. */
  email: z.email("Enter a valid email address.").optional(),
  /** Full runs only: the completed preview whose rows are reused instead of researched again. */
  previewJobId: z.string().regex(/^[a-f\d]{24}$/i, "Invalid preview job id.").optional(),
});

export const SuggestBodySchema = z.object({
  headers: z.array(z.string().min(1)).min(1).max(100),
  sampleRows: z.array(z.record(z.string(), z.string())).min(1).max(5),
  // every column over the whole file, so the source plan covers every scope value
  columns: z.array(ColumnSummarySchema).max(100).optional(),
});

export const JobIdParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, "Invalid job id."),
});

export const RowsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(50),
});

export const CreateJobResponseSchema = z.object({ jobId: z.string() });

export const RetryJobResponseSchema = z.object({ retried: z.number() });

export const JobStatusResponseSchema = z.object({
  status: JobStatusSchema,
  mode: JobModeSchema,
  total: z.number(),
  done: z.number(),
  failed: z.number(),
  duplicates: z.number(),
  costUsd: z.number(),
  /** Original CSV columns, then the fields being filled. */
  headers: z.array(z.string()),
  fields: z.array(z.string()),
  error: z.string().nullable(),
  /** Cells Rowsmith researched and filled, and cells it searched for but couldn't find. */
  filledCells: z.number(),
  blankCells: z.number(),
  /** Failed rows the retry button can send again. */
  retryable: z.number(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});

export const RowViewSchema = z.object({
  key: z.string(),
  input: z.record(z.string(), z.string()),
  output: z.record(z.string(), z.unknown()).nullable(),
  sources: z.array(SourceSchema),
  /** Quote and sources behind each researched cell, or why it is blank. */
  evidence: EvidenceSchema,
  status: RowStatusSchema,
  error: z.string().nullable(),
  costUsd: z.number(),
});

export const RowsResponseSchema = z.object({
  page: z.number(),
  size: z.number(),
  total: z.number(),
  rows: z.array(RowViewSchema),
});

export type CreateJobBody = z.infer<typeof CreateJobBodySchema>;
export type SuggestBody = z.infer<typeof SuggestBodySchema>;
export type CreateJobResponse = z.infer<typeof CreateJobResponseSchema>;
export type JobStatusResponse = z.infer<typeof JobStatusResponseSchema>;
export type RetryJobResponse = z.infer<typeof RetryJobResponseSchema>;
export type RowView = z.infer<typeof RowViewSchema>;
export type RowsResponse = z.infer<typeof RowsResponseSchema>;
