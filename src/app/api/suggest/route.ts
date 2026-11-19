import type { NextRequest } from "next/server";
import type { JobConfig } from "@engine/contracts/job-config";
import { SuggestError, suggestSetup } from "@engine/core/suggest";
import { SuggestBodySchema } from "@/lib/api";
import { fail, handle, ok, parseBody } from "@/lib/http";
import { LIMITS, rateLimit } from "@/lib/rate-limit";

/**
 * POST /api/suggest: proposes a JobConfig from headers, up to 5 sample rows
 * and a summary of every column. The only LLM calls the app makes (the setup
 * and its source plan, no web search; the plan's sites are then checked).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    // Validate → rate-limit → work (app-spec section 6).
    const body = await parseBody(req, SuggestBodySchema);
    if (body.response) return body.response;

    const limited = await rateLimit(req, "suggest", LIMITS.suggest);
    if (limited) return limited;

    try {
      const config = await suggestSetup(body.data.headers, body.data.sampleRows, body.data.columns);
      return ok<JobConfig>(config);
    } catch (err) {
      if (err instanceof SuggestError) {
        return fail("suggest_failed", "Couldn't suggest a setup for this file. Please fill it in manually.", 422);
      }
      console.error("[api/suggest] model call failed", err);
      return fail("upstream_error", "The suggestion service is unavailable. Please try again.", 502);
    }
  });
}
