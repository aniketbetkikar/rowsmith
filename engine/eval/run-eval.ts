// Accuracy + cost report against the hand-verified gold sets (gold-sets.ts).
// The headline metric is the false-value rate: wrong cells among filled ones.
//
//   pnpm eval                      Rowsmith (enrichRow) on every gold set
//   pnpm eval --set deals,towns    only these sets
//   pnpm eval --baseline           also run the plain-LLM baseline
//   pnpm eval --limit 10           first 10 rows of each set only
//   pnpm eval --concurrency 5      rows in flight (default 3)
//   pnpm eval --json report.json   also write the full report as JSON
//   pnpm eval --set companies --gold other.csv   a different gold file for one set
//
// Runs enrichRow() directly: no queue, no DB.

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadEnvFiles } from "@engine/config/load-env";
import { enrichRow } from "@engine/core/enrich-row";
import { assertModels, formatModels, modelNames } from "@engine/llm/models";
import { errorMessage } from "@engine/utils/errors";
import { baselineRow } from "./baseline";
import type { JobConfig } from "@engine/contracts/job-config";
import type { Evidence } from "@engine/contracts/row-result";
import { loadGold, type GoldRow } from "./gold-config";
import { GOLD_SETS, type GoldSet } from "./gold-sets";
import { summarize, type EvalReport, type EvalRowResult } from "./score";

const ArgsSchema = z.object({
  baseline: z.boolean().default(false),
  limit: z.coerce.number().int().min(1).optional(),
  concurrency: z.coerce.number().int().min(1).max(20).default(3),
  json: z.string().optional(),
  set: z
    .string()
    .transform((value) => value.split(",").map((name) => name.trim()))
    .pipe(z.array(z.enum(GOLD_SETS.map((s) => s.name) as [string, ...string[]])))
    .optional(),
  gold: z.string().optional(),
});

type RunResult = EvalRowResult & { error?: string; evidence?: Evidence };

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function runRowsmith(config: JobConfig, gold: GoldRow): Promise<RunResult> {
  const base = { key: gold.row.key, gold: gold.gold };
  try {
    const r = await enrichRow(config, gold.row);
    return {
      ...base,
      predicted: r.output,
      status: r.status,
      costUsd: r.costUsd,
      attempts: r.attempts,
      evidence: r.evidence,
      error: r.error,
    };
  } catch (err) {
    return { ...base, predicted: null, status: "failed", costUsd: 0, attempts: 0, error: errorMessage(err) };
  }
}

async function runBaseline(config: JobConfig, gold: GoldRow): Promise<RunResult> {
  const base = { key: gold.row.key, gold: gold.gold, attempts: 1 };
  try {
    const r = await baselineRow(config, gold.row);
    return {
      ...base,
      predicted: r.output,
      status: r.output ? "done" : "failed",
      costUsd: r.costUsd,
      error: r.error,
    };
  } catch (err) {
    return { ...base, predicted: null, status: "failed", costUsd: 0, error: errorMessage(err) };
  }
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`.padStart(7);
const usd = (n: number) => `$${n.toFixed(5)}`;

function printReport(title: string, report: EvalReport, results: RunResult[]) {
  const width = Math.max(10, ...report.perField.map((f) => f.name.length)) + 2;
  console.log(`\n== ${title} ==`);
  console.log(`${"field".padEnd(width)}  false accuracy    null   wrong`);
  for (const f of [...report.perField, { name: "OVERALL", ...report.overall }]) {
    console.log(
      `${f.name.padEnd(width)}${pct(f.falseRate)} ${pct(f.accuracy)} ${pct(f.nullRate)} ${pct(f.wrongRate)}`,
    );
  }
  console.log(
    `rows ${report.rows} · failed ${report.failedRows} · ` +
      `avg cost/row ${usd(report.avgCostUsd)} · avg attempts ${report.avgAttempts.toFixed(2)}`,
  );
  for (const r of results.filter((r) => r.error)) {
    console.log(`  ! ${r.key}: ${r.error}`);
  }
}

type RunPair = { report: EvalReport; rows: RunResult[] };
type SetRun = { set: string; rowsmith: RunPair; baseline?: RunPair };
type Args = z.infer<typeof ArgsSchema>;

async function runSet(set: GoldSet, args: Args): Promise<SetRun> {
  const file = args.gold ?? set.file;
  const goldRows = loadGold(file, set.config).slice(0, args.limit);
  console.log(`\n# ${set.name}: ${goldRows.length} rows from ${file}`);

  const rowsmith = await mapLimit(goldRows, args.concurrency, async (g, i) => {
    const r = await runRowsmith(set.config, g);
    console.log(`  [${i + 1}/${goldRows.length}] ${g.row.key}: ${r.status}`);
    return r;
  });
  const rowsmithReport = summarize(set.config.fields, rowsmith);
  printReport(`${set.name}: Rowsmith (grounded search + schema + validation)`, rowsmithReport, rowsmith);
  const run: SetRun = { set: set.name, rowsmith: { report: rowsmithReport, rows: rowsmith } };
  if (!args.baseline) return run;

  const baseline = await mapLimit(goldRows, args.concurrency, (g) => runBaseline(set.config, g));
  const baselineReport = summarize(set.config.fields, baseline);
  printReport(`${set.name}: plain LLM baseline (no search, no validation)`, baselineReport, baseline);
  return { ...run, baseline: { report: baselineReport, rows: baseline } };
}

