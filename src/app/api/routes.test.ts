import { ObjectId } from "mongodb";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobConfig } from "@engine/contracts/job-config";
import type { JobSummary } from "@engine/db/jobs";
import type { RowDoc } from "@engine/db/rows";

const m = vi.hoisted(() => ({
  createJob: vi.fn(),
  failJob: vi.fn(),
  getJob: vi.fn(),
  getJobSummary: vi.fn(),
  reopenJob: vi.fn(),
  retryableRowIds: vi.fn(),
  resetRows: vi.fn(),
  listRows: vi.fn(),
  allRows: vi.fn(),
  rowCells: vi.fn(),
  enqueuePrepare: vi.fn(),
  rateLimit: vi.fn(),
  suggestSetup: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: { MONGODB_URI: "x", REDIS_URL: "x", GEMINI_API_KEY: "x", APP_URL: "http://localhost:3000" },
}));
vi.mock("@engine/db/jobs", () => ({
  createJob: m.createJob,
  failJob: m.failJob,
  getJob: m.getJob,
  getJobSummary: m.getJobSummary,
  reopenJob: m.reopenJob,
}));
vi.mock("@engine/db/rows", () => ({
  listRows: m.listRows,
  allRows: m.allRows,
  rowCells: m.rowCells,
  retryableRowIds: m.retryableRowIds,
  resetRows: m.resetRows,
}));
vi.mock("@/lib/queue", () => ({ enqueuePrepare: m.enqueuePrepare }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: m.rateLimit,
  LIMITS: { suggest: 10, createJob: 5, retryJob: 5, read: 120 },
}));
vi.mock("@engine/core/suggest", () => {
  class SuggestError extends Error {}
  return { suggestSetup: m.suggestSetup, SuggestError };
});

const { POST: createJob } = await import("./jobs/route");
const { GET: getStatus } = await import("./jobs/[id]/route");
const { GET: getRows } = await import("./jobs/[id]/rows/route");
const { POST: retryJob } = await import("./jobs/[id]/retry/route");
const { GET: download } = await import("./jobs/[id]/download/route");
const { POST: suggest } = await import("./suggest/route");
const { SuggestError } = await import("@engine/core/suggest");
const { fail } = await import("@/lib/http");

const config: JobConfig = {
  keyColumn: "name",
  entityDescription: "Software companies",
  contextColumns: ["city"],
  fields: [
    { name: "founded", type: "year", description: "Year founded" },
    { name: "products", type: "list", description: "Products" },
  ],
};

const jobId = new ObjectId();
const ID = jobId.toHexString();

function post(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
  });
}

