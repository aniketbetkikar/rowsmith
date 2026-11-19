import { z } from "zod";
import { summarizeColumns, type ColumnSummary } from "@engine/contracts/columns";
import {
  FieldNameSchema,
  FieldTypeSchema,
  JobConfigSchema,
  MAX_FIELDS,
  MAX_SCOPES,
  SourceRoleSchema,
  type JobConfig,
} from "@engine/contracts/job-config";
import type { CsvRow } from "./csv";
import { extractStructured } from "./extract";
import type { FetchLike } from "./page";
import { planSites } from "./source-plan";

// Strict structured output needs every key present, so optional rules are
// nullable here. The result is then validated with the real JobConfigSchema.
const SuggestedFieldSchema = z.object({
  name: z.string().describe("Column name: an existing header exactly as written, or a new snake_case name"),
  type: FieldTypeSchema,
  description: z
    .string()
    .describe(
      "Precise definition of what to find, 3-200 characters: scope, unit, time period and exclusions. Shown to the research model.",
    ),
  source: z
    .string()
    .nullable()
    .describe(
      "The kinds of page that state this fact for these entities, best first, max 150 characters, e.g. a kind of document or a site, then a fallback. Null if the entity's main reference page covers it.",
    ),
  roles: z
    .array(SourceRoleSchema)
    .describe("Kinds of source that publish this fact, best first: own, registry, reference, listing"),
  options: z
    .array(z.string())
    .nullable()
    .describe("Allowed values. Required for enum, null otherwise."),
  min: z.number().nullable().describe("number/year minimum, or null"),
  max: z.number().nullable().describe("number/year maximum, or null"),
  maxItems: z
    .number()
    .int()
    .nullable()
    .describe("list: max items (1-10), or null"),
});

const SuggestionSchema = z.object({
  keyColumn: z.string().describe("Header of the column that identifies each row"),
  entityDescription: z
    .string()
    .describe('One sentence on what the rows are, e.g. "Indian D2C skincare brands"'),
  contextColumns: z
    .array(z.string())
    .describe("Up to 5 other headers that help disambiguate (e.g. city)"),
  scopeColumn: z
    .string()
    .nullable()
    .describe("The header whose values change which sources are right for a row, or null"),
  fields: z.array(SuggestedFieldSchema).describe("Fields to fill, as the instructions say"),
});

type Suggestion = z.infer<typeof SuggestionSchema>;

/** The draft could not be turned into a valid JobConfig. */
export class SuggestError extends Error {
  override readonly name = "SuggestError";
}

/**
 * Headers that are blank in at least half of the sample rows (first
 * MAX_FIELDS), whatever their style ("Product Lines" or "product_lines").
 * These become the fields. Only names a row can't store ("a.b", "$x") are
 * skipped.
 */
function sparseHeaders(headers: string[], sampleRows: CsvRow[]): string[] {
  return headers
    .filter((h) => {
      const blank = sampleRows.filter((row) => !row[h]?.trim()).length;
      return blank * 2 >= sampleRows.length;
    })
    .filter((h) => FieldNameSchema.safeParse(h).success)
    .slice(0, MAX_FIELDS);
}

/** What the fields list should be: the file's empty columns if it has any, else new facts. */
function fieldsRule(sparse: string[]): string[] {
  if (sparse.length === 0) {
    return ["- fields: 4-8 useful facts to look up. The file has no empty columns, so these are new columns."];
  }
  return [
    `- fields: exactly one field per mostly empty header, named exactly as the header: ${JSON.stringify(sparse)}.`,
    "  - Do not add any field that is not in that list; the user adds new columns themselves.",
    "  - If one of those headers is the key column, leave it out.",
    "  - Read each header's name and any values it has in the sample rows to work out what it holds.",
  ];
}

/** One line per column with values: how many distinct, and the most common. */
function columnLines(columns: ColumnSummary[]): string[] {
  return columns
    .filter((c) => c.distinct > 0)
    .map((c) => `- ${c.header}: ${c.distinct} distinct; most common: ${c.top.slice(0, 8).map((t) => `${t.value} (${t.count})`).join(", ")}`);
}

