import type { NextRequest } from "next/server";
import { toObjectId } from "@engine/db/client";
import { failJob, getJobSummary, reopenJob } from "@engine/db/jobs";
import { resetRows, retryableRowIds } from "@engine/db/rows";
import { JobIdParamsSchema, type RetryJobResponse } from "@/lib/api";
import { fail, handle, ok, parseInput } from "@/lib/http";
import { enqueuePrepare } from "@/lib/queue";
import { LIMITS, rateLimit } from "@/lib/rate-limit";

/**
 * POST /api/jobs/[id]/retry: sends a completed job's failed rows through
 * the pipeline again (e.g. after the model was briefly overloaded).
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/jobs/[id]/retry">) {
  return handle(async () => {
    // Validate → rate-limit → work (app-spec section 6).
    const params = parseInput(await ctx.params, JobIdParamsSchema);
    if (params.response) return params.response;

    const limited = await rateLimit(req, "jobs:retry", LIMITS.retryJob);
    if (limited) return limited;

    const id = toObjectId(params.data.id);
    const job = id ? await getJobSummary(id) : null;
    if (!id || !job) return fail("not_found", "Job not found.", 404);
    if (job.status !== "completed") {
      return fail("not_finished", "Failed rows can be retried once the job has finished.", 409);
    }

    const rowIds = await retryableRowIds(id);
    if (rowIds.length === 0) return fail("nothing_to_retry", "There are no failed rows to retry.", 409);

    // The conditional reopen lets only one of two concurrent retries through.
    const retry = await reopenJob(id, rowIds);
    if (retry === null) return fail("not_finished", "This job is already being retried.", 409);

    try {
      await resetRows(rowIds);
      await enqueuePrepare(params.data.id, retry);
    } catch (err) {
      await failJob(id, "Could not queue the retry.");
      throw err;
    }

    return ok<RetryJobResponse>({ retried: rowIds.length });
  });
}
