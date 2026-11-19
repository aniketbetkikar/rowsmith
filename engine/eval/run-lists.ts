// Open-ended list fields, judged item by item (see list-judge.ts).
// The headline metric is the unsupported rate: items a separate grounded
// fact-check could not confirm (wrong field, contradicted/outdated, or unverifiable).
//
//   pnpm eval:lists                      Rowsmith on the BMC rows, every item judged
//   pnpm eval:lists --json report.json   also write every item and verdict
//
// Runs enrichRow() directly: no queue, no DB.

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadEnvFiles } from "@engine/config/load-env";
import { assertModels, formatModels, modelNames } from "@engine/llm/models";
import { enrichRow } from "@engine/core/enrich-row";
import { errorMessage } from "@engine/utils/errors";
import { BMC_CONFIG, BMC_ROWS, judgeItems, listItems, summarizeLists, VERDICTS, type JudgedItem } from "./list-judge";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

async function main() {
  loadEnvFiles();
  const { values } = parseArgs({ options: { json: { type: "string" } } });
  assertModels();
  console.log(`List-field eval: ${BMC_ROWS.length} rows · ${formatModels(modelNames())}`);

  const rows = await Promise.all(
    BMC_ROWS.map(async (row) => {
      try {
        const r = await enrichRow(BMC_CONFIG, row);
        const judged = await judgeItems(BMC_CONFIG, row, listItems(BMC_CONFIG, r.output));
        console.log(`  ${row.key}: ${r.status}, ${judged.items.length} items`);
        return { key: row.key, status: r.status, costUsd: r.costUsd, judgeCostUsd: judged.costUsd, judged: judged.items, evidence: r.evidence, error: r.error };
      } catch (err) {
        console.log(`  ! ${row.key}: ${errorMessage(err)}`);
        return { key: row.key, status: "failed" as const, costUsd: 0, judgeCostUsd: 0, judged: [] as JudgedItem[], error: errorMessage(err) };
      }
    }),
  );

  const report = summarizeLists(BMC_CONFIG, rows);
  console.log(`\nfield               cells  items  ${VERDICTS.map((v) => v.padStart(12)).join(" ")}`);
  for (const f of report.perField) {
    console.log(
      `${f.name.padEnd(20)}${String(f.cells).padStart(5)}  ${String(f.items).padStart(5)}  ${VERDICTS.map((v) => String(f.counts[v]).padStart(12)).join(" ")}`,
    );
  }
  const cost = rows.reduce((sum, r) => sum + r.costUsd, 0) / Math.max(rows.length, 1);
  console.log(
    `\nunsupported ${pct(report.overall.unsupportedRate)} of ${report.overall.items} items · ` +
      `avg cost/row $${cost.toFixed(5)} (judge excluded)`,
  );
  for (const r of rows) {
    for (const item of r.judged.filter((i) => i.verdict !== "supported")) {
      console.log(`  ${item.verdict.padEnd(12)} ${r.key} · ${item.field}: ${item.value}`);
    }
  }

  if (values.json) {
    writeFileSync(values.json, JSON.stringify({ createdAt: new Date().toISOString(), report, rows }, null, 2));
    console.log(`\nReport written to ${values.json}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
