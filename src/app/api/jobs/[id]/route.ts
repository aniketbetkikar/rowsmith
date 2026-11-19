import type { NextRequest } from "next/server";
import { toObjectId } from "@engine/db/client";
import { getJobSummary } from "@engine/db/jobs";
import { rowCells } from "@engine/db/rows";
import { JobIdParamsSchema, type JobStatusResponse } from "@/lib/api";
import { fail, handle, ok, parseInput } from "@/lib/http";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { jobStatusView } from "@/lib/views";

/** GET /api/jobs/[id]: job status and counters (polled every 2 s). */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/jobs/[id]">) {
  return handle(async () => {
    // Validate → rate-limit → work (app-spec section 6).
    const params = parseInput(await ctx.params, JobIdParamsSchema);
    if (params.response) return params.response;

    const limited = await rateLimit(req, "jobs:read", LIMITS.read);
    if (limited) return limited;

    const id = toObjectId(params.data.id);
    const job = id ? await getJobSummary(id) : null;
    if (!job) return fail("not_found", "Job not found.", 404);

    return ok<JobStatusResponse>(jobStatusView(job, await rowCells(job._id)));
  });
}
