// Integration tests: real MongoDB (a throwaway *_test database), with
// enrichRow() and the BullMQ producer mocked. Skipped when Mongo is not
// reachable. Override the database with MONGODB_TEST_URI.

import { MongoClient, type ObjectId } from "mongodb";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobConfig } from "@engine/contracts/job-config";
import type { EnrichResult } from "@engine/core/enrich-row";

const env = vi.hoisted(() => {
  const uri = process.env.MONGODB_TEST_URI ?? "mongodb://localhost:27017/rowsmith_test";
  process.env.MONGODB_URI = uri;
  process.env.LOG_LEVEL = "silent";
  return { uri };
});

type BulkJob = { data: { jobId: string; rowId: string }; opts: { jobId: string } };

const mocks = vi.hoisted(() => ({
  enrichRow: vi.fn(),
  addBulk: vi.fn<(jobs: BulkJob[]) => Promise<void>>(),
}));

vi.mock("@engine/core/enrich-row", () => ({ enrichRow: mocks.enrichRow }));
vi.mock("@engine/queue/queues", () => ({
  getEnrichQueue: () => ({ addBulk: mocks.addBulk }),
  enrichJobId: (jobId: string, rowId: string, retry = 0) =>
    retry > 0 ? `${jobId}-${rowId}-r${retry}` : `${jobId}-${rowId}`,
}));

const { closeDb, getDb, ensureIndexes } = await import("@engine/db/client");
const { createJob, getJob, reopenJob } = await import("@engine/db/jobs");
const { allRows, saveResult, getRow, resetRows, retryableRowIds } = await import("@engine/db/rows");
const { processPrepare } = await import("./prepare");
const { countRow, onFinalFailure, processEnrich } = await import("./enrich");

const dbName = new URL(env.uri).pathname.slice(1);
if (!dbName.endsWith("_test")) {
  throw new Error(`Refusing to run against "${dbName}": test database names must end in _test.`);
}

const probe = new MongoClient(env.uri, { serverSelectionTimeoutMS: 1500 });
const mongoUp = await probe.connect().then(
  () => true,
  () => false,
);
await probe.close();

const config: JobConfig = {
  keyColumn: "name",
  entityDescription: "Software companies",
  contextColumns: [],
  fields: [{ name: "founded", type: "year", description: "Year founded" }],
};

function result(cost: number, founded: number): EnrichResult {
  return {
    status: "done",
    output: { founded },
    sources: [{ url: "https://example.com/", title: "Example" }],
    rejected: {},
    evidence: { founded: { quotes: [{ text: `Founded in ${founded}.`, sources: [1] }] } },
    usage: { inputTokens: 100, outputTokens: 10, cachedTokens: 0, searchCalls: 1 },
    attempts: 1,
    costUsd: cost,
  };
}

async function newJob(csv: string, mode: "preview" | "full" = "full"): Promise<ObjectId> {
  return createJob({ csv, headers: ["name"], config, mode, email: "test@example.com" });
}

/** Payloads passed to addBulk, as plain { jobId, rowId, id }. */
function enqueued() {
  return mocks.addBulk.mock.calls.flatMap(([jobs]) =>
    jobs.map((j) => ({ ...j.data, id: j.opts.jobId })),
  );
}

async function job(id: ObjectId) {
  const doc = await getJob(id);
  if (!doc) throw new Error("job missing");
  return doc;
}