function get(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`);
}

function ctx(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

async function errorOf(res: Response) {
  const body = (await res.json()) as { error: { code: string; message: string } };
  return body.error;
}

function summary(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    _id: jobId,
    status: "running",
    mode: "full",
    config,
    headers: ["name", "city"],
    total: 3,
    done: 1,
    failed: 0,
    duplicates: 1,
    costUsd: 0.0123,
    retries: 0,
    createdAt: new Date("2026-10-26T10:00:00Z"),
    ...overrides,
  };
}

function row(overrides: Partial<RowDoc>): RowDoc {
  return {
    _id: new ObjectId(),
    jobId,
    index: 0,
    key: "Notion",
    keyNorm: "notion",
    input: { name: "Notion", city: "SF" },
    output: { founded: 2013, products: ["Docs", "Mail"] },
    sources: [{ url: "https://notion.com/", title: "Notion" }],
    evidence: {
      founded: { quotes: [{ text: "Notion was founded in 2013.", sources: [1] }] },
      products: { quotes: [{ text: "Notion Docs", sources: [1] }, { text: "Notion Mail", sources: [1] }] },
      // A field the user filled has no research behind it; never exposed.
      city: { quotes: [], blank: "not_found" },
    },
    status: "done",
    attempts: 1,
    usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0, searchCalls: 1 },
    costUsd: 0.01,
    ...overrides,
  };
}

const csv = (rows: number) =>
  ["name,city", ...Array.from({ length: rows }, (_, i) => `Company ${i},City ${i}`)].join("\n");

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.rateLimit.mockResolvedValue(null);
  m.createJob.mockResolvedValue(jobId);
});

describe("POST /api/jobs", () => {
  it("creates a preview job capped at 5 rows and enqueues prepare", async () => {
    const res = await createJob(post("/api/jobs", { csv: csv(8), config, mode: "preview" }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ jobId: ID });
    const input = m.createJob.mock.calls[0]?.[0] as { csv: string; headers: string[]; mode: string };
    expect(input.headers).toEqual(["name", "city"]);
    expect(input.csv.split("\r\n")).toHaveLength(6);
    expect(m.enqueuePrepare).toHaveBeenCalledWith(ID);
  });

  it("caps a full job at 25 rows", async () => {
    await createJob(post("/api/jobs", { csv: csv(40), config, mode: "full", email: "a@b.co" }));
    const input = m.createJob.mock.calls[0]?.[0] as { csv: string; email: string };
    expect(input.csv.split("\r\n")).toHaveLength(26);
    expect(input.email).toBe("a@b.co");
  });

  it("runs a full job without an email", async () => {
    const res = await createJob(post("/api/jobs", { csv: csv(3), config, mode: "full" }));
    expect(res.status).toBe(201);
    expect((m.createJob.mock.calls[0]?.[0] as { email?: string }).email).toBeUndefined();
  });

  it("reuses a completed preview of the same CSV start and config", async () => {
    const previewId = new ObjectId();
    const { toCsv } = await import("@/lib/csv");
    const { JobConfigSchema } = await import("@engine/contracts/job-config");
    const stored = JobConfigSchema.parse(config);
    const previewCsv = toCsv(["name", "city"], Array.from({ length: 5 }, (_, i) => ({ name: `Company ${i}`, city: `City ${i}` })));
    m.getJob.mockResolvedValue({ _id: previewId, mode: "preview", status: "completed", csv: previewCsv, config: stored });
    const body = { csv: csv(8), config, mode: "full", email: "a@b.co", previewJobId: previewId.toHexString() };

    await createJob(post("/api/jobs", body));
    expect((m.createJob.mock.calls[0]?.[0] as { previewJobId?: ObjectId }).previewJobId).toEqual(previewId);

    // Changed config, or a preview that is not finished: ignored, every row is researched.
    await createJob(post("/api/jobs", { ...body, config: { ...config, entityDescription: "Other things" } }));
    m.getJob.mockResolvedValue({ _id: previewId, mode: "preview", status: "running", csv: previewCsv, config: stored });
    await createJob(post("/api/jobs", body));
    for (const call of m.createJob.mock.calls.slice(1)) {
      expect((call[0] as { previewJobId?: ObjectId }).previewJobId).toBeUndefined();
    }
  });

  it.each([
    ["invalid email", { csv: csv(2), config, mode: "full", email: "nope" }, "email"],
    ["enum without options", { csv: csv(2), config: { ...config, fields: [{ name: "x", type: "enum", description: "Xyz" }] }, mode: "preview" }, "options"],
    ["bad mode", { csv: csv(2), config, mode: "huge" }, "mode"],
    ["field reusing the key column", { csv: csv(2), config: { ...config, fields: [{ name: "name", type: "text", description: "Name" }] }, mode: "preview" }, "key column"],
  ])("400 for %s", async (_label, body, mention) => {
    const res = await createJob(post("/api/jobs", body));
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.code).toBe("invalid_request");
    expect(error.message).toContain(mention);
    expect(m.createJob).not.toHaveBeenCalled();
  });

  it("400 for a body that is not JSON", async () => {
    const res = await createJob(post("/api/jobs", "{nope"));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe("invalid_json");
  });

  it.each([
    ["duplicate headers", "name,name\na,b", "Duplicate column header"],
    ["no data rows", "name,city\n", "no data rows"],
    ["too many rows", csv(501), "limit is 500"],
  ])("400 invalid_csv for %s", async (_label, text, mention) => {
    const res = await createJob(post("/api/jobs", { csv: text, config, mode: "preview" }));
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.code).toBe("invalid_csv");
    expect(error.message).toContain(mention);
  });

  it("413 for a CSV over 1 MB", async () => {
    const big = `name,city\n${"x".repeat(1_000_001)},y`;
    const res = await createJob(post("/api/jobs", { csv: big, config, mode: "preview" }));
    expect(res.status).toBe(413);
  });

  it.each([
    ["unknown key column", { ...config, keyColumn: "company" }, '"company"'],
    ["unknown context column", { ...config, contextColumns: ["country"] }, "country"],
  ])("400 invalid_config for %s", async (_label, cfg, mention) => {
    const res = await createJob(post("/api/jobs", { csv: csv(2), config: cfg, mode: "preview" }));
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain(mention);
  });

  it("returns the limiter's 429 untouched", async () => {
    m.rateLimit.mockResolvedValue(fail("rate_limited", "Too many", 429, { retryAfter: 42 }));
    const res = await createJob(post("/api/jobs", { csv: csv(2), config, mode: "preview" }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { code: "rate_limited", message: "Too many", retryAfter: 42 } });
    expect(m.rateLimit).toHaveBeenCalledWith(expect.anything(), "jobs:create", 5);
  });

  it("fails the job and returns 500 if it cannot be queued", async () => {
    m.enqueuePrepare.mockRejectedValue(new Error("redis down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await createJob(post("/api/jobs", { csv: csv(2), config, mode: "preview" }));
    expect(res.status).toBe(500);
    expect((await errorOf(res)).code).toBe("internal_error");
    expect(m.failJob).toHaveBeenCalledWith(jobId, expect.any(String));
  });
});

describe("GET /api/jobs/[id]", () => {
  it("returns status, counters and columns", async () => {
    m.getJobSummary.mockResolvedValue(summary());
    m.rowCells.mockResolvedValue([
      { status: "done", input: { name: "notion", city: "SF" }, output: { founded: 2013, products: [] } },
      { status: "duplicate", input: { name: "notion", city: "SF" }, output: { founded: 2013, products: [] } },
    ]);
    const res = await getStatus(get(`/api/jobs/${ID}`), ctx(ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "running",
      mode: "full",
      total: 3,
      done: 1,
      failed: 0,
      duplicates: 1,
      costUsd: 0.0123,
      headers: ["name", "city"],
      fields: ["founded", "products"],
      error: null,
      filledCells: 1,
      blankCells: 1,
      retryable: 0,
      createdAt: "2026-10-26T10:00:00.000Z",
      finishedAt: null,
    });
  });

  it("400 for a malformed id, 404 for an unknown one", async () => {
    expect((await getStatus(get("/api/jobs/abc"), ctx("abc"))).status).toBe(400);
    m.getJobSummary.mockResolvedValue(null);
    expect((await getStatus(get(`/api/jobs/${ID}`), ctx(ID))).status).toBe(404);
  });
});

describe("POST /api/jobs/[id]/retry", () => {
  it("reopens a completed job, resets its failed rows and queues a retry round", async () => {
    const failedIds = [new ObjectId(), new ObjectId()];
    m.getJobSummary.mockResolvedValue(summary({ status: "completed", failed: 2 }));
    m.retryableRowIds.mockResolvedValue(failedIds);
    m.reopenJob.mockResolvedValue(1);
    const res = await retryJob(post(`/api/jobs/${ID}/retry`, {}), ctx(ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ retried: 2 });
    expect(m.reopenJob).toHaveBeenCalledWith(jobId, failedIds);
    expect(m.resetRows).toHaveBeenCalledWith(failedIds);
    expect(m.enqueuePrepare).toHaveBeenCalledWith(ID, 1);
  });

  it("409 while the job is running, with nothing to retry, or when another retry won", async () => {
    m.getJobSummary.mockResolvedValue(summary({ status: "running" }));
    expect((await errorOf(await retryJob(post(`/api/jobs/${ID}/retry`, {}), ctx(ID)))).code).toBe("not_finished");

    m.getJobSummary.mockResolvedValue(summary({ status: "completed" }));
    m.retryableRowIds.mockResolvedValue([]);
    expect((await errorOf(await retryJob(post(`/api/jobs/${ID}/retry`, {}), ctx(ID)))).code).toBe("nothing_to_retry");

    m.retryableRowIds.mockResolvedValue([new ObjectId()]);
    m.reopenJob.mockResolvedValue(null);
    const res = await retryJob(post(`/api/jobs/${ID}/retry`, {}), ctx(ID));
    expect(res.status).toBe(409);
    expect(m.resetRows).not.toHaveBeenCalled();
    expect(m.enqueuePrepare).not.toHaveBeenCalled();
  });

  it("404 for an unknown job", async () => {
    m.getJobSummary.mockResolvedValue(null);
    expect((await retryJob(post(`/api/jobs/${ID}/retry`, {}), ctx(ID))).status).toBe(404);
  });
});

describe("GET /api/jobs/[id]/rows", () => {
  it("returns a page of rows", async () => {
    m.getJobSummary.mockResolvedValue(summary());
    m.listRows.mockResolvedValue({ rows: [row({ error: "x" })], total: 3 });

    const res = await getRows(get(`/api/jobs/${ID}/rows?page=2&size=1`), ctx(ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { page: number; size: number; total: number; rows: unknown[] };
    expect(body).toMatchObject({ page: 2, size: 1, total: 3 });
    expect(body.rows[0]).toEqual({
      key: "Notion",
      input: { name: "Notion", city: "SF" },
      output: { founded: 2013, products: ["Docs", "Mail"] },
      sources: [{ url: "https://notion.com/", title: "Notion" }],
      evidence: {
        founded: { quotes: [{ text: "Notion was founded in 2013.", sources: [1] }] },
        products: { quotes: [{ text: "Notion Docs", sources: [1] }, { text: "Notion Mail", sources: [1] }] },
      },
      status: "done",
      error: "x",
      costUsd: 0.01,
    });
    expect(m.listRows).toHaveBeenCalledWith(jobId, { page: 2, size: 1 });
  });

  it("400 for an invalid page size", async () => {
    const res = await getRows(get(`/api/jobs/${ID}/rows?size=500`), ctx(ID));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/jobs/[id]/download", () => {
  it("409 until the job is completed", async () => {
    m.getJobSummary.mockResolvedValue(summary({ status: "running" }));
    const res = await download(get(`/api/jobs/${ID}/download`), ctx(ID));
    expect(res.status).toBe(409);
  });

  it("streams the result CSV as an attachment", async () => {
    m.getJobSummary.mockResolvedValue(summary({ status: "completed" }));
    m.allRows.mockResolvedValue([
      row({}),
      row({ key: "=cmd", input: { name: "=cmd", city: "X" }, output: null, sources: [], evidence: {}, status: "failed", error: "No data", costUsd: 0.002 }),
      row({ key: "notion", input: { name: "notion", city: "SF" }, status: "duplicate", costUsd: 0 }),
    ]);

    const res = await download(get(`/api/jobs/${ID}/download`), ctx(ID));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="rowsmith-${ID}.csv"`);

    const lines = (await res.text()).split("\r\n");
    expect(lines[0]).toBe("name,city,founded,products,_sources,_evidence,_status,_cost_usd,_comments");
    // _evidence is one quoted cell with a line per field (not a new CSV record).
    expect(lines[1]).toBe(
      'Notion,SF,2013,Docs; Mail,[1] https://notion.com/,' +
        '"founded: ""Notion was founded in 2013."" [1]\nproducts: ""Notion Docs"" [1] | ""Notion Mail"" [1]",done,0.010000,',
    );
    // Formula-like cells are escaped (and quoted) so spreadsheets don't run them.
    expect(lines[2]).toBe(`"'=cmd",X,,,,,failed: No data,0.002000,Couldn't be researched (see _status). Re-running the job may fill it.`);
    expect(lines[3]).toContain(",duplicate,0.000000,");
  });
});

