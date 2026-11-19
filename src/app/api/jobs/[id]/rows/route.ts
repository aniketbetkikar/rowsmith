import type { NextRequest } from "next/server";
import { toObjectId } from "@engine/db/client";
import { getJobSummary } from "@engine/db/jobs";
import { listRows } from "@engine/db/rows";
import { JobIdParamsSchema, RowsQuerySchema, type RowsResponse } from "@/lib/api";
import { fail, handle, ok, parseInput } from "@/lib/http";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { rowView } from "@/lib/views";

/** GET /api/jobs/[id]/rows?page=1&size=50: paged results in original order. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/jobs/[id]/rows">) {
  return handle(async () => {
    // Validate → rate-limit → work (app-spec section 6).
    const params = parseInput(await ctx.params, JobIdParamsSchema);
    if (params.response) return params.response;
    const query = parseInput(Object.fromEntries(req.nextUrl.searchParams), RowsQuerySchema);
    if (query.response) return query.response;

    const limited = await rateLimit(req, "jobs:read", LIMITS.read);
    if (limited) return limited;

    const id = toObjectId(params.data.id);
    const job = id ? await getJobSummary(id) : null;
    if (!id || !job) return fail("not_found", "Job not found.", 404);

    const { page, size } = query.data;
    const { rows, total } = await listRows(id, { page, size });
    return ok<RowsResponse>({ page, size, total, rows: rows.map(rowView) });
  });
}
