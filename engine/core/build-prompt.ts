import type { FieldDef, JobConfig } from "@engine/contracts/job-config";
import { MAX_QUERIES_PER_SEARCH, MAX_QUOTES_PER_VALUE } from "@engine/config/limits";
import { rowSites, scopeOf } from "./scope";

/** One CSV row as the core sees it: the key plus the original columns. */
export type RowInput = {
  key: string;
  input: Record<string, string>;
};

function describeFormat(field: FieldDef): string {
  switch (field.type) {
    case "text":
      return "text";
    case "number": {
      if (field.min !== undefined && field.max !== undefined) {
        return `number between ${field.min} and ${field.max}`;
      }
      if (field.min !== undefined) return `number >= ${field.min}`;
      if (field.max !== undefined) return `number <= ${field.max}`;
      return "number";
    }
    case "year":
      return `4-digit year between ${field.min ?? 1800} and ${field.max ?? new Date().getFullYear()}`;
    case "url":
      return "full http(s) URL";
    case "enum":
      return `one of: ${(field.options ?? []).join(", ")}`;
    case "list":
      return `list of up to ${field.maxItems ?? 5} short items`;
    case "boolean":
      return "true or false";
  }
}

/**
 * One line per field. `withSources` adds where to look each one up: only the
 * search uses it, so extract and verify never reject a value for coming from
 * a different (still trustworthy) site.
 */
export function fieldList(fields: FieldDef[], { withSources = false } = {}): string {
  return fields
    .map((f) => {
      const line = `- ${f.name} (${describeFormat(f)}): ${f.description}`;
      if (!withSources) return line;
      const roles = f.roles && f.roles.length > 0 ? ` Kinds of source, best first: ${f.roles.join(" → ")}.` : "";
      return `${line}${f.source ? ` Look it up on: ${f.source}.` : ""}${roles}`;
    })
    .join("\n");
}

/** Shared by search, extract and verify, so all three pick the same version. */
export const VERSION_RULE =
  "If a value differs by version (region, currency, edition, model, plan, location, etc.) and the field doesn't say which, use the version most people in this row's market would mean, judging from the row and its context, and name that version.";

function contextLine(config: JobConfig, row: RowInput): string | null {
  const parts = config.contextColumns
    .filter((col) => col !== config.keyColumn)
    .map((col) => [col, row.input[col]?.trim()] as const)
    .filter(([, value]) => value)
    .map(([col, value]) => `${col}: ${value}`);
  return parts.length > 0 ? parts.join("; ") : null;
}

/** Today's date as YYYY-MM-DD, so the model can judge what is current. */
export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Appended when a search came back with nothing grounded in a source. */
export const SEARCH_RETRY =
  "Search the web before answering. Every fact must come from a page you found in this search, even if you think you already know it.";

const ROLE_WORDS = {
  registry: "registries (who regulates, certifies or officially records it)",
  reference: "reference works",
  listing: "listing platforms",
} as const;

/**
 * The source plan for this row, as search rules: what each kind of source
 * means, and the plan's sites for the row's scope (null when it has none).
 */
function sourcePlanLines(config: JobConfig, row: RowInput): string[] {
  const sites = rowSites(config, row);
  const usesRoles = config.fields.some((f) => f.roles && f.roles.length > 0);
  const lines: string[] = [];
  if (usesRoles) {
    lines.push(
      "- Kinds of source: own = the entity's (or its maker's) own pages; registry = whoever regulates, certifies or officially records it; reference = reference works; listing = platforms where it is listed and kept current. For each field, try its kinds of source in order.",
    );
  }
  if (sites.length > 0) {
    const scope = scopeOf(config, row.input);
    const byRole = (["registry", "reference", "listing"] as const)
      .map((role) => [role, sites.filter((s) => s.role === role).map((s) => s.host)] as const)
      .filter(([, hosts]) => hosts.length > 0)
      .map(([role, hosts]) => `${ROLE_WORDS[role]}: ${hosts.join(", ")}`);
    lines.push(
      `- Sites to use${scope ? ` for ${scope}` : ""}: ${byRole.join("; ")}. Aim your queries at them (for example with site:), together with the entity's own site and Wikipedia.`,
    );
  }
  return lines;
}