describe("POST /api/suggest", () => {
  const body = { headers: ["name", "city"], sampleRows: [{ name: "Notion", city: "SF" }] };

  it("returns the suggested config", async () => {
    m.suggestSetup.mockResolvedValue(config);
    const res = await suggest(post("/api/suggest", body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(config);
    expect(m.suggestSetup).toHaveBeenCalledWith(body.headers, body.sampleRows, undefined);
    expect(m.rateLimit).toHaveBeenCalledWith(expect.anything(), "suggest", 10);
  });

  it("422 when the suggestion is unusable, 502 when the model call fails", async () => {
    m.suggestSetup.mockRejectedValueOnce(new SuggestError("bad"));
    expect((await suggest(post("/api/suggest", body))).status).toBe(422);

    vi.spyOn(console, "error").mockImplementation(() => {});
    m.suggestSetup.mockRejectedValueOnce(new Error("timeout"));
    expect((await suggest(post("/api/suggest", body))).status).toBe(502);
  });

  it("400 for more than 5 sample rows", async () => {
    const res = await suggest(post("/api/suggest", { ...body, sampleRows: Array(6).fill(body.sampleRows[0]) }));
    expect(res.status).toBe(400);
    expect(m.suggestSetup).not.toHaveBeenCalled();
  });
});
