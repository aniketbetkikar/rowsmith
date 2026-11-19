import { readFileSync } from "node:fs";
import type { FieldDef, JobConfig } from "@engine/contracts/job-config";
import { buildRowSchema, type RowOutput } from "@engine/core/build-schema";
import type { RowInput } from "@engine/core/build-prompt";
import { formatIssues } from "@engine/core/extract";
import { parseCsv } from "@engine/core/csv";

// Fixed config the gold set is verified against. Changing a field here means
// re-verifying that column in gold.csv.
//
// gold.csv format: one row per entity. Input columns (name, country) come
// first, then one column per field below. Cell values:
//   - empty cell     → null (the true answer is unknown / does not exist)
//   - list           → items separated by "|", e.g. "Ivan Zhao|Simon Last"
//   - boolean        → true / false
//   - year / number  → digits
export const GOLD_CONFIG: JobConfig = {
  keyColumn: "name",
  entityDescription: "Software and internet companies",
  contextColumns: ["country"],
  fields: [
    {
      name: "industry",
      type: "enum",
      description: "Primary market the company's main product serves",
      options: [
        "Productivity & collaboration",
        "Design & creative",
        "Fintech & payments",
        "Business software (CRM, HR, support)",
        "Developer tools & infrastructure",
        "E-commerce & retail",
        "Communication & social",
        "Media & entertainment",
        "Other",
      ],
    },
    {
      name: "hq_country",
      type: "enum",
      description: "Country of the company's current global headquarters",
      options: [
        "United States",
        "India",
        "United Kingdom",
        "Australia",
        "Canada",
        "Germany",
        "France",
        "Singapore",
        "China",
        "Israel",
        "Other",
      ],
    },
    { name: "founded", type: "year", description: "Year the company was founded" },
    { name: "website", type: "url", description: "Official company website (homepage)" },
    {
      name: "is_public",
      type: "boolean",
      description: "Whether the company's shares are currently listed on a stock exchange",
    },
    {
      name: "founders",
      type: "list",
      description: "Full names of the co-founders",
      maxItems: 5,
    },
    { name: "ceo", type: "text", description: "Full name of the current CEO" },
    {
      name: "stock_ticker",
      type: "text",
      description: "Ticker symbol of the company's primary stock listing; null if not publicly listed",
    },
  ],
};

export type GoldRow = {
  row: RowInput;
  gold: RowOutput;
};

function goldValue(field: FieldDef, cell: string): unknown {
  if (cell === "") return null;
  switch (field.type) {
    case "number":
    case "year":
      return Number(cell);
    case "boolean":
      return cell.toLowerCase() === "true"
        ? true
        : cell.toLowerCase() === "false"
          ? false
          : cell;
    case "list":
      return cell.split("|").map((item) => item.trim()).filter(Boolean);
    default:
      return cell;
  }
}

/**
 * Loads gold.csv: splits each row into the enrichRow input (non-field
 * columns only, so answers never leak into the prompt) and the expected
 * output, validated against the config's row schema.
 */
export function loadGold(path: string, config: JobConfig = GOLD_CONFIG): GoldRow[] {
  const { headers, rows } = parseCsv(readFileSync(path, "utf8"));
  const fieldNames = new Set(config.fields.map((f) => f.name));
  const missing = [config.keyColumn, ...fieldNames].filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    throw new Error(`gold.csv is missing columns: ${missing.join(", ")}`);
  }

  const schema = buildRowSchema(config.fields);
  return rows.map((cells, i) => {
    const input = Object.fromEntries(
      headers.filter((h) => !fieldNames.has(h)).map((h) => [h, cells[h] ?? ""]),
    );
    const expected = Object.fromEntries(
      config.fields.map((f) => [f.name, goldValue(f, cells[f.name] ?? "")]),
    );
    const parsed = schema.safeParse(expected);
    if (!parsed.success) {
      throw new Error(
        `gold.csv row ${i + 2} (${cells[config.keyColumn]}): ${formatIssues(parsed.error).join("; ")}`,
      );
    }
    return {
      row: { key: cells[config.keyColumn] ?? "", input },
      gold: parsed.data,
    };
  });
}
