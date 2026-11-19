import { UnrecoverableError } from "bullmq";
import type { ObjectId } from "mongodb";
import { EnrichPayload } from "@engine/contracts/queue-names";
import { enrichRow } from "@engine/core/enrich-row";
import { toObjectId } from "@engine/db/client";
import { getJobSummary, recordRow } from "@engine/db/jobs";
import { getRow, markRowFailed, saveResult } from "@engine/db/rows";
import { errorMessage } from "@engine/utils/errors";
import { logger } from "@engine/utils/logger";
import { finalizeJob } from "./finalize";

function parseIds(data: unknown): { jobId: ObjectId; rowId: ObjectId } {
  const payload = EnrichPayload.parse(data);
  const jobId = toObjectId(payload.jobId);
  const rowId = toObjectId(payload.rowId);
  if (!jobId || !rowId) throw new UnrecoverableError("Invalid enrich payload ids");
  return { jobId, rowId };
}

/**
 * Adds a finished row to the job counters exactly once, then finalizes the
 * job when every row is counted. Safe to call any number of times.
 */
export async function countRow(jobId: ObjectId, rowId: ObjectId): Promise<void> {
  const row = await getRow(rowId);
  if (!row || (row.status !== "done" && row.status !== "failed")) return;

  const counters = await recordRow(jobId, rowId, { status: row.status, costUsd: row.costUsd });
  if (counters && counters.done + counters.failed >= counters.total) {
    await finalizeJob(jobId);
  }
}

/**
 * One row → enrichRow() → save → count. Transient errors propagate so
 * BullMQ retries with backoff. A row that is already saved (an earlier
 * attempt crashed before counting) skips straight to the count step.
 */
export async function processEnrich(data: unknown): Promise<void> {
  const { jobId, rowId } = parseIds(data);

  const row = await getRow(rowId);
  if (!row) {
    logger.warn({ rowId: rowId.toHexString() }, "enrich: row not found");
    return;
  }

  if (row.status === "pending") {
    const job = await getJobSummary(jobId);
    if (!job || job.status !== "running") return;

    const result = await enrichRow(job.config, { key: row.key, input: row.input });
    const saved = await saveResult(rowId, result);
    logger.debug(
      { jobId: jobId.toHexString(), rowId: rowId.toHexString(), status: result.status, saved, costUsd: result.costUsd },
      "row enriched",
    );
  }

  await countRow(jobId, rowId);
}

/** Last attempt failed: mark the row failed with the reason and count it. */
export async function onFinalFailure(data: unknown, err: unknown): Promise<void> {
  const { jobId, rowId } = parseIds(data);
  await markRowFailed(rowId, errorMessage(err));
  await countRow(jobId, rowId);
}
