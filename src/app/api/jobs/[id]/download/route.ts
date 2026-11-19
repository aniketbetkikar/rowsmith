import type { NextRequest } from "next/server";
import { toObjectId } from "@engine/db/client";
import { getJobSummary } from "@engine/db/jobs";
import { allRows } from "@engine/db/rows";
import { JobIdParamsSchema } from "@/lib/api";
import { fail, handle, parseInput } from "@/lib/http";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { resultCsv } from "@/lib/views";

/** GET /api/jobs/[id]/download: the completed result as a CSV attachment. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/jobs/[id]/download">) {
  return handle(async () => {
    // Validate → rate-limit → work (app-spec section 6).
    const params = parseInput(await ctx.params, JobIdParamsSchema);
    if (params.response) return params.response;

    const limited = await rateLimit(req, "jobs:read", LIMITS.read);
    if (limited) return limited;

    const id = toObjectId(params.data.id);
    const job = id ? await getJobSummary(id) : null;
    if (!id || !job) return fail("not_found", "Job not found.", 404);
    if (job.status !== "completed") {
      return fail("not_ready", `The job is ${job.status}; download is available once it completes.`, 409);
    }

    const csv = resultCsv(job, await allRows(id));
    const body = new Blob([csv]).stream();
    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="rowsmith-${params.data.id}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
