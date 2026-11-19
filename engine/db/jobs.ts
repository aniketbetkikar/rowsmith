import { ObjectId } from "mongodb";
import { z } from "zod";
import { JobConfigSchema } from "@engine/contracts/job-config";
import { JobModeSchema, JobStatusSchema } from "@engine/contracts/job-status";
import { getDb, ObjectIdSchema } from "./client";

const count = z.number().int().nonnegative();

export const JobDocSchema = z.object({
  _id: ObjectIdSchema,
  status: JobStatusSchema,
  mode: JobModeSchema,
  config: JobConfigSchema,
  csv: z.string(),
  headers: z.array(z.string()),
  /** Rows to enrich (excludes duplicates). */
  total: count,
  done: count,
  failed: count,
  duplicates: count,
  costUsd: z.number().nonnegative(),
  /** Rows already added to the counters: makes counting idempotent. */
  countedRows: z.array(ObjectIdSchema),
  /** Times the failed rows were sent again (gives each round fresh BullMQ ids). */
  retries: count.default(0),
  email: z.string().optional(),
  /** Full runs: the completed preview (same CSV start and config) whose done rows are reused. */
  previewJobId: ObjectIdSchema.optional(),
  createdAt: z.date(),
  startedAt: z.date().optional(),
  finishedAt: z.date().optional(),
  error: z.string().optional(),
});

/** Everything except the raw CSV and the internal counted-row ids. */
export const JobSummarySchema = JobDocSchema.omit({ csv: true, countedRows: true });

export const CreateJobInputSchema = z.object({
  csv: z.string(),
  headers: z.array(z.string()),
  config: JobConfigSchema,
  mode: JobModeSchema,
  email: z.email().optional(),
  previewJobId: ObjectIdSchema.optional(),
});

export type JobDoc = z.infer<typeof JobDocSchema>;
export type JobSummary = z.infer<typeof JobSummarySchema>;
export type CreateJobInput = z.input<typeof CreateJobInputSchema>;

export type JobCounters = Pick<JobDoc, "total" | "done" | "failed">;

const SUMMARY_PROJECTION = { csv: 0, countedRows: 0 } as const;

function jobs() {
  return getDb().collection<JobDoc>("jobs");
}

/** Inserts a queued job and returns its id. */
export async function createJob(input: CreateJobInput): Promise<ObjectId> {
  const data = CreateJobInputSchema.parse(input);
  const doc: JobDoc = {
    _id: new ObjectId(),
    ...data,
    status: "queued",
    total: 0,
    done: 0,
    failed: 0,
    duplicates: 0,
    costUsd: 0,
    countedRows: [],
    retries: 0,
    createdAt: new Date(),
  };
  const { insertedId } = await jobs().insertOne(doc);
  return insertedId;
}

/** Full job, including the raw CSV. Used by the prepare step. */
export async function getJob(id: ObjectId): Promise<JobDoc | null> {
  const doc = await jobs().findOne({ _id: id });
  return doc ? JobDocSchema.parse(doc) : null;
}

/** Job without the CSV: cheap enough for status polling and per-row work. */
export async function getJobSummary(id: ObjectId): Promise<JobSummary | null> {
  const doc = await jobs().findOne({ _id: id }, { projection: SUMMARY_PROJECTION });
  return doc ? JobSummarySchema.parse(doc) : null;
}

/**
 * queued → running with the row counts. Rows reused from a preview arrive
 * already done: they are counted here (done, costUsd, countedRows).
 * False if the job was not queued.
 */
export async function startJob(
  id: ObjectId,
  counts: { total: number; duplicates: number; failed: number },
  reused: { rowIds: ObjectId[]; costUsd: number } = { rowIds: [], costUsd: 0 },
): Promise<boolean> {
  const { modifiedCount } = await jobs().updateOne(
    { _id: id, status: "queued" },
    {
      $set: {
        ...counts,
        done: reused.rowIds.length,
        costUsd: reused.costUsd,
        countedRows: reused.rowIds,
        status: "running",
        startedAt: new Date(),
      },
    },
  );
  return modifiedCount === 1;
}

/**
 * Adds one finished row to the job counters. Atomic and idempotent: a row
 * already in countedRows is ignored, so retries can never double-count.
 * Returns the updated counters, or null if the row was already counted.
 */
export async function recordRow(
  id: ObjectId,
  rowId: ObjectId,
  result: { status: "done" | "failed"; costUsd: number },
): Promise<JobCounters | null> {
  const doc = await jobs().findOneAndUpdate(
    { _id: id, countedRows: { $ne: rowId } },
    {
      $inc: { [result.status]: 1, costUsd: result.costUsd },
      $push: { countedRows: rowId },
    },
    { returnDocument: "after", projection: { total: 1, done: 1, failed: 1 } },
  );
  return doc ? { total: doc.total, done: doc.done, failed: doc.failed } : null;
}

/** running → completed. Runs once; false if the job was not running. */
export async function completeJob(id: ObjectId): Promise<boolean> {
  const { modifiedCount } = await jobs().updateOne(
    { _id: id, status: "running" },
    { $set: { status: "completed", finishedAt: new Date() } },
  );
  return modifiedCount === 1;
}

/**
 * completed → running to retry failed rows: takes them out of the counters
 * and bumps `retries`. Runs once per round; null if the job was not completed.
 * Their earlier cost stays in costUsd (it was spent).
 */
export async function reopenJob(id: ObjectId, rowIds: ObjectId[]): Promise<number | null> {
  const doc = await jobs().findOneAndUpdate(
    { _id: id, status: "completed" },
    {
      $set: { status: "running" },
      $unset: { finishedAt: "" },
      $inc: { failed: -rowIds.length, retries: 1 },
      $pullAll: { countedRows: rowIds },
    },
    { returnDocument: "after", projection: { retries: 1 } },
  );
  return doc ? doc.retries : null;
}

/** Job-level failure (bad CSV, prepare crashed). Never overrides a finished job. */
export async function failJob(id: ObjectId, error: string): Promise<boolean> {
  const { modifiedCount } = await jobs().updateOne(
    { _id: id, status: { $in: ["queued", "running"] } },
    { $set: { status: "failed", error, finishedAt: new Date() } },
  );
  return modifiedCount === 1;
}
