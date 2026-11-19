import type { z } from "zod";
import type { JobConfig } from "@engine/contracts/job-config";
import type { Evidence, Rejected, Source, Usage } from "@engine/contracts/row-result";
import { MAX_RETRIES } from "@engine/config/limits";
import type { ModelRole } from "@engine/llm/models";
import { ConfigError, errorMessage, isTransient } from "@engine/utils/errors";
import { buildEvidenceSchema, buildRowSchema, type RowOutput } from "./build-schema";
import { extractPrompt, type RowInput } from "./build-prompt";
import { searchCost, tokenCost, type TokenUsage } from "./cost";
import { addAnchors } from "./anchors";
import { findArticle } from "./entity-article";
import { allBlank, checkEvidence, type Checked } from "./evidence";
import { extractStructured } from "./extract";
import { readPages } from "./read-pages";
import { research } from "./research";
import { tierHints } from "./scope";
import { groundedSearch } from "./search";
import { applyVerdicts, claimedValues, verdictsSchemaFor, verifyPrompt } from "./verify";

export type EnrichResult = {
  status: "done" | "failed";
  output: RowOutput | null;
  sources: Source[];
  /** Quote and sources behind each filled cell, or why it is blank. */
  evidence: Evidence;
  /** Values our checks dropped, with their quotes (debugging only, never shown). */
  rejected: Rejected;
  usage: Usage;
  /** Extraction attempts (0 when search found no sources). */
  attempts: number;
  costUsd: number;
  error?: string;
};

/**
 * search → anchors → read pages → extract (value + quote per field) → quote check → verify.
 *
 * - Research runs one or more searches (see planSearches) and keeps only
 *   claims grounded in a source; a search with nothing grounded runs once more.
 * - Anchors (URL fields only) add page claims we read ourselves: the
 *   confirmed official site, the profiles it links to, Wikidata's links.
 * - Read pages: the best few sources are fetched and their own text added
 *   as page claims, which extraction quotes ahead of the search summary.
 * - Extraction retries with validation issues fed back; the last retry uses
 *   the stronger "rescue" model.
 * - Every quote must be copied from a grounded claim; values without one are
 *   dropped (blank: "unsupported").
 * - One verify call judges whether each quote supports its value; anything
 *   not supported is dropped (blank: "rejected").
 *
 * Every call's usage and cost is counted, retries included. Transient API
 * errors (and config errors) are re-thrown so BullMQ can retry the row. Any
 * other error marks the row failed with a reason.
 */
export async function enrichRow(
  config: JobConfig,
  row: RowInput,
): Promise<EnrichResult> {
  const usage: Usage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    searchCalls: 0,
  };
  let costUsd = 0;
  let attempts = 0;
  let sources: Source[] = [];

  const record = (model: string, tokens: TokenUsage) => {
    usage.inputTokens += tokens.inputTokens;
    usage.outputTokens += tokens.outputTokens;
    usage.cachedTokens += tokens.cachedTokens;
    costUsd += tokenCost(model, tokens);
  };
  const done = (checked: Checked): EnrichResult => ({
    status: "done",
    output: checked.output,
    evidence: checked.evidence,
    rejected: checked.rejected ?? {},
    sources,
    usage,
    attempts,
    costUsd,
  });
  const failed = (error: string): EnrichResult => ({
    status: "failed",
    output: null,
    evidence: {},
    rejected: {},
    sources,
    usage,
    attempts,
    costUsd,
    error,
  });

  /**
   * One structured call with validation retries; parsed is null after the
   * last failed attempt. `lastRole` (if given) makes the final attempt.
   */
  async function structured<S extends z.ZodType>(
    role: ModelRole,
    schema: S,
    prompt: (issues?: string[]) => string,
    { lastRole = role, onAttempt }: { lastRole?: ModelRole; onAttempt?: () => void } = {},
  ): Promise<{ parsed: z.infer<S> | null; issues: string[] }> {
    let issues: string[] = [];
    for (let attempt = 1; attempt <= 1 + MAX_RETRIES; attempt++) {
      onAttempt?.();
      const r = await extractStructured(
        attempt > MAX_RETRIES ? lastRole : role,
        schema,
        prompt(issues.length > 0 ? issues : undefined),
      );
      record(r.model, r.usage);
      if (r.parsed !== null) return { parsed: r.parsed, issues: [] };
      issues = r.issues;
    }
    return { parsed: null, issues };
  }

  const runSearch = async (prompt: string) => {
    const r = await groundedSearch(prompt, row, tierHints(config, row));
    record(r.model, r.usage);
    usage.searchCalls += r.searchCalls;
    costUsd += searchCost(r.searchCalls);
    return r;
  };

  try {
    // Official site, its profile links and Wikidata links, then the best
    // sources' own text: all read directly, no LLM.
    const searched = await research(config, row, runSearch);
    // The row's Wikipedia article, checked against what the row already says.
    const article = await findArticle(searched, config, row);
    const anchored = await addAnchors(searched, config, row, { article });
    const grounding = await readPages(anchored, config, row, { article });
    sources = grounding.sources.map(({ url, title }) => ({ url, title }));

    // Nothing found on the web: every field is unknown, never invented.
    if (sources.length === 0) return done(allBlank(config.fields, "not_found"));

    // The cheap model extracts; a stronger one gets the last retry only.
    const extracted = await structured(
      "extract",
      buildEvidenceSchema(config.fields),
      (issues) => extractPrompt(config, row, grounding.notes, issues),
      { lastRole: "rescue", onAttempt: () => attempts++ },
    );
    if (!extracted.parsed) {
      return failed(`Validation failed after ${attempts} attempts: ${extracted.issues.join("; ")}`);
    }

    let checked = checkEvidence(config.fields, extracted.parsed, grounding.claims, sources);
    const claimed = claimedValues(config, checked);
    if (claimed.length > 0) {
      const prompt = verifyPrompt(config, row, claimed);
      const verdicts = await structured("verify", verdictsSchemaFor(claimed), (issues) =>
        issues ? `${prompt}\n\nYour previous answer failed validation: ${issues.join("; ")}.` : prompt,
      );
      if (!verdicts.parsed) {
        return failed(`Verification failed: ${verdicts.issues.join("; ")}`);
      }
      checked = applyVerdicts(config, checked, verdicts.parsed);
    }

    // Final values must still match the user's schema (they always should).
    const final = buildRowSchema(config.fields).safeParse(checked.output);
    if (!final.success) return failed("Checked output did not match the field schema.");
    return done({ output: final.data, evidence: checked.evidence, rejected: checked.rejected });
  } catch (err) {
    if (isTransient(err) || err instanceof ConfigError) throw err;
    return failed(errorMessage(err));
  }
}
