import { z } from "zod";
import type { JobConfig } from "@engine/contracts/job-config";
import type { CellEvidence } from "@engine/contracts/row-result";
import { fieldList, isoToday, type RowInput } from "./build-prompt";
import { addRejected, QUOTE_JOIN, type Checked } from "./evidence";

export const VerdictsSchema = z.object({
  checks: z.array(
    z.object({
      id: z.string().describe("The id in brackets, exactly as given"),
      supported: z.boolean(),
    }),
  ),
});

export type Verdicts = z.infer<typeof VerdictsSchema>;

/** "[founders#2]" and " founders#2 " both mean founders#2. */
const normalizeId = (id: string) => id.trim().replace(/^\[|\]$/g, "");

/**
 * Verdicts that must cover every claimed id. A partial (or empty) list is a
 * validation issue, so it is retried with the missing ids named instead of
 * silently blanking those values.
 */
export function verdictsSchemaFor(claimed: Claimed[]) {
  return VerdictsSchema.superRefine((verdicts, ctx) => {
    const got = new Set(verdicts.checks.map((c) => normalizeId(c.id)));
    const missing = claimed.map((c) => c.id).filter((id) => !got.has(id));
    if (missing.length > 0) {
      ctx.addIssue({ code: "custom", path: ["checks"], message: `Missing a check for: ${missing.join(", ")}` });
    }
  });
}

/** One value to judge: a scalar field ("founded") or one list item ("founders#2"). */
export type Claimed = { id: string; field: string; value: unknown; quote: string };

/** Every filled value with its quote, in field order. */
export function claimedValues(config: JobConfig, checked: Checked): Claimed[] {
  return config.fields.flatMap((field) => {
    const value = checked.output[field.name];
    const quotes = checked.evidence[field.name]?.quotes ?? [];
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) {
      return value.map((item, i) => ({
        id: `${field.name}#${i + 1}`,
        field: field.name,
        value: item,
        quote: quotes[i]?.text ?? "",
      }));
    }
    return [{ id: field.name, field: field.name, value, quote: quotes[0]?.text ?? "" }];
  });
}

export function verifyPrompt(
  config: JobConfig,
  row: RowInput,
  claimed: Claimed[],
  today = isoToday(),
): string {
  return [
    `Today is ${today}.`,
    `Check values researched for ${row.key} (${config.entityDescription}). Each value comes with the quotes from web sources that are meant to support it (several quotes are joined with "${QUOTE_JOIN.trim()}"). A quote may be a table row such as "Label: value".`,
    "",
    "Field definitions:",
    fieldList(config.fields),
    "",
    "Mark a value supported only if all of these hold:",
    `- Its quotes state this value, about ${row.key} itself (not a parent, subsidiary, competitor, namesake or other related thing).`,
    "- The value fits the field's definition exactly: its scope, unit, time period and anything it excludes. If the definition doesn't say which version is meant (region, currency, edition, model, plan, location, etc.), a value for the version most people in this row's market would mean fits.",
    "- For a field about the current state, the quote describes the current state, not a former one, a plan or an announced deal that may not have happened.",
    "- Everything the value says is stated in its quotes. Rewording, shortening or combining what they say is fine (as in a summary, a description or a list item); a detail the quotes don't state is not.",
    "- A website or profile link that the quote names as the entity's page for a region (\"for Europe\") counts as the entity's own link when no global one was found.",
    "Otherwise mark it not supported. When unsure, mark it not supported.",
    "Return one check for every id below.",
    "",
    ...claimed.map(
      (c) => `[${c.id}] ${c.field}: ${JSON.stringify(c.value)}\n  quotes: ${JSON.stringify(c.quote)}`,
    ),
  ].join("\n");
}

/**
 * Removes every value not explicitly marked supported (a missing verdict
 * counts as not supported). Removed scalars and lists left empty become
 * null with the reason "rejected".
 */
export function applyVerdicts(config: JobConfig, checked: Checked, verdicts: Verdicts): Checked {
  const supported = new Set(verdicts.checks.filter((c) => c.supported).map((c) => normalizeId(c.id)));
  const output = { ...checked.output };
  const evidence = { ...checked.evidence };
  const rejectedValues = structuredClone(checked.rejected ?? {});

  for (const field of config.fields) {
    const value = output[field.name];
    if (value === null || value === undefined) continue;
    const cell = evidence[field.name] ?? { quotes: [] };

    if (Array.isArray(value)) {
      const keep = value.map((_, i) => supported.has(`${field.name}#${i + 1}`));
      value.forEach((item, i) => {
        if (!keep[i]) addRejected(rejectedValues, field.name, item, [cell.quotes[i]?.text ?? ""], "rejected");
      });
      const items = value.filter((_, i) => keep[i]);
      const quotes = cell.quotes.filter((_, i) => keep[i]);
      output[field.name] = items.length > 0 ? items : null;
      evidence[field.name] = items.length > 0 ? { quotes } : rejected();
    } else if (!supported.has(field.name)) {
      addRejected(rejectedValues, field.name, value, [cell.quotes[0]?.text ?? ""], "rejected");
      output[field.name] = null;
      evidence[field.name] = rejected();
    }
  }
  return { output, evidence, rejected: rejectedValues };
}

function rejected(): CellEvidence {
  return { quotes: [], blank: "rejected" };
}
