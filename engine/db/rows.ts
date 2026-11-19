import type { AnyBulkWriteOperation, ObjectId } from "mongodb";
import { z } from "zod";
import { RowStatusSchema } from "@engine/contracts/job-status";
import { EvidenceSchema, RejectedSchema, SourceSchema, UsageSchema, type Usage } from "@engine/contracts/row-result";
import type { EnrichResult } from "@engine/core/enrich-row";
import { getDb, ObjectIdSchema } from "./client";

export const RowDocSchema = z.object({
  _id: ObjectIdSchema,
  jobId: ObjectIdSchema,
  /** Original order in the CSV. */
  index: z.number().int().nonnegative(),
  key: z.string(),
  keyNorm: z.string(),
  input: z.record(z.string(), z.string()),
  output: z.record(z.string(), z.unknown()).nullable(),
  sources: z.array(SourceSchema),
  /** Quote and sources per filled cell, or why it is blank (rows saved before evidence: {}). */
  evidence: EvidenceSchema.default({}),
  /** Values our checks dropped (debugging only; never returned by the API or exported). */
  rejected: RejectedSchema.optional(),
  status: RowStatusSchema,
  duplicateOf: ObjectIdSchema.optional(),
  attempts: z.number().int().nonnegative(),
  usage: UsageSchema,
  costUsd: z.number().nonnegative(),
  error: z.string().optional(),
});

export type RowDoc = z.infer<typeof RowDocSchema>;

export const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  searchCalls: 0,
};

function rows() {
  return getDb().collection<RowDoc>("rows");
}

export async function insertRows(docs: RowDoc[]): Promise<void> {
  if (docs.length === 0) return;
  await rows().insertMany(docs.map((d) => RowDocSchema.parse(d)));
}

export async function deleteRowsForJob(jobId: ObjectId): Promise<void> {
  await rows().deleteMany({ jobId });
}

export async function getRow(id: ObjectId): Promise<RowDoc | null> {
  const doc = await rows().findOne({ _id: id });
  return doc ? RowDocSchema.parse(doc) : null;
}

export async function pendingRowIds(jobId: ObjectId): Promise<ObjectId[]> {
  const docs = await rows()
    .find({ jobId, status: "pending" }, { projection: { _id: 1 } })
    .sort({ index: 1 })
    .toArray();
  return docs.map((d) => d._id);
}

/** Failed rows worth sending again (rows with an empty key would fail the same way). */
export async function retryableRowIds(jobId: ObjectId): Promise<ObjectId[]> {
  const docs = await rows()
    .find({ jobId, status: "failed", key: { $ne: "" } }, { projection: { _id: 1 } })
    .toArray();
  return docs.map((d) => d._id);
}

/**
 * failed → pending for a retry. Cost and usage are cleared so the row is
 * counted afresh (the job keeps what the failed attempt spent).
 */
export async function resetRows(ids: ObjectId[]): Promise<number> {
  const { modifiedCount } = await rows().updateMany(
    { _id: { $in: ids }, status: "failed" },
    { $set: { status: "pending", usage: EMPTY_USAGE, costUsd: 0 }, $unset: { error: "" } },
  );
  return modifiedCount;
}

/**
 * Stores an enrichRow() result. Only applies while the row is still
 * pending, so a retry can never overwrite a saved result.
 * Returns false if another attempt already saved it.
 */
export async function saveResult(id: ObjectId, result: EnrichResult): Promise<boolean> {
  const { modifiedCount } = await rows().updateOne(
    { _id: id, status: "pending" },
    {
      $set: {
        status: result.status,
        output: result.output,
        sources: result.sources,
        evidence: result.evidence,
        rejected: result.rejected,
        usage: result.usage,
        attempts: result.attempts,
        costUsd: result.costUsd,
        error: result.error,
      },
    },
  );
  return modifiedCount === 1;
}

/** Final-failure path: pending → failed with a reason (same guard as saveResult). */
export async function markRowFailed(id: ObjectId, error: string): Promise<boolean> {
  const { modifiedCount } = await rows().updateOne(
    { _id: id, status: "pending" },
    { $set: { status: "failed", error } },
  );
  return modifiedCount === 1;
}

/** Paged rows in original order, plus the job's total row count. */
export async function listRows(
  jobId: ObjectId,
  page: { page: number; size: number },
): Promise<{ rows: RowDoc[]; total: number }> {
  const [docs, total] = await Promise.all([
    rows()
      .find({ jobId })
      .sort({ index: 1 })
      .skip((page.page - 1) * page.size)
      .limit(page.size)
      .toArray(),
    rows().countDocuments({ jobId }),
  ]);
  return { rows: docs.map((d) => RowDocSchema.parse(d)), total };
}

export const RowCellsSchema = RowDocSchema.pick({ status: true, input: true, output: true });
export type RowCells = z.infer<typeof RowCellsSchema>;

/** Just status, input and output of every row: enough to count filled cells. */
export async function rowCells(jobId: ObjectId): Promise<RowCells[]> {
  const docs = await rows()
    .find({ jobId }, { projection: { _id: 0, status: 1, input: 1, output: 1 } })
    .toArray();
  return docs.map((d) => RowCellsSchema.parse(d));
}

/** Every row of a job in original order (download; capped at 500 rows). */
export async function allRows(jobId: ObjectId): Promise<RowDoc[]> {
  const docs = await rows().find({ jobId }).sort({ index: 1 }).toArray();
  return docs.map((d) => RowDocSchema.parse(d));
}

/**
 * Copies output, sources, evidence and error from each original row to its duplicate
 * rows. Duplicates keep status "duplicate" and cost nothing. Idempotent.
 */
export async function copyToDuplicates(jobId: ObjectId): Promise<number> {
  const duplicates = await rows()
    .find({ jobId, status: "duplicate" }, { projection: { _id: 1, duplicateOf: 1 } })
    .toArray();
  const originalIds = duplicates.flatMap((d) => (d.duplicateOf ? [d.duplicateOf] : []));
  if (originalIds.length === 0) return 0;

  const originals = await rows()
    .find(
      { jobId, _id: { $in: originalIds } },
      { projection: { output: 1, sources: 1, evidence: 1, error: 1 } },
    )
    .toArray();
  const byId = new Map(originals.map((o) => [o._id.toHexString(), o]));

  const ops: AnyBulkWriteOperation<RowDoc>[] = duplicates.flatMap((d) => {
    const original = d.duplicateOf ? byId.get(d.duplicateOf.toHexString()) : undefined;
    if (!original) return [];
    return [
      {
        updateOne: {
          filter: { _id: d._id },
          update: {
            $set: {
              output: original.output,
              sources: original.sources,
              evidence: original.evidence ?? {},
              error: original.error,
            },
          },
        },
      },
    ];
  });
  if (ops.length > 0) await rows().bulkWrite(ops);
  return ops.length;
}
