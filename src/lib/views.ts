import "server-only";
import type { JobDoc, JobSummary } from "@engine/db/jobs";
import type { Evidence } from "@engine/contracts/row-result";
import type { RowCells, RowDoc } from "@engine/db/rows";
import type { JobStatusResponse, RowView } from "./api";
import { commentsCell } from "./comments";
import { toCsv } from "./csv";
import { blankLabel } from "./format";

export function jobStatusView(job: JobSummary, rows: RowCells[]): JobStatusResponse {
  const cells = cellCounts(rows, job.config.fields.map((f) => f.name));
  return {
    status: job.status,
    mode: job.mode,
    total: job.total,
    done: job.done,
    failed: job.failed,
    duplicates: job.duplicates,
    costUsd: job.costUsd,
    headers: job.headers,
    fields: job.config.fields.map((f) => f.name),
    error: job.error ?? null,
    filledCells: cells.filled,
    blankCells: cells.blank,
    retryable: retryableCount(rows, job.config.keyColumn),
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

/**
 * Cells Rowsmith actually researched: filled, or searched for and not found.
 * Only rows it processed count. Duplicates are free copies, failed rows have
 * no output, and cells the user already filled were never searched.
 */
export function cellCounts(rows: RowCells[], fields: string[]): { filled: number; blank: number } {
  let filled = 0;
  let blank = 0;
  for (const row of rows) {
    if (row.status !== "done") continue;
    for (const field of fields) {
      if (row.input[field]?.trim()) continue;
      if (isEmpty(row.output?.[field])) blank++;
      else filled++;
    }
  }
  return { filled, blank };
}

/** Failed rows with a key (an empty key would just fail again). Same rule as retryableRowIds(). */
export function retryableCount(rows: RowCells[], keyColumn: string): number {
  return rows.filter((row) => row.status === "failed" && row.input[keyColumn]?.trim()).length;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  return Array.isArray(value) && value.length === 0;
}

/**
 * The row's final values. A field can reuse a CSV column: the user's own
 * non-blank value is kept, and only blank cells take the researched value.
 */
export function mergedOutput(row: Pick<RowDoc, "input" | "output">): Record<string, unknown> | null {
  if (!row.output) return null;
  const merged: Record<string, unknown> = { ...row.output };
  for (const field of Object.keys(merged)) {
    const own = row.input[field]?.trim();
    if (own) merged[field] = own;
  }
  return merged;
}

/** Evidence for researched cells only: a value the user supplied had no research behind it. */
export function researchedEvidence(row: Pick<RowDoc, "input" | "evidence">): Evidence {
  return Object.fromEntries(
    Object.entries(row.evidence).filter(([field]) => !row.input[field]?.trim()),
  );
}

export function rowView(row: RowDoc): RowView {
  return {
    key: row.key,
    input: row.input,
    output: mergedOutput(row),
    sources: row.sources,
    evidence: researchedEvidence(row),
    status: row.status,
    error: row.error ?? null,
    costUsd: row.costUsd,
  };
}

/** One output value as a CSV cell: lists joined with "; ", null as empty. */
export function cellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(String).join("; ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * The _evidence cell: one line per researched field, either its quotes with
 * source numbers (matching _sources) or why it is blank.
 *   founded: "Notion was founded in 2013." [1]
 *   founders: "…Ivan Zhao…" [1, 2] | "…Simon Last…" [2]
 *   ceo: Not found in sources
 * A quote from the search model's summary (no page we read stated it) is
 * marked "(search summary)".
 */
export function evidenceCell(fields: string[], evidence: Evidence): string {
  return fields
    .flatMap((field) => {
      const cell = evidence[field];
      if (!cell) return [];
      if (cell.quotes.length === 0) return [`${field}: ${blankLabel(cell.blank)}`];
      const quotes = cell.quotes.map(
        (q) => `${JSON.stringify(q.text)} [${q.sources.join(", ")}]${q.origin === "search" ? " (search summary)" : ""}`,
      );
      return [`${field}: ${quotes.join(" | ")}`];
    })
    .join("\n");
}

/**
 * Result CSV: original columns (reused ones filled in place), then new
 * fields, then _sources (numbered), _evidence, _status, _cost_usd and
 * _comments (why blank cells are blank). Failed rows carry their reason in _status.
 */
export function resultCsv(job: Pick<JobDoc, "headers" | "config">, rows: RowDoc[]): string {
  const fields = job.config.fields.map((f) => f.name);
  const newFields = fields.filter((f) => !job.headers.includes(f));
  const headers = [...job.headers, ...newFields, "_sources", "_evidence", "_status", "_cost_usd", "_comments"];
  const records = rows.map((row) => {
    const record: Record<string, string> = { ...row.input };
    const output = mergedOutput(row);
    for (const field of fields) {
      // A failed row keeps the user's own value in a reused column.
      record[field] = output ? cellValue(output[field]) : (row.input[field] ?? "");
    }
    record._sources = row.sources.map((s, i) => `[${i + 1}] ${s.url}`).join("; ");
    const evidence = researchedEvidence(row);
    record._evidence = evidenceCell(fields, evidence);
    record._status = row.status === "failed" && row.error ? `failed: ${row.error}` : row.status;
    record._cost_usd = row.costUsd.toFixed(6);
    record._comments = commentsCell(fields, evidence, row);
    return record;
  });
  return toCsv(headers, records);
}
