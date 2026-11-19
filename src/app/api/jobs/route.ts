import type { NextRequest } from "next/server";
import { ROW_CAPS } from "@engine/contracts/job-status";
import type { JobConfig } from "@engine/contracts/job-config";
import { toObjectId } from "@engine/db/client";
import { createJob, failJob, getJob } from "@engine/db/jobs";
import { CreateJobBodySchema, MAX_CSV_BYTES, MAX_CSV_ROWS, type CreateJobResponse } from "@/lib/api";
import { CsvError, parseCsv, toCsv } from "@/lib/csv";
import { fail, handle, ok, parseBody } from "@/lib/http";
import { enqueuePrepare } from "@/lib/queue";
import { LIMITS, rateLimit } from "@/lib/rate-limit";

/** POST /api/jobs: validate the upload + config, store a queued job, enqueue prepare. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    // Validate → rate-limit → work (app-spec section 6).
    const body = await parseBody(req, CreateJobBodySchema);
    if (body.response) return body.response;

    const limited = await rateLimit(req, "jobs:create", LIMITS.createJob);
    if (limited) return limited;

    const { csv, config, mode, email, previewJobId } = body.data;

    if (new TextEncoder().encode(csv).length > MAX_CSV_BYTES) {
      return fail("csv_too_large", "The CSV is larger than 1 MB.", 413);
    }

    let parsed;
    try {
      parsed = parseCsv(csv);
    } catch (err) {
      if (err instanceof CsvError) return fail("invalid_csv", err.message, 400);
      throw err;
    }
    const { headers, rows } = parsed;
    if (rows.length === 0) return fail("invalid_csv", "The CSV has no data rows.", 400);
    if (rows.length > MAX_CSV_ROWS) {
      return fail("invalid_csv", `The CSV has ${rows.length} rows; the limit is ${MAX_CSV_ROWS}.`, 400);
    }

    const problem = checkConfigAgainstHeaders(config, headers);
    if (problem) return fail("invalid_config", problem, 400);

    // Row caps: preview runs the first 5 rows, the free full run the first 25.
    const capped = rows.slice(0, ROW_CAPS[mode]);
    const preview =
      mode === "full" && previewJobId
        ? await reusablePreview(previewJobId, toCsv(headers, rows.slice(0, ROW_CAPS.preview)), config)
        : undefined;
    const jobId = await createJob({
      csv: toCsv(headers, capped),
      headers,
      config,
      mode,
      email,
      previewJobId: preview,
    });

    try {
      await enqueuePrepare(jobId.toHexString());
    } catch (err) {
      await failJob(jobId, "Could not queue the job.");
      throw err;
    }

    return ok<CreateJobResponse>({ jobId: jobId.toHexString() }, 201);
  });
}

/**
 * The preview's rows can stand in for the full run's first rows only if it is a
 * completed preview of the same CSV start with the same config. Anything else
 * is ignored (the full run then researches every row).
 */
async function reusablePreview(id: string, previewCsv: string, config: JobConfig) {
  const previewId = toObjectId(id);
  const job = previewId ? await getJob(previewId) : null;
  if (!job || job.mode !== "preview" || job.status !== "completed") return undefined;
  if (job.csv !== previewCsv || JSON.stringify(job.config) !== JSON.stringify(config)) return undefined;
  return job._id;
}

function checkConfigAgainstHeaders(
  config: { keyColumn: string; contextColumns: string[]; fields: { name: string }[] },
  headers: string[],
): string | null {
  const known = new Set(headers);
  if (!known.has(config.keyColumn)) {
    return `Key column "${config.keyColumn}" is not a column in the CSV.`;
  }
  const missing = config.contextColumns.filter((c) => !known.has(c));
  if (missing.length > 0) {
    return `Context column${missing.length > 1 ? "s" : ""} not in the CSV: ${missing.join(", ")}.`;
  }
  return null;
}