describe.skipIf(!mongoUp)("pipeline (MongoDB integration)", () => {
  beforeEach(async () => {
    await getDb().dropDatabase();
    await ensureIndexes();
    mocks.enrichRow.mockReset();
    mocks.addBulk.mockReset();
  });

  afterAll(async () => {
    if (mongoUp && getDb().databaseName.endsWith("_test")) await getDb().dropDatabase();
    await closeDb();
  });

  it("prepare: builds rows, marks duplicates and empty keys, enqueues pending rows", async () => {
    const id = await newJob('name,city\nNotion,SF\nCanva,Sydney\n"Notion, Inc.",SF\n,Pune\n');
    await processPrepare({ jobId: id.toHexString() });

    const rows = await allRows(id);
    expect(rows.map((r) => [r.key, r.status])).toEqual([
      ["Notion", "pending"],
      ["Canva", "pending"],
      ["Notion, Inc.", "duplicate"],
      ["", "failed"],
    ]);
    expect(rows[2]?.duplicateOf?.equals(rows[0]!._id)).toBe(true);

    const doc = await job(id);
    expect(doc).toMatchObject({ status: "running", total: 3, duplicates: 1, failed: 1, done: 0 });
    expect(doc.startedAt).toBeInstanceOf(Date);

    const jobs = enqueued();
    expect(jobs.map((j) => j.rowId)).toEqual([rows[0]!._id.toHexString(), rows[1]!._id.toHexString()]);
    for (const j of jobs) {
      expect(j.id).toBe(`${id.toHexString()}-${j.rowId}`);
      expect(j.id).not.toContain(":");
    }
  });

  it("prepare: is idempotent when re-run", async () => {
    const id = await newJob("name\nNotion\nCanva\n");
    await processPrepare({ jobId: id.toHexString() });
    await processPrepare({ jobId: id.toHexString() });

    expect(await allRows(id)).toHaveLength(2);
    const [first, second] = mocks.addBulk.mock.calls;
    expect(second).toEqual(first);
    expect((await job(id)).total).toBe(2);
  });

  it("prepare: applies the row cap for the job mode", async () => {
    const names = Array.from({ length: 8 }, (_, i) => `Company ${i}`).join("\n");
    const id = await newJob(`name\n${names}\n`, "preview");
    await processPrepare({ jobId: id.toHexString() });

    expect(await allRows(id)).toHaveLength(5);
    expect((await job(id)).total).toBe(5);
  });

  it("prepare: fails the job on a bad CSV or a missing key column", async () => {
    const bad = await newJob("name,name\na,b\n");
    await processPrepare({ jobId: bad.toHexString() });
    expect(await job(bad)).toMatchObject({ status: "failed", error: expect.stringContaining("Duplicate") });

    const noKey = await newJob("company\nNotion\n");
    await processPrepare({ jobId: noKey.toHexString() });
    expect(await job(noKey)).toMatchObject({ status: "failed", error: expect.stringContaining('"name"') });
    expect(await allRows(noKey)).toHaveLength(0);
  });

  it("prepare: reuses the preview's done rows and researches the rest", async () => {
    const preview = await newJob("name\nNotion\nCanva\n", "preview");
    await processPrepare({ jobId: preview.toHexString() });
    mocks.enrichRow.mockResolvedValueOnce(result(0.011, 2013)).mockRejectedValueOnce(new Error("boom"));
    const [notion, canva] = enqueued();
    await processEnrich(notion);
    await onFinalFailure(canva, new Error("boom"));
    mocks.addBulk.mockReset();

    const id = await createJob({
      csv: "name\nNotion\nCanva\nFigma\n",
      headers: ["name"],
      config,
      mode: "full",
      email: "test@example.com",
      previewJobId: preview,
    });
    await processPrepare({ jobId: id.toHexString() });

    const rows = await allRows(id);
    expect(rows.map((r) => [r.key, r.status])).toEqual([
      ["Notion", "done"],
      ["Canva", "pending"],
      ["Figma", "pending"],
    ]);
    expect(rows[0]).toMatchObject({ output: { founded: 2013 }, costUsd: 0.011 });
    expect(await job(id)).toMatchObject({ status: "running", total: 3, done: 1, costUsd: 0.011 });
    expect(enqueued().map((j) => j.rowId)).toEqual([rows[1]!._id.toHexString(), rows[2]!._id.toHexString()]);

    // The reused row is already counted: counting it again changes nothing.
    await countRow(id, rows[0]!._id);
    expect(await job(id)).toMatchObject({ done: 1, costUsd: 0.011 });
  });

  it("prepare: completes immediately when nothing needs enriching", async () => {
    const id = await newJob("name,city\n,Pune\n");
    await processPrepare({ jobId: id.toHexString() });
    expect(await job(id)).toMatchObject({ status: "completed", total: 1, failed: 1 });
    expect(mocks.addBulk).not.toHaveBeenCalled();
  });

  it("runs a job end to end: counters, cost total, duplicates filled, completed once", async () => {
    const id = await newJob("name\nNotion\nCanva\nnotion\n");
    await processPrepare({ jobId: id.toHexString() });
    mocks.enrichRow.mockResolvedValueOnce(result(0.011, 2013)).mockResolvedValueOnce(result(0.022, 2012));

    for (const payload of enqueued()) await processEnrich(payload);

    const doc = await job(id);
    expect(doc).toMatchObject({ status: "completed", total: 2, done: 2, failed: 0, duplicates: 1 });
    expect(doc.finishedAt).toBeInstanceOf(Date);

    const rows = await allRows(id);
    const rowCost = rows.reduce((sum, r) => sum + r.costUsd, 0);
    expect(doc.costUsd).toBeCloseTo(rowCost, 12);
    expect(doc.costUsd).toBeCloseTo(0.033, 12);

    const duplicate = rows[2]!;
    expect(duplicate).toMatchObject({ status: "duplicate", output: { founded: 2013 }, costUsd: 0 });
    expect(duplicate.sources).toHaveLength(1);
  });

  it("never double-counts when an enrich job runs again", async () => {
    const id = await newJob("name\nNotion\nCanva\n");
    await processPrepare({ jobId: id.toHexString() });
    mocks.enrichRow.mockResolvedValue(result(0.01, 2013));
    const [first] = enqueued();

    await processEnrich(first);
    await processEnrich(first);
    await countRow(id, (await getRow((await allRows(id))[0]!._id))!._id);

    expect(mocks.enrichRow).toHaveBeenCalledTimes(1);
    expect(await job(id)).toMatchObject({ done: 1, status: "running" });
    expect((await job(id)).costUsd).toBeCloseTo(0.01, 12);
  });

  it("recovers from a crash between saving a row and counting it", async () => {
    const id = await newJob("name\nNotion\n");
    await processPrepare({ jobId: id.toHexString() });
    const [payload] = enqueued();
    const rowId = (await allRows(id))[0]!._id;

    // Attempt 1 saved the result, then the worker died before counting.
    await saveResult(rowId, result(0.02, 2013));
    expect((await job(id)).done).toBe(0);

    // BullMQ re-runs the job: no new LLM call, counted exactly once.
    await processEnrich(payload);
    expect(mocks.enrichRow).not.toHaveBeenCalled();
    expect(await job(id)).toMatchObject({ status: "completed", done: 1 });
    expect((await job(id)).costUsd).toBeCloseTo(0.02, 12);
  });

  it("counts a row once when two attempts race on it", async () => {
    const id = await newJob("name\nNotion\nCanva\n");
    await processPrepare({ jobId: id.toHexString() });
    mocks.enrichRow.mockResolvedValue(result(0.01, 2013));
    const [first] = enqueued();

    await Promise.all([processEnrich(first), processEnrich(first), processEnrich(first)]);

    const doc = await job(id);
    expect(doc.done).toBe(1);
    expect(doc.costUsd).toBeCloseTo(0.01, 12);
  });

  it("transient errors leave the row pending; the final failure marks and counts it", async () => {
    const id = await newJob("name\nNotion\n");
    await processPrepare({ jobId: id.toHexString() });
    const [payload] = enqueued();
    const err = Object.assign(new Error("rate limited"), { status: 429 });
    mocks.enrichRow.mockRejectedValue(err);

    await expect(processEnrich(payload)).rejects.toThrow("rate limited");
    expect((await allRows(id))[0]?.status).toBe("pending");
    expect((await job(id)).failed).toBe(0);

    await onFinalFailure(payload, err);
    await onFinalFailure(payload, err);

    expect((await allRows(id))[0]).toMatchObject({ status: "failed", error: "rate limited" });
    expect(await job(id)).toMatchObject({ status: "completed", failed: 1, done: 0 });
  });

  it("retries failed rows in a new round: fresh ids, counters fixed, empty keys skipped", async () => {
    const id = await newJob("name,city\nNotion,SF\nCanva,Sydney\n,Pune\n");
    await processPrepare({ jobId: id.toHexString() });
    const [notion, canva] = enqueued();
    mocks.enrichRow.mockResolvedValueOnce(result(0.01, 2013));
    await processEnrich(notion);
    // Canva failed after spending money on an earlier step.
    mocks.enrichRow.mockResolvedValueOnce({ ...result(0.005, 0), status: "failed", output: null, error: "x" });
    await processEnrich(canva);
    expect(await job(id)).toMatchObject({ status: "completed", done: 1, failed: 2 });

    const ids = await retryableRowIds(id);
    expect(ids.map((r) => r.toHexString())).toEqual([canva!.rowId]);
    expect(await reopenJob(id, ids)).toBe(1);
    expect(await reopenJob(id, ids)).toBeNull();
    await resetRows(ids);
    expect(await job(id)).toMatchObject({ status: "running", failed: 1, retries: 1 });

    mocks.addBulk.mockReset();
    await processPrepare({ jobId: id.toHexString() });
    const [again] = enqueued();
    expect(enqueued()).toHaveLength(1);
    expect(again!.id).toBe(`${id.toHexString()}-${canva!.rowId}-r1`);

    mocks.enrichRow.mockResolvedValueOnce(result(0.02, 2012));
    await processEnrich(again);
    const doc = await job(id);
    expect(doc).toMatchObject({ status: "completed", done: 2, failed: 1 });
    expect(doc.finishedAt).toBeInstanceOf(Date);
    // The failed attempt's spend stays in the job total; the retry adds its own.
    expect(doc.costUsd).toBeCloseTo(0.035, 12);
  });

  it("a late final-failure call does not touch a row that already succeeded", async () => {
    const id = await newJob("name\nNotion\n");
    await processPrepare({ jobId: id.toHexString() });
    const [payload] = enqueued();
    mocks.enrichRow.mockResolvedValue(result(0.01, 2013));

    await processEnrich(payload);
    await onFinalFailure(payload, new Error("late"));

    expect((await allRows(id))[0]?.status).toBe("done");
    expect(await job(id)).toMatchObject({ done: 1, failed: 0 });
  });
});
