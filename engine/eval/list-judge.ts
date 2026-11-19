import { z } from "zod";
import type { JobConfig } from "@engine/contracts/job-config";
import { fieldList, type RowInput } from "@engine/core/build-prompt";
import { searchCost, tokenCost } from "@engine/core/cost";
import { extractStructured } from "@engine/core/extract";
import { countSearchCalls, searchUsage } from "@engine/core/search";
import { getGenAI } from "@engine/llm/gemini";
import { genAIModel } from "@engine/llm/models";

// Open-ended list fields (the case exact-match gold sets can't grade): a
// Business Model Canvas on real companies. Each filled item is fact-checked
// on its own by a separate grounded search that never sees Rowsmith's quotes,
// so any engine's output (old, new, or another tool's) is judged the same way.

export const BMC_CONFIG: JobConfig = {
  keyColumn: "name",
  entityDescription: "Technology companies",
  contextColumns: ["country"],
  fields: [
    {
      name: "key_partners",
      type: "list",
      description:
        "External organisations with a current commercial or operational partnership with the company; not its customers, competitors or regulators",
      maxItems: 6,
    },
    {
      name: "revenue_streams",
      type: "list",
      description: "Ways the company currently earns money (e.g. subscriptions, transaction fees)",
      maxItems: 6,
    },
    {
      name: "customer_segments",
      type: "list",
      description: "Groups of customers the company currently serves",
      maxItems: 6,
    },
    {
      name: "cost_structure",
      type: "list",
      description: "Main current cost categories of running the business",
      maxItems: 6,
    },
  ],
};

export const BMC_ROWS: RowInput[] = [
  { key: "Notion", input: { name: "Notion", country: "USA" } },
  { key: "Canva", input: { name: "Canva", country: "Australia" } },
  { key: "Zerodha", input: { name: "Zerodha", country: "India" } },
  { key: "Razorpay", input: { name: "Razorpay", country: "India" } },
  { key: "Freshworks", input: { name: "Freshworks", country: "USA" } },
];

export const VERDICTS = ["supported", "wrong_field", "contradicted", "unverifiable"] as const;
export type Verdict = (typeof VERDICTS)[number];

const JudgedSchema = z.object({
  verdicts: z.array(z.object({ id: z.string(), verdict: z.enum(VERDICTS) })),
});

export type Item = { id: string; field: string; value: string };
export type JudgedItem = Item & { verdict: Verdict };

/** Every list item in an output, with ids like "key_partners#2". */
export function listItems(config: JobConfig, output: Record<string, unknown> | null): Item[] {
  return config.fields.flatMap((field) => {
    const value = output?.[field.name];
    if (!Array.isArray(value)) return [];
    return value.map((item, i) => ({ id: `${field.name}#${i + 1}`, field: field.name, value: String(item) }));
  });
}

// Own date helper: the judge also runs against older engine code.
export function judgePrompt(
  config: JobConfig,
  row: RowInput,
  items: Item[],
  today = new Date().toISOString().slice(0, 10),
): string {
  return [
    `Today is ${today}.`,
    `You are a strict fact-checker. Check each statement about ${row.key} (${config.entityDescription}) by searching the web. Prefer official sources.`,
    "Each statement is an item someone placed in one of these fields:",
    fieldList(config.fields),
    "",
    "Give each id one verdict. Start from unverifiable and only move away from it with evidence:",
    `- supported: a page you found states this specific item about ${row.key}, it is current (names of plans, products and partners as they are today), and it fits the field's definition`,
    "- wrong_field: a source shows it is true, but it doesn't fit the field's definition (e.g. a competitor, customer or regulator listed as a partner)",
    "- contradicted: a source contradicts it, or shows it is outdated (renamed, discontinued, ended)",
    `- unverifiable: no page you found states it about ${row.key}. Generic items that would be true of almost any company (e.g. "salaries", "marketing costs") are unverifiable unless a source lists them for ${row.key}`,
    'Answer with one line per id: "[id] verdict: reason (source URL)".',
    "",
    ...items.map((item) => `[${item.id}] ${item.field}: ${item.value}`),
  ].join("\n");
}

/** One grounded fact-check for a batch of items; skipped items count as unverifiable. */
async function judgeBatch(
  config: JobConfig,
  row: RowInput,
  items: Item[],
): Promise<{ items: JudgedItem[]; costUsd: number }> {
  // A stronger model than the engine's search model, so it doesn't share its blind spots.
  const { model, thinkingConfig } = genAIModel("judge");
  const response = await getGenAI().models.generateContent({
    model,
    contents: judgePrompt(config, row, items),
    config: { tools: [{ googleSearch: {} }], thinkingConfig },
  });
  let costUsd = tokenCost(model, searchUsage(response)) + searchCost(countSearchCalls(response));

  const read = await extractStructured(
    "extract",
    JudgedSchema,
    `Copy the verdict for every id from this fact-check.\n\n${response.text ?? ""}`,
  );
  costUsd += tokenCost(read.model, read.usage);
  const byId = new Map((read.parsed?.verdicts ?? []).map((v) => [v.id.replace(/^\[|\]$/g, ""), v.verdict]));
  return {
    items: items.map((item) => ({ ...item, verdict: byId.get(item.id) ?? "unverifiable" })),
    costUsd,
  };
}

/**
 * Judges items one field at a time (a search per field, so each item gets
 * looked at), then reads the verdicts with a structured call.
 */
export async function judgeItems(
  config: JobConfig,
  row: RowInput,
  items: Item[],
): Promise<{ items: JudgedItem[]; costUsd: number }> {
  const batches = config.fields
    .map((field) => items.filter((item) => item.field === field.name))
    .filter((batch) => batch.length > 0);
  const results = await Promise.all(batches.map((batch) => judgeBatch(config, row, batch)));
  return {
    items: results.flatMap((r) => r.items),
    costUsd: results.reduce((sum, r) => sum + r.costUsd, 0),
  };
}

export type ListReport = {
  perField: { name: string; cells: number; items: number; counts: Record<Verdict, number> }[];
  overall: { items: number; counts: Record<Verdict, number>; unsupportedRate: number };
};

const zero = (): Record<Verdict, number> => ({ supported: 0, wrong_field: 0, contradicted: 0, unverifiable: 0 });

/** Counts per field; unsupportedRate is every non-"supported" item among all items. */
export function summarizeLists(config: JobConfig, rows: { judged: JudgedItem[] }[]): ListReport {
  const overall = zero();
  const perField = config.fields.map((field) => {
    const counts = zero();
    let cells = 0;
    for (const row of rows) {
      const items = row.judged.filter((i) => i.field === field.name);
      if (items.length > 0) cells++;
      for (const item of items) {
        counts[item.verdict]++;
        overall[item.verdict]++;
      }
    }
    const items = VERDICTS.reduce((sum, v) => sum + counts[v], 0);
    return { name: field.name, cells, items, counts };
  });
  const items = VERDICTS.reduce((sum, v) => sum + overall[v], 0);
  return {
    perField,
    overall: { items, counts: overall, unsupportedRate: (items - overall.supported) / Math.max(items, 1) },
  };
}