function suggestPrompt(headers: string[], sampleRows: CsvRow[], sparse: string[], columns: ColumnSummary[]): string {
  return [
    "You are setting up a data-enrichment job for a CSV. Each row will be researched on the web and missing values filled in.",
    "",
    `Headers: ${JSON.stringify(headers)}`,
    "Sample rows:",
    ...sampleRows.map((row) => JSON.stringify(row)),
    "",
    "Columns across the whole file:",
    ...columnLines(columns),
    "",
    "Propose a setup:",
    "- keyColumn: the header that identifies each row (usually a name). Must be one of the headers, exactly as written.",
    "- entityDescription: one sentence describing what the rows are.",
    "- contextColumns: other existing headers whose values help tell similar entities apart (0-5). Not the key column, and not a column you list in fields.",
    "- scopeColumn: the one existing header whose values change which sources are right for a row (for example a country, region, city, platform, language or edition column), judging from the columns across the whole file. Null if the same sources fit every row. Not the key column.",
    ...fieldsRule(sparse),
    sparse.length > 0
      ? "  - name: the header exactly as written in the file (same case, spaces and punctuation)."
      : "  - name: snake_case, starting with a letter, max 40 characters.",
    "  - description: a precise definition that someone could check against a source, max 200 characters. State the scope (e.g. city proper, not metro area), the unit or currency, the time period (current, at founding, latest annual) and what to exclude when it is easy to confuse (e.g. customers or competitors in a partners field).",
    "  - Name a version only when the value really differs between versions (region, currency, edition, model, plan, location, etc.). Then pick the one that is most widely listed and that most people in the market the sample rows suggest would mean, and don't narrow it further (e.g. \"the standard edition\", not \"the first hardcover edition\").",
    "  - roles: the kinds of source that actually publish this fact for these entities, best first: own (the entity's or its maker's own pages), registry (whoever regulates, certifies or officially records it), reference (reference works), listing (platforms where it is listed and kept current). Only the ones that publish it; an entity with no owner has no own pages.",
    "  - source: the kinds of page that state it, best first, max 150 characters (a kind of document, page or site, then a fallback). Never obscure listings or SEO sites. Null when the entity's main reference page covers the fact.",
    "  - type: text, number, year, url, enum, list or boolean.",
    "  - Use enum with options when the values are naturally limited (e.g. industry, funding stage).",
    "  - Use year for years, url for websites, list for multiple short values.",
    "  - Set min/max only for number/year, maxItems only for list; otherwise null.",
  ].join("\n");
}

function toConfigInput(s: Suggestion, headers: string[], sparse: string[]) {
  const known = new Set(headers);
  let fields = s.fields.filter((f) => f.name !== s.keyColumn);
  // With empty columns in the file, those are the only fields, in file order.
  if (sparse.length > 0) {
    fields = sparse.flatMap((h) => fields.find((f) => f.name === h) ?? []);
  }
  const filled = new Set(fields.map((f) => f.name));
  return {
    keyColumn: s.keyColumn,
    entityDescription: s.entityDescription,
    contextColumns: s.contextColumns
      .filter((c) => known.has(c) && c !== s.keyColumn && !filled.has(c))
      .slice(0, 5),
    scopeColumn:
      s.scopeColumn && known.has(s.scopeColumn) && s.scopeColumn !== s.keyColumn ? s.scopeColumn : undefined,
    fields: fields.map((f) => ({
      name: f.name,
      type: f.type,
      description: f.description,
      source: f.source?.trim().slice(0, 150) || undefined,
      roles: f.roles.length > 0 ? [...new Set(f.roles)] : undefined,
      options: f.type === "enum" ? (f.options ?? undefined) : undefined,
      min: f.min ?? undefined,
      // A model's idea of "this year" is its training cutoff; let year
      // fields default to the real current year instead.
      max: f.type === "year" ? undefined : (f.max ?? undefined),
      maxItems: f.type === "list" ? (f.maxItems ?? undefined) : undefined,
    })),
  };
}

/**
 * Proposes a JobConfig from CSV headers, up to 5 sample rows and a summary
 * of every column over the whole file (computed from the sample if absent).
 * Two structured calls, no web search: the setup (fields, their kinds of
 * source, the scope column), then the source plan's sites for every row
 * and each scope value, which are then checked (see source-plan). Throws
 * SuggestError if the draft is not a valid JobConfig; a failed plan only
 * leaves the plan empty.
 */
export async function suggestSetup(
  headers: string[],
  sampleRows: CsvRow[],
  columns?: ColumnSummary[],
  { fetchImpl = fetch }: { fetchImpl?: FetchLike } = {},
): Promise<JobConfig> {
  const sample = sampleRows.slice(0, 5);
  const sparse = sparseHeaders(headers, sample);
  const summaries = columns ?? summarizeColumns(headers, sample);
  const { parsed, issues } = await extractStructured(
    "suggest",
    SuggestionSchema,
    suggestPrompt(headers, sample, sparse, summaries),
  );
  if (!parsed) {
    throw new SuggestError(`Suggestion was malformed: ${issues.join("; ")}`);
  }
  if (!headers.includes(parsed.keyColumn)) {
    throw new SuggestError(
      `Suggested key column "${parsed.keyColumn}" is not a CSV header.`,
    );
  }

  const config = JobConfigSchema.safeParse(toConfigInput(parsed, headers, sparse));
  if (!config.success) {
    throw new SuggestError(
      `Suggestion failed validation: ${z.prettifyError(config.error)}`,
    );
  }
  const { scopeColumn } = config.data;
  const scopes = scopeColumn ? (summaries.find((c) => c.header === scopeColumn)?.top ?? []).slice(0, MAX_SCOPES) : [];
  const sites = await planSites(
    { entityDescription: config.data.entityDescription, fields: config.data.fields, scopeColumn, scopes },
    fetchImpl,
  );
  return sites.length > 0 ? { ...config.data, sites } : config.data;
}
