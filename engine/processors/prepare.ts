import { UnrecoverableError } from "bullmq";
import { ObjectId } from "mongodb";
import { ROW_CAPS } from "@engine/contracts/job-status";
import { PreparePayload } from "@engine/contracts/queue-names";
import { CsvError, parseCsv } from "@engine/core/csv";
import { normalizeKey } from "@engine/core/dedupe";
import { toObjectId } from "@engine/db/client";
import { failJob, getJob, getJobSummary, startJob, type JobDoc } from "@engine/db/jobs";
import {
  allRows,
  deleteRowsForJob,
  EMPTY_USAGE,
  insertRows,
  pendingRowIds,
  type RowDoc,
} from "@engine/db/rows";
import { enrichJobId, getEnrichQueue } from "@engine/queue/queues";
import { errorMessage } from "@engine/utils/errors";
import { logger } from "@engine/utils/logger";
import { finalizeJob } from "./finalize";

/** Builds row docs: first occurrence of a key is pending, later ones duplicate. */
export function buildRows(job: Pick<JobDoc, "_id" | "config" | "mode">, csvRows: Record<string, string>[]): RowDoc[] {
  const firstByKey = new Map<string, ObjectId>();
  return csvRows.slice(0, ROW_CAPS[job.mode]).map((input, index) => {
    const key = (input[job.config.keyColumn] ?? "").trim();
    const keyNorm = normalizeKey(key) || key.toLowerCase();
    const base = {
      _id: new ObjectId(),
      jobId: job._id,
      index,
      key,
      keyNorm,
      input,
      output: null,
      sources: [],
      evidence: {},
      attempts: 0,
      usage: EMPTY_USAGE,
      costUsd: 0,
    };
    if (!key) {
      return { ...base, status: "failed" as const, error: `Empty "${job.config.keyColumn}" value` };
    }
    const original = firstByKey.get(keyNorm);
    if (original) return { ...base, status: "duplicate" as const, duplicateOf: original };
    firstByKey.set(keyNorm, base._id);
    return { ...base, status: "pending" as const };
  });
}

/**
 * Takes the preview's results for the rows it already researched: a pending row
 * whose preview row (same position, same key) is done becomes done with that
 * output, evidence and cost. Failed preview rows are researched again.
 */
export function reusePreviewRows(docs: RowDoc[], previewRows: RowDoc[]): RowDoc[] {
  const byIndex = new Map(previewRows.map((r) => [r.index, r]));
  return docs.map((doc) => {
    const prev = byIndex.get(doc.index);
    if (doc.status !== "pending" || !prev || prev.status !== "done" || prev.key !== doc.key) return doc;
    return {
      ...doc,
      status: "done" as const,
      output: prev.output,
      sources: prev.sources,
      evidence: prev.evidence,
      rejected: prev.rejected,
      attempts: prev.attempts,
      usage: prev.usage,
      costUsd: prev.costUsd,
    };
  });
}

/** queued job → rows in DB → running. Fails the job on a bad CSV. */
async function createRows(job: JobDoc): Promise<void> {
  let parsed;
  try {
    parsed = parseCsv(job.csv);
  } catch (err) {
    if (err instanceof CsvError) {
      await failJob(job._id, err.message);
      return;
    }
    throw err;
  }
  if (!parsed.headers.includes(job.config.keyColumn)) {
    await failJob(job._id, `Key column "${job.config.keyColumn}" is not in the CSV.`);
    return;
  }

  let docs = buildRows(job, parsed.rows);
  if (job.previewJobId) docs = reusePreviewRows(docs, await allRows(job.previewJobId));
  // A previous attempt may have crashed after inserting: start clean.
  // Safe because enrich jobs are only enqueued once the job is running.
  await deleteRowsForJob(job._id);
  await insertRows(docs);

  const duplicates = docs.filter((d) => d.status === "duplicate").length;
  const failed = docs.filter((d) => d.status === "failed").length;
  const reused = docs.filter((d) => d.status === "done");
  await startJob(
    job._id,
    { total: docs.length - duplicates, duplicates, failed },
    { rowIds: reused.map((d) => d._id), costUsd: reused.reduce((sum, d) => sum + d.costUsd, 0) },
  );
}

/**
 * CSV → rows in DB → one enrich job per pending row. Idempotent: re-running
 * after a crash re-enqueues pending rows, and BullMQ ignores ids it already has.
 * Also enqueues a retry round: the app reopens the job, resets its failed
 * rows to pending and queues prepare again.
 */
export async function processPrepare(data: unknown): Promise<void> {
  const { jobId } = PreparePayload.parse(data);
  const id = toObjectId(jobId);
  if (!id) throw new UnrecoverableError(`Invalid job id "${jobId}"`);

  const job = await getJob(id);
  if (!job) {
    logger.warn({ jobId }, "prepare: job not found");
    return;
  }
  if (job.status === "queued") await createRows(job);

  const current = await getJobSummary(id);
  if (current?.status !== "running") return;

  const pending = await pendingRowIds(id);
  if (pending.length > 0) {
    await getEnrichQueue().addBulk(
      pending.map((rowId) => {
        const row = rowId.toHexString();
        return { name: "enrich", data: { jobId, rowId: row }, opts: { jobId: enrichJobId(jobId, row, current.retries) } };
      }),
    );
  }
  logger.info({ jobId, total: current.total, enqueued: pending.length, duplicates: current.duplicates }, "job prepared");

  if (current.done + current.failed >= current.total) await finalizeJob(id);
}

export async function onPrepareFailure(data: unknown, err: unknown): Promise<void> {
  const parsed = PreparePayload.safeParse(data);
  const id = parsed.success ? toObjectId(parsed.data.jobId) : null;
  if (id) {
    await failJob(id, `Could not prepare the job: ${errorMessage(err)}`);
  }
}