export function searchPrompt(config: JobConfig, row: RowInput, today = isoToday()): string {
  const context = contextLine(config, row);
  return [
    `Today is ${today}.`,
    `Research ${row.key} (${config.entityDescription}).`,
    context ? `Context: ${context}.` : null,
    "",
    "Find facts for:",
    fieldList(config.fields, { withSources: true }),
    "",
    "Rules:",
    `- Make sure every fact is about this exact ${row.key}; use the context to tell it apart from others with the same name. If you can't tell which one is meant, say so.`,
    "- For each field, use the source that people who rely on that kind of fact actually check: usually whoever produces, sells or regulates it (the entity itself, its maker, seller or registry), or the platform where that kind of fact is normally listed and kept current; then widely used reference sites. Where a field says where to look it up, start there.",
    ...sourcePlanLines(config, row),
    "- Avoid anonymous or little-known listings, scraped or SEO pages, and pages for another region or version than the one the field asks for.",
    `- ${VERSION_RULE}`,
    "- For facts that change over time, use the most recent source and say which date or period the fact is for.",
    "- If sources disagree, report each version with its source; don't pick one.",
    "- Report only what sources state. Never fill gaps from memory; say clearly when a fact could not be found.",
    `- State each fact in its own sentence, naming ${row.key} and the field it answers.`,
    `- If ${row.key} has an official website, state its full URL in its own sentence.`,
    `- Run at most ${MAX_QUERIES_PER_SEARCH} web search queries. Plan them before searching: aim the first at the page that covers most fields, and the next at fields usually published somewhere else, at the source you picked for them.`,
    "- Cite sources.",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export function extractPrompt(
  config: JobConfig,
  row: RowInput,
  notes: string,
  previousErrors?: string[],
  today = isoToday(),
): string {
  const lines = [
    `Today is ${today}.`,
    `Using ONLY the research notes below, fill the fields for ${row.key} (${config.entityDescription}).`,
    "Each claim in the notes cites its sources as [S#]. Source tiers, most trusted first: official (the entity's own site), authority (government, academic, standards bodies), reference (Wikipedia, Wikidata and sites widely trusted for these entities), web, community (forums, social, user-generated).",
    "The notes have two kinds of claims. Page text is copied from the pages themselves (including what the official website links to and what Wikidata lists); the search summary is the search model's own wording. When page text states a value, quote the page text. Use the search summary only for values no page text states.",
    "",
    "Rules:",
    "- Use null when the notes don't support a value. Do not guess, infer or use your own knowledge.",
    "- A value must fit the field's description exactly: its scope, unit and time period. Leave out anything that doesn't fit, such as a related but different thing or a value for another period.",
    `- Use null if the claims are about a different entity than ${row.key}, or if it's unclear which entity they describe.`,
    "- If claims conflict, use the one from the more trusted tier; if the tiers are equal, use the most recent; if it's still unclear, use null.",
    "- When a field asks for a current value, use the most recent one in the notes.",
    `- ${VERSION_RULE} Prefer a quote that names the version.`,
    "",
    "Output: for each field, the value and its quotes. For list fields, one item per value, each with its own quotes.",
    "- Each quote must be copied word for word from a single claim in the notes (without the [S#] tags), digits and punctuation included, and be a phrase of at least a few words that states the value, never the bare value alone (not \"iPhone\" but \"key product lines include iPhone, Mac\").",
    `- For a plain fact, give the one quote that states it. For a value you write from several claims (a summary, a description, a list item), give the 1-${MAX_QUOTES_PER_VALUE} quotes that together state everything in it, and add nothing they don't say.`,
    "- A value without such quotes is not allowed: use a null value and no quotes instead.",
    "",
    "Fields:",
    fieldList(config.fields),
    "",
    "Research notes:",
    '"""',
    notes.trim() || "(no research notes were found)",
    '"""',
  ];
  if (previousErrors && previousErrors.length > 0) {
    lines.push(
      "",
      `Your previous answer failed validation: ${previousErrors.join("; ")}. Fix only these.`,
    );
  }
  return lines.join("\n");
}