/** Every cell of every set pooled, so bigger sets weigh more. */
function pooled(reports: EvalReport[]) {
  const cells = (r: EvalReport) => r.rows * r.perField.length;
  const sum = (fn: (r: EvalReport) => number) => reports.reduce((acc, r) => acc + fn(r), 0);
  const total = Math.max(sum(cells), 1);
  const filled = sum((r) => cells(r) * (1 - r.overall.nullRate));
  return {
    falseRate: sum((r) => cells(r) * r.overall.wrongRate) / Math.max(filled, 1),
    accuracy: sum((r) => cells(r) * r.overall.accuracy) / total,
    nullRate: 1 - filled / total,
    avgCostUsd: sum((r) => r.rows * r.avgCostUsd) / Math.max(sum((r) => r.rows), 1),
  };
}

function printSummary(label: string, reports: EvalReport[]) {
  const p = pooled(reports);
  console.log(
    `${label.padEnd(10)} false ${pct(p.falseRate)} · accuracy ${pct(p.accuracy)} · ` +
      `null ${pct(p.nullRate)} · ${usd(p.avgCostUsd)}/row`,
  );
}

async function main() {
  loadEnvFiles();
  const { values } = parseArgs({
    options: {
      baseline: { type: "boolean" },
      limit: { type: "string" },
      concurrency: { type: "string" },
      json: { type: "string" },
      set: { type: "string" },
      gold: { type: "string" },
    },
  });
  const parsedArgs = ArgsSchema.safeParse(values);
  if (!parsedArgs.success) {
    throw new Error(`Invalid arguments:\n${z.prettifyError(parsedArgs.error)}`);
  }
  const args = parsedArgs.data;
  if (args.gold && args.set?.length !== 1) {
    throw new Error("--gold needs exactly one --set: the file must match that set's config.");
  }

  assertModels();
  const models = modelNames();

  const sets = GOLD_SETS.filter((s) => !args.set || args.set.includes(s.name));
  console.log(
    `Rowsmith eval: ${sets.map((s) => s.name).join(", ")}\n` +
      `models: ${formatModels(models)} · concurrency ${args.concurrency}`,
  );

  const runs: SetRun[] = [];
  for (const set of sets) runs.push(await runSet(set, args));

  console.log("\n== All sets (false = wrong among filled cells) ==");
  printSummary("Rowsmith", runs.map((r) => r.rowsmith.report));
  const baselines = runs.flatMap((r) => (r.baseline ? [r.baseline.report] : []));
  if (baselines.length > 0) printSummary("Plain LLM", baselines);

  if (args.json) {
    writeFileSync(
      args.json,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          models,
          sets: runs,
        },
        null,
        2,
      ),
    );
    console.log(`\nReport written to ${args.json}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
